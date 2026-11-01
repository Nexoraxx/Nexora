//! Zalo's "ZRTP" relay protocol (docs/data/call-media.md §2), not RFC 6189: little-endian, no MAC. Control packets
//! have a 21-byte header (class, b1, u32 0, seq, userId, token, cmd u16, subCmd); media travels as
//! [class][token u32][SRTP] up and [class][SRTP] down. The relay hands out the token for the call's sessId.
//! ponytail: one relay (the first that answers InitCall), no echo-rating, no TCP fallback, no P2P (class 0x7f).

use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Largest SRTP packet a ZRTP packet carries (ConstParams::sZrtcMaxPacketSize).
pub const MAX_PAYLOAD: usize = 1400;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Audio,
    Video,
}

fn header(b1: u8, user: u32, token: u32, cmd: u16, sub: u8) -> Vec<u8> {
    let mut p = vec![1, b1];
    for word in [0u32, 0, user, token] {
        p.extend(word.to_le_bytes());
    }
    p.extend(cmd.to_le_bytes());
    p.push(sub);
    p
}

fn str16(p: &mut Vec<u8>, s: &str) {
    p.extend((s.len() as u16).to_le_bytes());
    p.extend(s.as_bytes());
}

/// cmd 0x0b from the caller, 0x0c from the callee; answered with the token.
pub fn init_call(caller: bool, user: u32, call_id: u32, partner: u32, sess: &str) -> Vec<u8> {
    let mut p = header(0x7e, user, 0, if caller { 0x0b } else { 0x0c }, 1);
    p.extend(call_id.to_le_bytes());
    p.extend(partner.to_le_bytes());
    str16(&mut p, sess);
    p
}

/// One-way keepalive, every 6 s once the token is known.
pub fn ping(user: u32, token: u32, sess: &str) -> Vec<u8> {
    let mut p = header(1, user, token, 2, 1);
    str16(&mut p, sess);
    p
}

pub fn end_call(user: u32, token: u32, call_id: u32) -> Vec<u8> {
    let mut p = header(0x7e, user, token, 3, 0);
    p.extend(call_id.to_le_bytes());
    p
}

/// RTP up to the relay: class 3 audio, 0x0d video.
pub fn media(kind: Kind, token: u32, srtp: &[u8]) -> Vec<u8> {
    let mut p = vec![if kind == Kind::Audio { 3 } else { 0x0d }];
    p.extend(token.to_le_bytes());
    p.extend(srtp);
    p
}

/// RTCP up to the relay: class 5 audio, 0x0f video.
pub fn rtcp(kind: Kind, token: u32, payload: &[u8]) -> Vec<u8> {
    let mut p = vec![if kind == Kind::Audio { 5 } else { 0x0f }];
    p.extend(token.to_le_bytes());
    p.extend(payload);
    p
}

#[derive(Debug, PartialEq)]
pub enum Packet<'a> {
    /// InitCall response: result 0 = ok
    Init { result: u32, token: u32 },
    Media(Kind, &'a [u8]),
    Rtcp(Kind, &'a [u8]),
    Other,
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

pub fn parse(b: &[u8]) -> Packet<'_> {
    match b.first() {
        Some(2) if b.len() >= 25 && matches!(u16::from_le_bytes([b[18], b[19]]), 0x0b | 0x0c) => {
            let result = u32_at(b, 21).unwrap_or(u32::MAX);
            // body: result, X, token, str16
            Packet::Init { result, token: if result == 0 { u32_at(b, 29).unwrap_or(0) } else { 0 } }
        }
        // the relay strips the token from RTP (classes 4 / 0x0e); accept the uplink form too
        Some(4) => Packet::Media(Kind::Audio, &b[1..]),
        Some(0x0e) => Packet::Media(Kind::Video, &b[1..]),
        Some(3) if b.len() > 5 => Packet::Media(Kind::Audio, &b[5..]),
        Some(0x0d) if b.len() > 5 => Packet::Media(Kind::Video, &b[5..]),
        // RTCP keeps its token both ways
        Some(5) if b.len() > 5 => Packet::Rtcp(Kind::Audio, &b[5..]),
        Some(0x0f) if b.len() > 5 => Packet::Rtcp(Kind::Video, &b[5..]),
        // echoes, forwards from the partner
        _ => Packet::Other,
    }
}

/// UDP session with one relay server: RTP and control to its rtpaddr, RTCP to its rtcpaddr, from one socket
/// (call-port-answers.md §6 "Sockets").
pub struct Relay {
    sock: UdpSocket,
    server: SocketAddr,
    rtcp_server: SocketAddr,
    user: u32,
    sess: String,
    pub token: AtomicU32,
    closed: AtomicBool,
}

impl Relay {
    pub fn open(rtp: &str, rtcp: &str, user: u32, sess: &str) -> std::io::Result<Arc<Relay>> {
        let server = rtp.to_socket_addrs()?.next().ok_or(std::io::ErrorKind::AddrNotAvailable)?;
        let rtcp_server = rtcp.to_socket_addrs().ok().and_then(|mut a| a.next()).unwrap_or(server);
        let sock = UdpSocket::bind(if server.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" })?;
        sock.set_read_timeout(Some(Duration::from_millis(500)))?;
        Ok(Arc::new(Relay { sock, server, rtcp_server, user, sess: sess.into(), token: AtomicU32::new(0), closed: AtomicBool::new(false) }))
    }

    /// Reads until `close`: InitCall answers go to `on_init`, media and RTCP to `on_packet`.
    pub fn listen(self: &Arc<Self>, on_init: impl Fn(u32, u32) + Send + 'static, on_packet: impl Fn(Packet) + Send + 'static) {
        let me = self.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            while !me.closed.load(Ordering::Relaxed) {
                let Ok((n, from)) = me.sock.recv_from(&mut buf) else { continue };
                if from.ip() != me.server.ip() && from.ip() != me.rtcp_server.ip() {
                    continue;
                }
                match parse(&buf[..n]) {
                    Packet::Init { result, token } => on_init(result, token),
                    Packet::Other => {}
                    p => on_packet(p),
                }
            }
        });
    }

    fn send(&self, p: &[u8]) {
        self.send_to(p, self.server);
    }

    fn send_to(&self, p: &[u8], to: SocketAddr) {
        if let Err(e) = self.sock.send_to(p, to) {
            say!("relay send: {e}");
        }
    }

    pub fn init_call(&self, caller: bool, call_id: u32, partner: u32) {
        self.send(&init_call(caller, self.user, call_id, partner, &self.sess));
    }

    pub fn ping(&self) {
        self.send(&ping(self.user, self.token.load(Ordering::Relaxed), &self.sess));
    }

    pub fn media(&self, kind: Kind, srtp: &[u8]) {
        if srtp.len() <= MAX_PAYLOAD {
            self.send(&media(kind, self.token.load(Ordering::Relaxed), srtp));
        }
    }

    pub fn rtcp(&self, kind: Kind, payload: &[u8]) {
        if self.token.load(Ordering::Relaxed) != 0 {
            self.send_to(&rtcp(kind, self.token.load(Ordering::Relaxed), payload), self.rtcp_server);
        }
    }

    pub fn close(&self, call_id: u32) {
        if self.token.load(Ordering::Relaxed) != 0 {
            self.send(&end_call(self.user, self.token.load(Ordering::Relaxed), call_id));
        }
        self.closed.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts() {
        let p = init_call(true, 0x01020304, 7, 9, "sess");
        assert_eq!(p.len(), 21 + 4 + 4 + 2 + 4);
        assert_eq!(p[..2], [1, 0x7e]);
        assert_eq!(p[10..14], 0x01020304u32.to_le_bytes());
        assert_eq!(p[18..21], [0x0b, 0, 1]);
        assert_eq!(p[21..25], 7u32.to_le_bytes());
        assert_eq!(p[29..31], 4u16.to_le_bytes());
        assert_eq!(init_call(false, 1, 7, 9, "s")[18], 0x0c);
        assert_eq!(ping(1, 2, "s")[14..21], [2, 0, 0, 0, 2, 0, 1]);
        assert_eq!(end_call(1, 2, 7)[18..25], [3, 0, 0, 7, 0, 0, 0]);
        assert_eq!(media(Kind::Video, 0xaabbccdd, b"x"), [0x0d, 0xdd, 0xcc, 0xbb, 0xaa, b'x']);
        assert_eq!(rtcp(Kind::Video, 0xaabbccdd, b"r"), [0x0f, 0xdd, 0xcc, 0xbb, 0xaa, b'r']);
    }

    #[test]
    fn parses_init_response_and_relayed_media() {
        let mut resp = header(0x7e, 1, 0, 0x0b, 1);
        resp[0] = 2;
        resp.extend(0u32.to_le_bytes());
        resp.extend(5u32.to_le_bytes());
        resp.extend(0xdeadu32.to_le_bytes());
        str16(&mut resp, "1.2.3.4:5");
        assert_eq!(parse(&resp), Packet::Init { result: 0, token: 0xdead });
        resp[21] = 99;
        assert_eq!(parse(&resp), Packet::Init { result: 99, token: 0 });
        assert_eq!(parse(&[4, 0x80, 1]), Packet::Media(Kind::Audio, &[0x80, 1]));
        assert_eq!(parse(&[0x0d, 1, 2, 3, 4, 0x80]), Packet::Media(Kind::Video, &[0x80]));
        assert_eq!(parse(&[5, 1, 2, 3, 4, 0x80]), Packet::Rtcp(Kind::Audio, &[0x80]));
        assert_eq!(parse(&[0x0f, 1, 2, 3, 4, 0x81]), Packet::Rtcp(Kind::Video, &[0x81]));
        assert_eq!(parse(&[1, 0x7e]), Packet::Other);
    }
}
