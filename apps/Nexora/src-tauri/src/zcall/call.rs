//! The call state machine ZaloCall runs (docs/data/call-signaling.md §5–§7, call-port-answers.md): it names each
//! HTTP signal for the host to send (sendSignal), reads the decoded replies (recvSignal) and the partner's WS pushes
//! (control), and drives the relay session, media and window itself.

use std::cell::RefCell;
use std::rc::{Rc, Weak};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use gtk::glib;
use gtk::prelude::*;
use serde_json::{json, Value};

use super::ipc::Ipc;
use super::media::{Frame, Media, Tone, AUDIO_PT, VIDEO_PT};
use super::rtcp::{self, RecvStats};
use super::srtp::Srtp;
use super::ui::Ui;
use super::zrtp::{Kind, Packet, Relay};

pub enum Event {
    Host(Value),
    HostGone,
    Init { result: u32, token: u32 },
    Frame(Frame),
}
pub type Tx = glib::Sender<Event>;

// ---- what ZaloCall puts on the wire (docs/data/call-port-answers.md "Port constants")
/// makeCall / 401 type
const TYPE_VOICE: u64 = 1;
const TYPE_VIDEO: u64 = 3;
/// 402 answer status: 0 accepted (voice or video), 1 busy, 3 rejected, 5 the callee's InitCall failed
const ANSWER_OK: i64 = 0;
const ANSWER_BUSY: i64 = 1;
const ANSWER_REJECT: i64 = 3;
const ANSWER_INIT_FAILED: i64 = 5;
/// 406 logendcall status (meanings inferred from where ZaloCall uses them)
const LOG_ENDED: i64 = 0;
const LOG_NO_RESPONSE: i64 = 101;
const LOG_NEVER_RANG: i64 = 103;
const LOG_NO_ANSWER: i64 = 104;
const LOG_BUSY: i64 = 105;
const LOG_REJECTED: i64 = 106;
const LOG_CALLEE_FAILED: i64 = 107;
const LOG_CANCELLED: i64 = 158;
const LOG_MISSED: i64 = 159;
const LOG_DECLINED: i64 = 160;
const LOG_NOT_CONNECTED: i64 = 161;
/// ZCallConstParam: 45 s to answer, 15 s to 416, 15 s from 416 to ring_ring, 30 s from 416 to in-call
const ANSWER_TIMEOUT: Duration = Duration::from_secs(45);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const RING_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const INIT_TRIES: u32 = 10;
/// the audio codec every Zalo client offers (CallController::reset); a match needs this exact name and payload
const OPUS: &str = "opus/16000/1";

#[derive(PartialEq, Clone, Copy, Debug)]
enum Stage {
    /// caller: 401 sent; callee: ringing
    Starting,
    /// relay session being set up, or (caller) 416 sent and waiting for the answer
    Connecting,
    Live,
}

struct Up {
    relay: Arc<Relay>,
    audio: Option<Srtp>,
    video: Option<Srtp>,
}

struct Down {
    /// our SSRC
    me: u32,
    media: Arc<Media>,
    audio: Option<Srtp>,
    video: Option<Srtp>,
    /// packets in, and those SRTP refused (a key/mode mismatch shows here)
    received: u64,
    refused: u64,
    /// payload types that came in, "a112" / "v97" → count
    types: std::collections::BTreeMap<String, u64>,
    /// incoming audio, video: what our receiver reports describe
    stats: [RecvStats; 2],
    /// what the partner's reports say of our audio, video (fraction lost /256, cumulative lost, highest seq)
    seen: [Option<(u8, i32, u32)>; 2],
    keyframe_requests: u64,
    /// RTCP ticks, and the decoded frame count at the last PLI check
    ticks: u32,
    frames_seen: u64,
}

struct Call {
    id: u32,
    caller: bool,
    video: bool,
    /// the partner as the signals name it (calleeId / callerId / toId)
    peer: Value,
    /// ids on the relay; ours is also the SSRC
    me_z: u32,
    peer_z: u32,
    sess: String,
    zrtc: Value,
    partner_ext: Value,
    servers: Vec<(String, String)>,
    server: usize,
    /// rtp, rtcp of the relay in use
    relay_addr: (String, String),
    relay: Option<Arc<Relay>>,
    init_tries: u32,
    stage: Stage,
    sent_416: bool,
    rang: bool,
    /// callee: 402 sent here, and its answer_ack
    answered_here: bool,
    acked: bool,
    started: Option<Instant>,
    mic: bool,
    camera: bool,
    media: Option<Arc<Media>>,
    down: Arc<Mutex<Option<Down>>>,
    tone: Option<Tone>,
    ui: Ui,
}

pub struct Engine {
    ipc: Arc<Ipc>,
    tx: Tx,
    call: Option<Call>,
    me: Weak<RefCell<Engine>>,
}

// call pushes carry nested JSON either as objects or as strings
fn obj(v: &Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        v => v.clone(),
    }
}

fn num(v: &Value) -> u64 {
    v.as_u64().or_else(|| v.as_str()?.trim().parse().ok()).unwrap_or(0)
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        v => v.to_string(),
    }
}

fn servers(v: &Value) -> Vec<(String, String)> {
    let addr = |s: &Value, a: &str, b: &str| text(s.get(a).or_else(|| s.get(b)).unwrap_or(&Value::Null));
    obj(v).as_array().into_iter().flatten().map(|s| (addr(s, "rtpaddr", "rtp"), addr(s, "rtcpaddr", "rtcp"))).filter(|s| !s.0.is_empty()).collect()
}

/// jsoncpp FastWriter, as ZaloCall writes codec / extendData: keys sorted, plus the trailing newline
fn fast_writer(v: &Value) -> String {
    v.to_string() + "\n"
}

fn new_call_id() -> u32 {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    ((t.subsec_nanos() ^ std::process::id().rotate_left(16) ^ t.as_secs() as u32) & 0x7fff_ffff).max(1)
}

/// Runs `f` on the engine from the main loop, outside whatever borrow the emitting code holds.
fn later<W: Clone + 'static>(engine: &Weak<RefCell<Engine>>, f: impl Fn(&mut Engine, &W) + 'static) -> impl Fn(&W) + 'static {
    let (engine, f) = (engine.clone(), Rc::new(f));
    move |w: &W| {
        let (engine, f, w) = (engine.clone(), f.clone(), w.clone());
        glib::idle_add_local_once(move || {
            if let Some(e) = engine.upgrade() {
                f(&mut e.borrow_mut(), &w);
            }
        });
    }
}

impl Engine {
    pub fn new(ipc: Arc<Ipc>, tx: Tx) -> Rc<RefCell<Engine>> {
        Rc::new_cyclic(|me| RefCell::new(Engine { ipc, tx, call: None, me: me.clone() }))
    }

    pub fn handle(engine: &Rc<RefCell<Engine>>, event: Event) {
        let mut e = engine.borrow_mut();
        match event {
            Event::Host(v) => e.on_host(&v),
            Event::HostGone => {
                e.hang_up();
                gtk::main_quit();
            }
            Event::Init { result, token } => e.on_init(result, token),
            Event::Frame(f) => {
                if let Some(c) = &e.call {
                    c.ui.show(f);
                }
            }
        }
    }

    fn on_host(&mut self, v: &Value) {
        say!("zcall: host {} {} {}", v["type"], v["command"], v["data"]["act"]);
        match (v["type"].as_str().unwrap_or(""), v["command"].as_str()) {
            ("update", Some("init")) => super::set_log_file(v["data"]["logPath"].as_str().unwrap_or("/tmp/nexora-call.log")),
            ("request", Some("makeCall")) => self.make_call(&v["data"]),
            ("request", Some("endCall" | "bye")) => self.hang_up(),
            ("control", _) => self.on_control(&v["data"]),
            ("recvSignal", _) if num(&v["command"]) == 401 => self.on_401(&v["data"]),
            // init / updateLocal / listDevice / advancedOptions / responses: nothing this port uses
            _ => {}
        }
    }

    fn send_signal(&self, command: u32, data: Value) {
        self.ipc.send(&json!({ "type": "sendSignal", "command": command, "data": data }));
    }

    fn set_busy(&self, on: bool) {
        self.ipc.send(&json!({ "type": "update", "command": "callState", "data": { "state": if on { "incall" } else { "free" } } }));
    }

    /// `f` after `d`, if this call is still the current one.
    fn after(&self, d: Duration, f: impl FnOnce(&mut Engine) + 'static) {
        let (engine, id) = (self.me.clone(), self.call.as_ref().map(|c| c.id));
        glib::timeout_add_local_once(d, move || {
            if let Some(e) = engine.upgrade() {
                let mut e = e.borrow_mut();
                if e.call.as_ref().map(|c| c.id) == id {
                    f(&mut e);
                }
            }
        });
    }

    /// `f` every `d` while this call lasts and `f` says so.
    fn every(&self, d: Duration, f: impl Fn(&mut Engine) -> bool + 'static) {
        let (engine, id) = (self.me.clone(), self.call.as_ref().map(|c| c.id));
        glib::timeout_add_local(d, move || {
            let Some(e) = engine.upgrade() else { return glib::ControlFlow::Break };
            let mut e = e.borrow_mut();
            if e.call.as_ref().map(|c| c.id) == id && f(&mut e) {
                glib::ControlFlow::Continue
            } else {
                glib::ControlFlow::Break
            }
        });
    }

    fn new_call(id: u32, caller: bool, video: bool, peer: Value, name: &str) -> Call {
        Call {
            id,
            caller,
            video,
            peer,
            me_z: 0,
            peer_z: 0,
            sess: String::new(),
            zrtc: Value::Null,
            partner_ext: Value::Null,
            servers: Vec::new(),
            server: 0,
            relay_addr: Default::default(),
            relay: None,
            init_tries: 0,
            stage: Stage::Starting,
            sent_416: false,
            rang: false,
            answered_here: false,
            acked: false,
            started: None,
            mic: true,
            camera: video,
            media: None,
            down: Default::default(),
            tone: if caller { None } else { Tone::play("phone-incoming-call") },
            ui: Ui::new(name, video, !caller),
        }
    }

    fn open_window(&mut self, call: Call) {
        let ui = &call.ui;
        ui.accept.connect_clicked(later(&self.me, |e, _| e.accept(true)));
        ui.accept_video.connect_clicked(later(&self.me, |e, _| e.accept(true)));
        ui.reject.connect_clicked(later(&self.me, |e, _| e.reject()));
        ui.hang_up.connect_clicked(later(&self.me, |e, _| e.hang_up()));
        ui.mic_off.connect_toggled(later(&self.me, |e, b: &gtk::ToggleButton| e.set_mic(!b.is_active())));
        ui.cam_off.connect_toggled(later(&self.me, |e, b: &gtk::ToggleButton| e.set_camera(!b.is_active())));
        let close = later(&self.me, |e, _: &()| e.hang_up());
        ui.window.connect_delete_event(move |_, _| {
            close(&());
            glib::Propagation::Stop
        });
        self.call = Some(call);
        self.set_busy(true);
    }

    // ---- outgoing: makeCall → 401 → relay token → 416 → ring_ring → answer → 408 → media

    fn make_call(&mut self, data: &Value) {
        if self.call.is_some() {
            return;
        }
        let partner = &data["partner"][0];
        let video = num(&data["type"]) == TYPE_VIDEO;
        let call = Self::new_call(new_call_id(), true, video, Value::String(text(&partner["id"])), &text(&partner["name"]));
        call.ui.status("Đang gọi…");
        let (id, peer) = (call.id, call.peer.clone());
        self.open_window(call);
        // the 401 codec is "[]": ZaloCall sends it before its controller has a codec list
        self.send_signal(401, json!({ "calleeId": peer, "callId": id, "codec": "[]\n", "type": if video { TYPE_VIDEO } else { TYPE_VOICE } }));
        self.after(REQUEST_TIMEOUT, |e| {
            let Some(stage) = e.call.as_ref().filter(|c| !c.sent_416).map(|c| c.stage) else { return };
            e.finish("Không thể thực hiện cuộc gọi", Some(if stage == Stage::Starting { LOG_NO_RESPONSE } else { LOG_NEVER_RANG }));
        });
    }

    fn on_401(&mut self, d: &Value) {
        let Some(c) = self.call.as_mut().filter(|c| c.caller && c.stage == Stage::Starting) else { return };
        c.sess = text(&d["sessId"]);
        c.me_z = num(&d["fromId"]) as u32;
        c.peer_z = num(&d["toId"]) as u32;
        c.zrtc = obj(&d["zrtc_config"]);
        c.servers = servers(&d["servers"]);
        if c.sess.is_empty() || c.servers.is_empty() {
            say!("zcall: 401 without session/servers: {d}");
            return self.finish("Không thể thực hiện cuộc gọi", Some(LOG_NO_RESPONSE));
        }
        c.stage = Stage::Connecting;
        c.ui.status("Đang kết nối…");
        let first = c.servers[0].clone();
        self.connect(first);
    }

    // ---- incoming: request → 407 → (accept) relay token → 402, every 3 s until answer_ack → media

    fn incoming(&mut self, d: &Value, busy: bool) {
        // the call itself sits in params (a JSON string); ids at the top
        let params = obj(&d["params"]);
        let field = |k: &str| if params[k].is_null() { d[k].clone() } else { params[k].clone() };
        // the signals name the caller by uidN, the noised uid chat uses (ZCallInfo::receiveIncomingCall passes
        // ZIncomingCallInfo+0x40 = "uidN" to 407/402); uidFrom is the relay id, and Zalo answers 114 to it
        let peer = Value::String(text(if d["uidN"].is_null() { &d["uidFrom"] } else { &d["uidN"] }));
        let (id, sess) = (num(&field("id")) as u32, text(&field("sessId")));
        say!("zcall: incoming call {id} from {peer}");
        if busy {
            // already in a call: ZaloCall answers busy itself, with no codec, extendData or relay
            let data = json!({ "callerId": peer, "callId": id, "status": ANSWER_BUSY, "codec": "", "rtpAddress": "", "rtcpAddress": "", "session": sess });
            return self.send_signal(402, data);
        }
        let ext = obj(&field("extendData"));
        let video = num(&ext["callType"]) == 1
            || num(&field("callType")) == 1
            || num(&field("type")) == 3
            || num(&field("typeRequest")) == 3
            || num(&field("video")["enable"]) == 1;
        let mut call = Self::new_call(id, false, video, peer, &text(&field("Dname")));
        call.me_z = num(&d["uidTo"]) as u32;
        call.peer_z = num(&d["uidFrom"]) as u32;
        call.sess = sess;
        call.zrtc = obj(&field("zrtc_config"));
        call.partner_ext = ext;
        call.servers = servers(&field("servers"));
        // the callee goes straight to the caller's relay
        call.relay_addr = (text(&field("rtpIP")), text(&field("rtcpIP")));
        call.ui.status(if video { "Cuộc gọi video đến" } else { "Cuộc gọi thoại đến" });
        let (id, peer) = (call.id, call.peer.clone());
        self.open_window(call);
        self.send_signal(407, json!({ "callerId": peer, "callId": id }));
        self.after(ANSWER_TIMEOUT, |e| {
            if e.call.as_ref().is_some_and(|c| c.stage == Stage::Starting) {
                e.finish("Cuộc gọi nhỡ", Some(LOG_MISSED));
            }
        });
    }

    fn accept(&mut self, camera: bool) {
        let Some(c) = self.call.as_mut().filter(|c| !c.caller && c.stage == Stage::Starting) else { return };
        c.tone = None;
        c.camera = camera;
        c.stage = Stage::Connecting;
        c.ui.connected();
        c.ui.cam_off.set_active(!camera);
        c.ui.status("Đang kết nối…");
        let server = if c.relay_addr.0.is_empty() { c.servers.first().cloned().unwrap_or_default() } else { c.relay_addr.clone() };
        self.connect(server);
    }

    fn reject(&mut self) {
        let Some(c) = self.call.as_ref().filter(|c| !c.caller && c.stage == Stage::Starting) else { return };
        let data = json!({ "callerId": c.peer, "callId": c.id, "status": ANSWER_REJECT, "codec": "", "rtpAddress": "", "rtcpAddress": "", "session": c.sess });
        self.send_signal(402, data);
        self.finish("Bạn đã từ chối", Some(LOG_DECLINED));
    }

    // ---- relay session

    fn connect(&mut self, server: (String, String)) {
        let Some(c) = self.call.as_mut() else { return };
        let relay = match Relay::open(&server.0, &server.1, c.me_z, &c.sess) {
            Ok(r) => r,
            Err(e) => {
                say!("zcall: relay {}: {e}", server.0);
                return self.relay_failed();
            }
        };
        let (tx, down) = (self.tx.clone(), c.down.clone());
        relay.listen(move |result, token| drop(tx.send(Event::Init { result, token })), move |p| deliver(&down, p));
        c.relay = Some(relay);
        c.relay_addr = server;
        c.init_tries = 0;
        // InitCall until the relay answers (ZaloCall: every 1000 ms)
        self.every(Duration::from_secs(1), |e| {
            let Some(c) = e.call.as_mut() else { return false };
            let Some(relay) = c.relay.clone().filter(|r| r.token.load(Ordering::Relaxed) == 0) else { return false };
            if c.init_tries >= INIT_TRIES {
                e.relay_failed();
                return false;
            }
            c.init_tries += 1;
            relay.init_call(c.caller, c.id, c.peer_z);
            true
        });
    }

    fn relay_failed(&mut self) {
        let Some(c) = self.call.as_mut() else { return };
        if let Some(relay) = c.relay.take() {
            relay.close(c.id);
        }
        if c.caller && c.server + 1 < c.servers.len() {
            c.server += 1;
            let next = c.servers[c.server].clone();
            return self.connect(next);
        }
        if c.caller {
            return self.finish("Không thể kết nối cuộc gọi", Some(LOG_NEVER_RANG));
        }
        let data = json!({ "callerId": c.peer, "callId": c.id, "status": ANSWER_INIT_FAILED, "codec": "", "rtpAddress": "", "rtcpAddress": "", "session": c.sess });
        self.send_signal(402, data);
        self.finish("Không thể kết nối cuộc gọi", Some(LOG_NOT_CONNECTED));
    }

    fn on_init(&mut self, result: u32, token: u32) {
        let Some(c) = self.call.as_mut() else { return };
        let Some(relay) = c.relay.clone() else { return };
        // retries are answered too: the first answer counts
        if relay.token.load(Ordering::Relaxed) != 0 {
            return;
        }
        if result != 0 || token == 0 {
            say!("zcall: InitCall refused by {} ({result})", c.relay_addr.0);
            c.init_tries = INIT_TRIES;
            return;
        }
        relay.token.store(token, Ordering::Relaxed);
        self.every(Duration::from_secs(6), move |_| {
            relay.ping();
            true
        });
        let caller = self.call.as_ref().is_some_and(|c| c.caller);
        if caller {
            let c = self.call.as_mut().unwrap();
            c.sent_416 = true;
            c.ui.status("Đang đổ chuông…");
            let data = signal_with_relay(c, json!({ "calleeId": c.peer }));
            self.send_signal(416, data);
            self.after(RING_TIMEOUT, |e| {
                if e.call.as_ref().is_some_and(|c| !c.rang) {
                    e.hang_up();
                }
            });
            self.after(CONNECT_TIMEOUT, |e| {
                if e.call.as_ref().is_some_and(|c| c.stage != Stage::Live) {
                    e.hang_up();
                }
            });
        } else {
            self.call.as_mut().unwrap().answered_here = true;
            self.start_media();
            // the accept goes out now and again every 3 s until answer_ack, as ZaloCall does
            let answer = |e: &mut Engine| {
                let Some(c) = e.call.as_ref().filter(|c| !c.acked) else { return false };
                let data = signal_with_relay(c, json!({ "callerId": c.peer, "status": ANSWER_OK }));
                e.send_signal(402, data);
                true
            };
            answer(self);
            self.every(Duration::from_secs(3), answer);
        }
    }

    // ---- pushes from the partner

    fn on_control(&mut self, control: &Value) {
        let act = control["act"].as_str().unwrap_or("");
        let d = obj(&control["data"]);
        if act == "request" {
            match (&self.call, control["inCallStatus"].as_str()) {
                // this engine is in a call: ZaloCall sends nothing, the caller times out
                (Some(_), _) | (None, Some("zavi")) => {}
                (None, status) => self.incoming(&d, status == Some("zalo")),
            }
            return;
        }
        let Some(c) = self.call.as_mut() else { return };
        let id = num(d.get("callId").or_else(|| d.get("id")).unwrap_or(&Value::Null));
        if id != 0 && id as u32 != c.id {
            return;
        }
        match act {
            "ring_ring" if c.caller && c.stage != Stage::Live => {
                c.rang = true;
                c.ui.status("Đang đổ chuông…");
                c.tone = c.tone.take().or_else(|| Tone::play("phone-outgoing-calling"));
            }
            "answer" if c.caller && c.stage != Stage::Live => match num(&d["status"]) as i64 {
                ANSWER_OK => {
                    // codec / extendData / platform travel in params, a JSON string
                    c.partner_ext = obj(&obj(&d["params"])["extendData"]);
                    let data = json!({ "calleeId": c.peer, "callId": c.id });
                    self.send_signal(408, data);
                    self.start_media();
                }
                ANSWER_BUSY => {
                    self.cancel();
                    self.finish("Người nhận bận", Some(LOG_BUSY));
                }
                ANSWER_REJECT => self.finish("Người nhận từ chối", Some(LOG_REJECTED)),
                ANSWER_INIT_FAILED => self.finish("Không thể kết nối cuộc gọi", Some(LOG_CALLEE_FAILED)),
                _ => self.finish("Cuộc gọi đã kết thúc", Some(LOG_NO_ANSWER)),
            },
            // this account picked the call up on another device
            "answer" if !c.caller && !c.answered_here => self.finish("Đã trả lời trên thiết bị khác", None),
            "answer_ack" if !c.caller => c.acked = true,
            "cancel" | "end_call" => {
                let (reason, status) = match (c.stage, c.caller) {
                    (Stage::Live, _) => ("Cuộc gọi đã kết thúc", LOG_ENDED),
                    (_, true) => ("Người nhận từ chối", LOG_REJECTED),
                    (Stage::Starting, false) => ("Cuộc gọi nhỡ", LOG_CANCELLED),
                    _ => ("Cuộc gọi đã kết thúc", LOG_NOT_CONNECTED),
                };
                self.finish(reason, Some(status));
            }
            "onoff_camera" => {
                let params = obj(&d["params"]);
                let on = num(&params["type"]) == 1 || num(&d["isOnCam"]) == 1;
                say!("zcall: partner camera {}", if on { "on" } else { "off" });
                if on && c.video {
                    if let Some(relay) = &c.relay {
                        relay.rtcp(Kind::Video, &rtcp::report(c.me_z, None, Some(c.peer_z)));
                    }
                }
            }
            _ => {}
        }
    }

    // ---- media

    fn start_media(&mut self) {
        let Some(c) = self.call.as_mut() else { return };
        let Some(relay) = c.relay.clone() else { return };
        let mode = local_srtp_mode(c);
        // ZaloCall keeps SRTP only when the partner's extendData names the same srtpMode
        let key = (mode > 0 && c.partner_ext["srtpMode"].as_i64() == Some(mode)).then(|| srtp_key(c)).flatten();
        let no_seq = num(&c.zrtc["srtpNoSeq"]) != 0;
        let make = || key.as_ref().and_then(|k| Srtp::new(k, mode, no_seq));
        say!("zcall: media, srtp mode {}", if key.is_some() { mode } else { 0 });
        let mut zrtc = c.zrtc.clone();
        if zrtc.get("srtpKey").is_some() {
            zrtc["srtpKey"] = json!("…");
        }
        say!("zcall: me {} peer {} relay {:?} video {} | partner extendData {} | zrtc_config {zrtc}", c.me_z, c.peer_z, c.relay_addr, c.video, c.partner_ext);
        let sent: Arc<[std::sync::atomic::AtomicU64; 2]> = Default::default();
        let sent_up = sent.clone();
        let up = Mutex::new(Up { relay: relay.clone(), audio: make(), video: make() });
        let frames = Mutex::new(self.tx.clone());
        let started = Media::start(
            c.video,
            c.me_z,
            Arc::new(move |kind, rtp| {
                let mut up = up.lock().unwrap();
                let srtp = if kind == Kind::Audio { up.audio.as_mut() } else { up.video.as_mut() };
                let packet = match srtp {
                    Some(s) => s.protect(&rtp),
                    None => Some(rtp),
                };
                if let Some(p) = packet {
                    sent_up[kind as usize].fetch_add(1, Ordering::Relaxed);
                    up.relay.media(kind, &p);
                }
            }),
            Arc::new(move |f| drop(frames.lock().unwrap().send(Event::Frame(f)))),
        );
        let c = self.call.as_mut().unwrap();
        match started {
            Ok(media) => {
                let media = Arc::new(media);
                media.set_camera(c.camera);
                media.set_mic(c.mic);
                *c.down.lock().unwrap() = Some(Down {
                    me: c.me_z,
                    media: media.clone(),
                    audio: make(),
                    video: make(),
                    received: 0,
                    refused: 0,
                    types: Default::default(),
                    stats: Default::default(),
                    seen: [None; 2],
                    keyframe_requests: 0,
                    ticks: 0,
                    frames_seen: 0,
                });
                c.media = Some(media);
            }
            Err(e) => {
                say!("zcall: media: {e}");
                return self.hang_up();
            }
        }
        c.tone = None;
        c.stage = Stage::Live;
        c.started = Some(Instant::now());
        c.ui.connected();
        c.ui.status("00:00");
        if c.video {
            self.send_conf();
        }
        // receiver reports on both streams, twice per second of the partner's one-second rating; a PLI (behind the
        // RR, see rtcp.rs) every second no partner frame decodes, which also covers the IDR lost before media started
        self.every(Duration::from_millis(500), move |e| {
            let Some(c) = e.call.as_ref() else { return false };
            let mut down = c.down.lock().unwrap();
            let Some(d) = down.as_mut() else { return false };
            d.ticks += 1;
            relay.rtcp(Kind::Audio, &rtcp::report(c.me_z, d.stats[0].block(), None));
            if c.video {
                let frames = d.media.remote_frames();
                let pli = (d.ticks % 2 == 0 && frames == d.frames_seen).then(|| d.stats[1].ssrc().unwrap_or(c.peer_z));
                if d.ticks % 2 == 0 {
                    d.frames_seen = frames;
                }
                relay.rtcp(Kind::Video, &rtcp::report(c.me_z, d.stats[1].block(), pli));
            }
            if d.ticks % 4 == 0 {
                say!(
                    "zcall: in {:?} refused {} | video AUs {} decoded {} | out a{} v{} | partner saw a{:?} v{:?} | keyframe requests {}",
                    d.types,
                    d.refused,
                    d.media.aus(),
                    d.media.remote_frames(),
                    sent[0].load(Ordering::Relaxed),
                    sent[1].load(Ordering::Relaxed),
                    d.seen[0],
                    d.seen[1],
                    d.keyframe_requests
                );
            }
            true
        });
        self.every(Duration::from_secs(1), |e| {
            let Some((secs, ui)) = e.call.as_ref().and_then(|c| Some((c.started?.elapsed().as_secs(), &c.ui))) else { return false };
            ui.status(&format!("{:02}:{:02}", secs / 60, secs % 60));
            true
        });
    }

    fn set_mic(&mut self, on: bool) {
        let Some(c) = self.call.as_mut() else { return };
        c.mic = on;
        c.media.iter().for_each(|m| m.set_mic(on));
        self.send_conf();
    }

    fn set_camera(&mut self, on: bool) {
        let Some(c) = self.call.as_mut() else { return };
        c.camera = on;
        c.media.iter().for_each(|m| m.set_camera(on));
        self.send_conf();
    }

    /// 12006: the partner's window shows our mic / camera state. Despite its name `isOnMic` is the mute flag:
    /// ZCallInfo::UiMuteEvent(mute) @0x1000d2730 sends isOnMic = mute, UiOnOffCameraEvent(on) sends isOnCam = on.
    fn send_conf(&self) {
        let Some(c) = self.call.as_ref().filter(|c| c.stage == Stage::Live) else { return };
        let data = json!({ "calleeId": c.peer, "callId": c.id, "isOnCam": u8::from(c.camera), "isOnMic": u8::from(!c.mic), "data": "" });
        self.send_signal(12006, data);
    }

    // ---- ending

    /// 405, the caller's cancel, only once the callee has heard of the call (416 sent)
    fn cancel(&self) {
        if let Some(c) = self.call.as_ref().filter(|c| c.caller && c.sent_416) {
            self.send_signal(405, json!({ "toId": c.peer, "callId": c.id, "callType": u8::from(c.video) }));
        }
    }

    /// "Kết thúc", closing the window, timeouts, the host's endCall: 405 before the call is up, 402 status 3 for a
    /// callee still ringing, 409 after.
    fn hang_up(&mut self) {
        let Some(c) = self.call.as_ref() else { return };
        let status = match (c.caller, c.stage) {
            (_, Stage::Live) => {
                self.send_signal(409, json!({ "toId": c.peer, "callId": c.id }));
                LOG_ENDED
            }
            (false, Stage::Starting) => return self.reject(),
            (false, _) => {
                self.send_signal(409, json!({ "toId": c.peer, "callId": c.id }));
                LOG_NOT_CONNECTED
            }
            (true, _) => {
                self.cancel();
                if c.rang { LOG_NO_ANSWER } else { LOG_NEVER_RANG }
            }
        };
        self.finish("Cuộc gọi đã kết thúc", Some(status));
    }

    fn finish(&mut self, reason: &str, log_status: Option<i64>) {
        let Some(c) = self.call.take() else { return };
        if let Some(relay) = &c.relay {
            relay.close(c.id);
        }
        if let Some(d) = c.down.lock().unwrap().take() {
            say!("zcall: call {} received {} media packets, {} refused by SRTP, payload types {:?}", c.id, d.received, d.refused, d.types);
            say!(
                "zcall: partner frames decoded {}; partner saw our audio {:?}, video {:?} (lost/256, lost, highest seq); {} keyframe requests",
                d.media.remote_frames(),
                d.seen[0],
                d.seen[1],
                d.keyframe_requests
            );
        }
        if let Some(status) = log_status {
            let duration = c.started.map_or(0, |t| t.elapsed().as_secs());
            let log = json!({ "callId": c.id, "partnerId": c.peer, "status": status, "role": c.caller, "data": "{}", "duration": duration });
            self.send_signal(406, log);
        }
        c.ui.finished(reason);
        let window = c.ui.window.clone();
        // SAFETY: nothing touches the window after this; its handlers only hold a Weak to the engine
        glib::timeout_add_local_once(Duration::from_millis(1500), move || unsafe { window.destroy() });
        drop(c);
        self.set_busy(false);
    }
}

fn deliver(down: &Mutex<Option<Down>>, p: Packet) {
    let mut down = down.lock().unwrap();
    let Some(d) = down.as_mut() else { return };
    let (kind, payload) = match p {
        Packet::Media(kind, payload) => (kind, payload),
        // plain: we advertise srtcp 0, so a Zalo partner drops SRTCP too (call-media.md §3 B.1)
        Packet::Rtcp(kind, payload) => {
            let f = rtcp::parse(payload, d.me);
            let n = d.types.entry(format!("{}rtcp", if kind == Kind::Audio { 'a' } else { 'v' })).or_default();
            *n += 1;
            if *n <= 3 {
                say!("zcall: {kind:?} rtcp in {} → {f:?}", hex(payload));
            }
            if f.seen.is_some() {
                d.seen[kind as usize] = f.seen;
            }
            if f.keyframe && kind == Kind::Video {
                d.keyframe_requests += 1;
                d.media.force_keyframe();
            }
            return;
        }
        _ => return,
    };
    d.received += 1;
    let srtp = if kind == Kind::Audio { d.audio.as_mut() } else { d.video.as_mut() };
    let rtp = match srtp {
        Some(s) => s.unprotect(payload),
        None => Some(payload.to_vec()),
    };
    match rtp {
        Some(rtp) => {
            d.stats[kind as usize].update(&rtp);
            let key = format!("{}{}", if kind == Kind::Audio { 'a' } else { 'v' }, rtp.get(1).map_or(0, |b| b & 0x7f));
            let n = d.types.entry(key).or_default();
            *n += 1;
            if *n <= 3 {
                say!("zcall: {kind:?} rtp in {} bytes: {}", rtp.len(), hex(&rtp));
            }
            d.media.push(kind, rtp);
        }
        None => {
            d.refused += 1;
            if d.refused <= 3 {
                say!("zcall: {kind:?} refused by SRTP: {}", hex(payload));
            }
        }
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().take(40).map(|x| format!("{x:02x}")).collect()
}

// ---- negotiation values

/// The 416 / 402 payload naming our relay, codec and capabilities, plus `extra`.
fn signal_with_relay(c: &Call, extra: Value) -> Value {
    let mut data = json!({
        "callId": c.id, "rtpAddress": c.relay_addr.0, "rtcpAddress": c.relay_addr.1,
        "codec": fast_writer(&json!([audio_codec()])), "extendData": extend_data(c), "session": c.sess,
    });
    if let (Some(data), Some(extra)) = (data.as_object_mut(), extra.as_object()) {
        data.extend(extra.clone());
    }
    data
}

/// AudioCodecItem: the offer in 416, and the matched item in 402
fn audio_codec() -> Value {
    json!({ "dynamicFptime": 0, "frmPtime": 20, "name": OPUS, "payload": AUDIO_PT })
}

fn local_srtp_mode(c: &Call) -> i64 {
    let mode = c.zrtc["srtpMode"].as_i64().unwrap_or(0);
    if (1..=3).contains(&mode) && srtp_key(c).is_some() { mode } else { 0 }
}

/// zrtc_config.srtpKey, else the first 30 bytes of sessId (CallController::parseCallConfig)
fn srtp_key(c: &Call) -> Option<Vec<u8>> {
    let key = c.zrtc["srtpKey"].as_str().filter(|k| !k.is_empty()).unwrap_or(&c.sess).as_bytes();
    key.get(..30).map(<[u8]>::to_vec)
}

/// CallController::getExtendData, minus what this port doesn't do: GCC (gccMode 0 turns the partner's off), P2P,
/// SRTCP, TCP relays, two-sided server choice (serverAddr names the relay in use so the caller stays on it).
/// packetMode 2 is the default both sides fall back to; Zalo receivers also take the RFC 6184 we send.
fn extend_data(c: &Call) -> String {
    fast_writer(&json!({
        "callType": u8::from(c.video),
        "gccMode": 0,
        "newZrtc": 1,
        "packetMode": 2,
        "platform": 2,
        "sP2P": 0,
        "serverAddr": [{ "rtcp": c.relay_addr.1, "rtp": c.relay_addr.0, "tpType": 0 }],
        "spTcp": 0,
        "srtcp": 0,
        "srtpMode": local_srtp_mode(c),
        "supportCallBusy": 0,
        "supportHevcDecode": 0,
        "tpType": 0,
        "video": { "codec": [{ "name": "h264", "payload": VIDEO_PT }] },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiation_strings_match_zalocall() {
        // FastWriter order: keys sorted, trailing newline
        assert_eq!(fast_writer(&json!([audio_codec()])), "[{\"dynamicFptime\":0,\"frmPtime\":20,\"name\":\"opus/16000/1\",\"payload\":112}]\n");
        assert_eq!(servers(&json!("[{\"rtpaddr\":\"1.2.3.4:8020\",\"rtcpaddr\":\"1.2.3.4:4004\"}]")), [("1.2.3.4:8020".into(), "1.2.3.4:4004".into())]);
        assert_eq!(num(&json!("1334616830")), 1334616830);
    }
}
