//! Capture, codecs and playback through GStreamer (already a WebKitGTK dependency): Opus PT 112 and H.264 PT 97
//! as ZaloCall advertises them (docs/data/call-media.md §4). RTP comes out of appsinks and goes back in through
//! appsrcs; SRTP and the relay envelope are done by the caller.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app::{AppSink, AppSinkCallbacks, AppSrc};

use super::zrtp::Kind;

pub const AUDIO_PT: u8 = 112;
pub const VIDEO_PT: u8 = 97;
/// Zalo mobile sends H.264 keyframes on 98 and the rest on 97, and tells a keyframe by that payload type: an IDR on
/// 97 counts as a delta frame and the phone keeps asking for a keyframe (seen live, 2026-11-01; PC ZaloCall predates it)
pub const VIDEO_KEY_PT: u8 = 98;
/// largest H.264 payload per packet; the phone's zrtc_config has maxPacketSize 1300 for the whole SRTP packet
const VIDEO_MAX_PAYLOAD: usize = 1200;
/// RTP clock ZaloCall stamps Opus PT 112 with (its CodecInst says 16 kHz; libwebrtc's default would be 48 kHz).
/// GStreamer's Opus elements only speak 48 kHz, so timestamps are rescaled at the edge.
/// ponytail: calibration knob until a live capture settles it (docs/data/call-media.md §10 #3)
pub const OPUS_CLOCK: u64 = 16_000;

pub struct Frame {
    pub rgba: Vec<u8>,
    pub width: i32,
    pub height: i32,
    pub local: bool,
}

pub type OnRtp = Arc<dyn Fn(Kind, Vec<u8>) + Send + Sync>;
pub type OnFrame = Arc<dyn Fn(Frame) + Send + Sync>;

pub struct Media {
    pipelines: Vec<gst::Pipeline>,
    audio_in: AppSrc,
    video_in: Option<AppSrc>,
    h264: std::sync::Mutex<H264Depacketizer>,
    mic: gst::Element,
    cam: Option<gst::Element>,
    /// the encoded video's sink, where keyframe requests go upstream
    video_out: Option<AppSink>,
    /// partner frames decoded so far, and access units handed to the decoder
    remote_frames: Arc<AtomicU64>,
    aus: AtomicU64,
}

/// NEXORA_CALL_TEST_MEDIA=1: test tone / pattern instead of mic and camera, nothing played (loopback checks,
/// machines without devices). The camera is read through V4L2 where there is one: autovideosrc picks pipewiresrc,
/// which fails to fixate a webcam format by itself ("error set output format: -22").
fn devices() -> (&'static str, &'static str, &'static str) {
    if std::env::var_os("NEXORA_CALL_TEST_MEDIA").is_some() {
        ("audiotestsrc is-live=true wave=ticks", "fakesink", "videotestsrc is-live=true")
    } else if has("v4l2src") && std::path::Path::new("/dev/video0").exists() {
        ("autoaudiosrc", "autoaudiosink", "v4l2src")
    } else {
        ("autoaudiosrc", "autoaudiosink", "autovideosrc")
    }
}

fn has(factory: &str) -> bool {
    gst::ElementFactory::find(factory).is_some()
}

fn rtp_caps(media: &str, clock: u32, encoding: &str, pt: u8) -> String {
    format!(r#"caps="application/x-rtp,media={media},clock-rate={clock},encoding-name={encoding},payload={pt}""#)
}

// Each direction is its own pipeline: a receive branch waiting on its appsrc would hold a shared pipeline out of
// PLAYING, and live sources only produce in PLAYING. webrtcdsp (AEC/NS/AGC) finds its echo probe, on the playback
// side, by name, so the receive pipeline starts first.
fn audio_recv_desc() -> String {
    let (_, sink, _) = devices();
    let probe = if has("webrtcdsp") { "webrtcechoprobe name=probe ! " } else { "" };
    format!(
        "appsrc name=in is-live=true format=time do-timestamp=true {} ! rtpjitterbuffer latency=120 drop-on-latency=true ! \
         rtpopusdepay ! opusdec plc=true ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=48000,channels=1 ! {probe}\
         audioconvert ! {sink}",
        rtp_caps("audio", 48000, "OPUS", AUDIO_PT)
    )
}

fn audio_send_desc(ssrc: u32) -> String {
    let (src, _, _) = devices();
    let dsp = if has("webrtcdsp") { "webrtcdsp probe=probe ! " } else { "" };
    format!(
        "{src} ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=48000,channels=1 ! {dsp}volume name=mic ! \
         audioconvert ! opusenc bitrate=20000 frame-size=20 bandwidth=wideband ! rtpopuspay pt={AUDIO_PT} mtu=1200 ssrc={ssrc} ! appsink name=out sync=false"
    )
}

fn video_send_desc() -> String {
    let enc = if has("x264enc") {
        "x264enc tune=zerolatency speed-preset=veryfast bitrate=600 key-int-max=48 bframes=0"
    } else {
        "openh264enc bitrate=600000 gop-size=48 rate-control=bitrate"
    };
    let (_, _, src) = devices();
    format!(
        "{src} ! videoconvert ! videoscale ! videorate ! video/x-raw,width=640,height=360,framerate=24/1 ! tee name=t \
         t. ! queue max-size-buffers=2 leaky=downstream ! valve name=cam ! videoconvert ! video/x-raw,format=I420 ! {enc} ! \
         video/x-h264,profile=constrained-baseline ! h264parse config-interval=-1 ! video/x-h264,stream-format=byte-stream,alignment=au ! \
         appsink name=out sync=false \
         t. ! queue max-size-buffers=1 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,format=RGBA,width=240,height=135 ! \
         appsink name=preview sync=false max-buffers=1 drop=true"
    )
}

// access units come out of H264Depacketizer: Zalo's packetMode 2 isn't something rtph264depay reads
fn video_recv_desc() -> String {
    let dec = if has("avdec_h264") { "avdec_h264" } else { "openh264dec" };
    format!(
        "appsrc name=in is-live=true format=time do-timestamp=true caps=\"video/x-h264,stream-format=byte-stream\" ! \
         h264parse ! {dec} ! videoconvert ! video/x-raw,format=RGBA ! appsink name=frames sync=false max-buffers=1 drop=true"
    )
}

// `name` shows in error messages ("/GstPipeline:video-recv/...")
fn launch(desc: &str, name: &str) -> Result<gst::Pipeline, String> {
    let p = gst::parse_launch(desc).map_err(|e| e.to_string())?;
    let p = p.downcast::<gst::Pipeline>().map_err(|_| "not a pipeline".to_string())?;
    p.set_property("name", name);
    // errors (no camera, no sound device) are logged; the other pipelines keep running
    p.bus().ok_or("no bus")?.set_sync_handler(|_, msg| {
        if let gst::MessageView::Error(e) = msg.view() {
            say!("media: {} ({:?})", e.error(), e.debug());
        }
        gst::BusSyncReply::Drop
    });
    Ok(p)
}

fn child<T: IsA<gst::Element>>(p: &gst::Pipeline, name: &str) -> Result<T, String> {
    p.by_name(name).and_then(|e| e.downcast::<T>().ok()).ok_or_else(|| format!("missing {name}"))
}

fn on_samples(sink: &AppSink, f: impl Fn(&gst::Sample) + Send + Sync + 'static) {
    sink.set_callbacks(
        AppSinkCallbacks::builder()
            .new_sample(move |s| {
                let sample = s.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                f(&sample);
                Ok(gst::FlowSuccess::Ok)
            })
            .build(),
    );
}

fn bytes(sample: &gst::Sample) -> Option<Vec<u8>> {
    Some(sample.buffer()?.map_readable().ok()?.to_vec())
}

fn frame(sample: &gst::Sample, local: bool) -> Option<Frame> {
    let s = sample.caps()?.structure(0)?;
    let (width, height) = (s.get::<i32>("width").ok()?, s.get::<i32>("height").ok()?);
    let rgba = bytes(sample)?;
    (rgba.len() >= (width * height * 4) as usize).then_some(Frame { rgba, width, height, local })
}

/// Rewrites an RTP packet's timestamp from one clock to another.
fn rescale(rtp: &mut [u8], from: u64, to: u64) {
    if rtp.len() >= 12 && from != to {
        let ts = u64::from(u32::from_be_bytes(rtp[4..8].try_into().unwrap()));
        rtp[4..8].copy_from_slice(&((ts * to / from) as u32).to_be_bytes());
    }
}

impl Media {
    /// `ssrc`: ZaloCall stamps its own uid on both streams
    pub fn start(video: bool, ssrc: u32, on_rtp: OnRtp, on_frame: OnFrame) -> Result<Media, String> {
        gst::init().map_err(|e| e.to_string())?;
        let (playback, capture) = (launch(&audio_recv_desc(), "audio-recv")?, launch(&audio_send_desc(ssrc), "audio-send")?);
        let rtp = on_rtp.clone();
        on_samples(&child(&capture, "out")?, move |s| {
            if let Some(mut p) = bytes(s) {
                rescale(&mut p, 48_000, OPUS_CLOCK);
                rtp(Kind::Audio, p);
            }
        });
        let mut media = Media { audio_in: child(&playback, "in")?, mic: child(&capture, "mic")?, pipelines: vec![playback, capture], video_in: None, h264: Default::default(), cam: None, video_out: None, remote_frames: Default::default(), aus: Default::default() };
        for p in &media.pipelines {
            p.set_state(gst::State::Playing).map_err(|e| e.to_string())?;
        }
        if video {
            media.start_video(ssrc, on_rtp, on_frame);
        }
        Ok(media)
    }

    // video failing (no camera, a format it won't give) only drops that side of the picture: the call goes on
    fn start_video(&mut self, ssrc: u32, on_rtp: OnRtp, on_frame: OnFrame) {
        let play = |p: gst::Pipeline| match p.set_state(gst::State::Playing) {
            Ok(_) => Some(p),
            Err(e) => {
                let _ = p.set_state(gst::State::Null);
                say!("media: video pipeline won't start: {e}");
                None
            }
        };
        match launch(&video_recv_desc(), "video-recv").and_then(|p| Ok((child::<AppSrc>(&p, "in")?, child::<AppSink>(&p, "frames")?, p))) {
            Ok((src, sink, p)) => {
                let (show, decoded) = (on_frame.clone(), self.remote_frames.clone());
                on_samples(&sink, move |s| {
                    decoded.fetch_add(1, Ordering::Relaxed);
                    frame(s, false).into_iter().for_each(|f| show(f));
                });
                if let Some(p) = play(p) {
                    self.video_in = Some(src);
                    self.pipelines.push(p);
                }
            }
            Err(e) => say!("media: video receive unavailable: {e}"),
        }
        match launch(&video_send_desc(), "video-send").and_then(|p| Ok((child::<AppSink>(&p, "out")?, child::<AppSink>(&p, "preview")?, child(&p, "cam")?, p))) {
            Ok((out, preview, cam, p)) => {
                let pay = std::sync::Mutex::new(H264Packetizer { ssrc, seq: rand_u16() });
                on_samples(&out, move |s| {
                    let Some(buf) = s.buffer() else { return };
                    let Ok(au) = buf.map_readable() else { return };
                    let key = !buf.flags().contains(gst::BufferFlags::DELTA_UNIT);
                    let ts = buf.pts().map_or(0, |t| t.nseconds() * 9 / 100_000) as u32;
                    pay.lock().unwrap().packetize(&au, ts, key).into_iter().for_each(|p| on_rtp(Kind::Video, p));
                });
                on_samples(&preview, move |s| frame(s, true).into_iter().for_each(|f| on_frame(f)));
                if let Some(p) = play(p) {
                    self.cam = Some(cam);
                    self.video_out = Some(out);
                    self.pipelines.push(p);
                }
            }
            Err(e) => say!("media: camera unavailable: {e}"),
        }
    }

    /// Plain RTP from the partner.
    pub fn push(&self, kind: Kind, rtp: Vec<u8>) {
        let Some(mut rtp) = media_only(kind, rtp) else { return };
        match kind {
            Kind::Audio => {
                // Opus 16 kHz (112) or 48 kHz (113): one set of receive caps, at 48 kHz
                if rtp[1] & 0x7f == AUDIO_PT {
                    rescale(&mut rtp, OPUS_CLOCK, 48_000);
                }
                rtp[1] = (rtp[1] & 0x80) | AUDIO_PT;
                let _ = self.audio_in.push_buffer(gst::Buffer::from_mut_slice(rtp));
            }
            Kind::Video => {
                if let (Some(src), Some(au)) = (&self.video_in, self.h264.lock().unwrap().push(&rtp)) {
                    self.aus.fetch_add(1, Ordering::Relaxed);
                    let _ = src.push_buffer(gst::Buffer::from_mut_slice(au));
                }
            }
        }
    }

    pub fn set_mic(&self, on: bool) {
        self.mic.set_property("mute", !on);
    }

    /// The partner's PLI/FIR: the next encoded frame is an IDR with SPS/PPS.
    pub fn force_keyframe(&self) {
        if let Some(out) = &self.video_out {
            let s = gst::Structure::builder("GstForceKeyUnit").field("all-headers", true).build();
            out.send_event(gst::event::CustomUpstream::new(s));
        }
    }

    pub fn aus(&self) -> u64 {
        self.aus.load(Ordering::Relaxed)
    }

    pub fn remote_frames(&self) -> u64 {
        self.remote_frames.load(Ordering::Relaxed)
    }

    pub fn set_camera(&self, on: bool) {
        if let Some(cam) = &self.cam {
            cam.set_property("drop", !on);
        }
    }
}

impl Drop for Media {
    fn drop(&mut self) {
        for p in &self.pipelines {
            let _ = p.set_state(gst::State::Null);
        }
    }
}

/// RED, ULPFEC and the padding packets libwebrtc probes bandwidth with (call-media.md §4: RED 118, ULPFEC 119,
/// empty 101) never reach a decoder: padding is cut, RED unwrapped to its primary block, and only Opus (112, 113) /
/// H.264 (97) passes.
/// ponytail: FEC packets are dropped, not used to repair losses
fn media_only(kind: Kind, mut rtp: Vec<u8>) -> Option<Vec<u8>> {
    let mut hdr = 12 + 4 * (*rtp.first()? & 0x0f) as usize;
    if rtp[0] & 0x10 != 0 {
        hdr += 4 + 4 * u16::from_be_bytes([*rtp.get(hdr + 2)?, *rtp.get(hdr + 3)?]) as usize;
    }
    if rtp[0] & 0x20 != 0 {
        let pad = *rtp.last()? as usize;
        rtp.truncate(rtp.len().checked_sub(pad)?);
        rtp[0] &= !0x20;
    }
    if rtp.len() <= hdr {
        return None;
    }
    if rtp[1] & 0x7f == 118 {
        // RFC 2198: 4-byte headers (F=1) for redundant blocks, then a 1-byte header naming the primary block
        let (mut at, mut skip) = (hdr, 0usize);
        while *rtp.get(at)? & 0x80 != 0 {
            skip += (u16::from_be_bytes([*rtp.get(at + 2)?, *rtp.get(at + 3)?]) & 0x3ff) as usize;
            at += 4;
        }
        let pt = rtp[at] & 0x7f;
        let primary = rtp.get(at + 1 + skip..)?.to_vec();
        rtp.truncate(hdr);
        rtp[1] = (rtp[1] & 0x80) | pt;
        rtp.extend(primary);
    }
    let pt = rtp[1] & 0x7f;
    let wanted = match kind {
        Kind::Audio => pt == AUDIO_PT || pt == 113,
        Kind::Video => pt == VIDEO_PT || pt == VIDEO_KEY_PT,
    };
    (wanted && rtp.len() > hdr).then_some(rtp)
}

fn rand_u16() -> u16 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().subsec_nanos() as u16
}

/// Annex-B access units into RTP the way the phone sends them (packetMode 2, call-port-answers.md §8): an AU that
/// fits goes raw in one packet, a bigger one in equal chunks behind 1C 80 / 1C 00 / 1C 40; keyframes on PT 98.
pub struct H264Packetizer {
    ssrc: u32,
    seq: u16,
}

impl H264Packetizer {
    pub fn packetize(&mut self, au: &[u8], ts: u32, key: bool) -> Vec<Vec<u8>> {
        let n = if au.len() <= VIDEO_MAX_PAYLOAD { 1 } else { au.len().div_ceil(VIDEO_MAX_PAYLOAD - 2) };
        let pt = if key { VIDEO_KEY_PT } else { VIDEO_PT };
        au.chunks(au.len().div_ceil(n).max(1))
            .enumerate()
            .map(|(i, chunk)| {
                let last = i == n - 1;
                let mut p = vec![0x80, pt | if last { 0x80 } else { 0 }];
                p.extend(self.seq.to_be_bytes());
                p.extend(ts.to_be_bytes());
                p.extend(self.ssrc.to_be_bytes());
                if n > 1 {
                    p.extend([0x1c, if i == 0 { 0x80 } else if last { 0x40 } else { 0 }]);
                }
                p.extend(chunk);
                self.seq = self.seq.wrapping_add(1);
                p
            })
            .collect()
    }
}

/// Zalo's H.264 RTP (docs/data/call-port-answers.md §8) back into Annex-B access units: RFC 6184 single NAL /
/// STAP-A / FU-A, or packetMode 2 (the default): the raw Annex-B access unit in one packet, or cut into chunks behind
/// a 1C 80 / 1C 00 / 1C 40 FU header with NAL type 0. A gap mid-FU-A drops that fragment; gaps from dropped FEC/padding
/// packets do not drop valid NALs.
#[derive(Default)]
pub struct H264Depacketizer {
    au: Vec<u8>,
    fua: Vec<u8>,
    fua_broken: bool,
    last_seq: Option<u16>,
}

impl H264Depacketizer {
    /// One RTP packet in; a complete access unit out on the frame's last packet (marker bit).
    pub fn push(&mut self, rtp: &[u8]) -> Option<Vec<u8>> {
        const START: [u8; 4] = [0, 0, 0, 1];
        let mut hdr = 12 + 4 * (rtp.first()? & 0x0f) as usize;
        if rtp[0] & 0x10 != 0 {
            hdr += 4 + 4 * u16::from_be_bytes([*rtp.get(hdr + 2)?, *rtp.get(hdr + 3)?]) as usize;
        }
        let p = rtp.get(hdr..).filter(|p| !p.is_empty())?;
        let seq = u16::from_be_bytes([rtp[2], rtp[3]]);
        let gap = self.last_seq.is_some_and(|last| seq != last.wrapping_add(1));
        self.last_seq = Some(seq);
        match p[0] & 0x1f {
            28 if p.len() > 2 => {
                let (first, end, nal_type) = (p[1] & 0x80 != 0, p[1] & 0x40 != 0, p[1] & 0x1f);
                if first {
                    self.fua.clear();
                    self.fua_broken = false;
                    if nal_type == 0 {
                        // packetMode 2: raw Annex-B chunk
                        self.fua.extend_from_slice(&p[2..]);
                    } else {
                        // RFC 6184 FU-A
                        self.fua.extend_from_slice(&START);
                        self.fua.push((p[0] & 0xe0) | nal_type);
                        self.fua.extend_from_slice(&p[2..]);
                    }
                } else if !self.fua_broken {
                    if gap {
                        self.fua_broken = true;
                        self.fua.clear();
                    } else {
                        self.fua.extend_from_slice(&p[2..]);
                    }
                }
                if end && !self.fua_broken && !self.fua.is_empty() {
                    self.au.append(&mut self.fua);
                }
            }
            24 => {
                let mut i = 1;
                while let Some(len) = p.get(i..i + 2).map(|b| u16::from_be_bytes([b[0], b[1]]) as usize) {
                    let Some(nal) = p.get(i + 2..i + 2 + len) else {
                        break;
                    };
                    self.au.extend_from_slice(&START);
                    self.au.extend_from_slice(nal);
                    i += 2 + len;
                }
            }
            // packetMode 2: the whole access unit, start codes included
            0 => self.au.extend_from_slice(p),
            _ => {
                self.au.extend_from_slice(&START);
                self.au.extend_from_slice(p);
            }
        }
        if rtp[1] & 0x80 == 0 {
            return None;
        }
        let au = std::mem::take(&mut self.au);
        (!au.is_empty()).then_some(au)
    }
}

/// A freedesktop sound-theme sound looped until dropped: ringing in, ringback out (ZaloCall plays its own from qrc).
/// Silent where the theme isn't installed.
pub struct Tone(gst::Element);

impl Tone {
    pub fn play(name: &str) -> Option<Tone> {
        let path = format!("/usr/share/sounds/freedesktop/stereo/{name}.oga");
        if !std::path::Path::new(&path).exists() || gst::init().is_err() {
            return None;
        }
        let uri = format!("file://{path}");
        let player = gst::ElementFactory::make("playbin").property("uri", &uri).build().ok()?;
        if std::env::var_os("NEXORA_CALL_TEST_MEDIA").is_some() {
            player.set_property("audio-sink", gst::ElementFactory::make("fakesink").build().ok()?);
        }
        player.connect("about-to-finish", false, move |args| {
            args[0].get::<gst::Element>().ok()?.set_property("uri", &uri);
            None
        });
        player.set_state(gst::State::Playing).ok()?;
        Some(Tone(player))
    }
}

impl Drop for Tone {
    fn drop(&mut self) {
        let _ = self.0.set_state(gst::State::Null);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rescales_timestamps() {
        let mut rtp = [0x80, 112, 0, 1, 0, 0, 0x03, 0xc0, 0, 0, 0, 1];
        rescale(&mut rtp, 48_000, 16_000);
        assert_eq!(u32::from_be_bytes(rtp[4..8].try_into().unwrap()), 320);
    }

    fn rtp(seq: u16, marker: bool, payload: &[u8]) -> Vec<u8> {
        let mut p = vec![0x80, if marker { 0x80 | 97 } else { 97 }];
        p.extend(seq.to_be_bytes());
        p.extend([0; 8]);
        p.extend(payload);
        p
    }

    #[test]
    fn only_media_reaches_the_decoders() {
        let pkt = |pt: u8, payload: &[u8]| [&[0x80, 0x80 | pt, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1][..], payload].concat();
        assert_eq!(media_only(Kind::Video, pkt(97, &[0x41, 1])), Some(pkt(97, &[0x41, 1])));
        // RED around H.264 → plain PT 97; RED around ULPFEC, padding, other PTs → dropped
        assert_eq!(media_only(Kind::Video, pkt(118, &[97, 0x41, 1])), Some(pkt(97, &[0x41, 1])));
        assert_eq!(media_only(Kind::Video, pkt(118, &[119, 9, 9])), None);
        assert_eq!(media_only(Kind::Video, pkt(101, &[0x41])), None);
        let mut padded = pkt(97, &[0x41, 1, 0, 0, 3]);
        padded[0] |= 0x20;
        assert_eq!(media_only(Kind::Video, padded), Some(pkt(97, &[0x41, 1])));
        let mut only_padding = pkt(97, &[0, 2]);
        only_padding[0] |= 0x20;
        assert_eq!(media_only(Kind::Video, only_padding), None);
        assert!(media_only(Kind::Audio, pkt(113, &[1])).is_some());
        assert_eq!(media_only(Kind::Audio, pkt(0, &[1])), None);
    }

    #[test]
    fn depacketizes_zalo_and_rfc6184_h264() {
        let au = [0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4, 5, 6];
        let mut d = H264Depacketizer::default();
        // packetMode 2, one packet
        assert_eq!(d.push(&rtp(1, true, &au)).unwrap(), au);
        // packetMode 2, chunks behind 1C 80 / 1C 00 / 1C 40
        assert_eq!(d.push(&rtp(2, false, &[&[0x1c, 0x80][..], &au[..7]].concat())), None);
        assert_eq!(d.push(&rtp(3, false, &[&[0x1c, 0x00][..], &au[7..14]].concat())), None);
        assert_eq!(d.push(&rtp(4, true, &[&[0x1c, 0x40][..], &au[14..]].concat())).unwrap(), au);
        // RFC 6184: STAP-A(SPS, PPS) then FU-A(IDR)
        assert_eq!(d.push(&rtp(5, false, &[0x78, 0, 3, 0x67, 1, 2, 0, 2, 0x68, 3])), None);
        assert_eq!(d.push(&rtp(6, false, &[0x7c, 0x85, 4, 5])), None);
        assert_eq!(d.push(&rtp(7, true, &[0x7c, 0x45, 6])).unwrap(), au);
        // sequence gap from dropped FEC packet does not drop subsequent frame
        assert_eq!(d.push(&rtp(9, true, &[0x41, 9])).unwrap(), [0, 0, 0, 1, 0x41, 9]);
        // gap mid-FU-A drops only that corrupt FU-A fragment
        assert_eq!(d.push(&rtp(10, false, &[0x7c, 0x85, 1, 2])), None);
        assert_eq!(d.push(&rtp(12, true, &[0x7c, 0x45, 3])), None); // gap at 11!
        assert_eq!(d.push(&rtp(13, true, &[0x41, 13])).unwrap(), [0, 0, 0, 1, 0x41, 13]);
    }

    #[test]
    fn packetizes_like_the_phone_and_back() {
        let mut pay = H264Packetizer { ssrc: 7, seq: 0xffff };
        let mut d = H264Depacketizer::default();
        // delta AU that fits: raw in one packet on 97, marker set
        let small = [0, 0, 0, 1, 0x41, 9, 9];
        let p = pay.packetize(&small, 90, false);
        assert_eq!((p.len(), p[0][1], &p[0][12..]), (1, 0x80 | VIDEO_PT, &small[..]));
        assert_eq!(d.push(&media_only(Kind::Video, p[0].clone()).unwrap()).unwrap(), small);
        // keyframe over 1200 bytes: equal chunks on 98 behind 1C 80 / 1C 00 / 1C 40, marker on the last
        let big: Vec<u8> = [0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x65].into_iter().chain((0..3000).map(|i| (i % 251) as u8)).collect();
        let p = pay.packetize(&big, 180, true);
        assert_eq!(p.len(), 3);
        assert_eq!(p.iter().map(|p| (p[1], p[12], p[13])).collect::<Vec<_>>(), [(VIDEO_KEY_PT, 0x1c, 0x80), (VIDEO_KEY_PT, 0x1c, 0), (0x80 | VIDEO_KEY_PT, 0x1c, 0x40)]);
        assert_eq!((&p[0][2..4], &p[2][2..4]), (&[0, 0][..], &[0, 2][..])); // seq wrapped after the 0xffff above
        let out: Vec<_> = p.into_iter().filter_map(|p| d.push(&media_only(Kind::Video, p).unwrap())).collect();
        assert_eq!(out, [big]);
    }

    #[test]
    fn pipelines_parse() {
        if gst::init().is_err() {
            return;
        }
        // descriptions must be valid for the installed elements (devices are not opened before Playing)
        for desc in [audio_recv_desc(), audio_send_desc(7), video_recv_desc(), video_send_desc()] {
            launch(&desc, "test").unwrap_or_else(|e| panic!("{e}: {desc}"));
        }
    }
}
