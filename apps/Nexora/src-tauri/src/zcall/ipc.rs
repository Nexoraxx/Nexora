//! ZaloCall's side of the host link (docs/data/call-signaling.md §4.2): two unix sockets, each message
//! hex(AES-128-CBC(JSON, zero IV, PKCS#7)) + "$". Host→helper messages may come in 4000-char chunks
//! "<hex>#<msgId>#<total>#<idx>#$"; every read is answered with "ack".

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::Mutex;

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockDecrypt, BlockEncrypt, KeyInit};
use aes::Aes128;
use serde_json::Value;

// callV2TransportAesKey "yjAF9oqMWl6XfXYJn9mA7w==" (main.js) = ZCrytoMessage key (ZaloCall)
const KEY: [u8; 16] = [0xca, 0x30, 0x05, 0xf6, 0x8a, 0x8c, 0x5a, 0x5e, 0x97, 0x7d, 0x76, 0x09, 0x9f, 0xd9, 0x80, 0xef];

pub fn encrypt(plain: &[u8]) -> String {
    let aes = Aes128::new(&KEY.into());
    let pad = 16 - plain.len() % 16;
    let mut data = plain.to_vec();
    data.resize(plain.len() + pad, pad as u8);
    let mut prev = [0u8; 16];
    let mut out = String::with_capacity(data.len() * 2);
    for block in data.chunks(16) {
        let mut b = GenericArray::clone_from_slice(block);
        b.iter_mut().zip(prev).for_each(|(x, p)| *x ^= p);
        aes.encrypt_block(&mut b);
        prev.copy_from_slice(&b);
        b.iter().for_each(|x| out.push_str(&format!("{x:02x}")));
    }
    out
}

pub fn decrypt(hex: &str) -> Option<Vec<u8>> {
    let bytes = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok()).collect::<Option<Vec<_>>>()?;
    if bytes.is_empty() || bytes.len() % 16 != 0 {
        return None;
    }
    let aes = Aes128::new(&KEY.into());
    let mut prev = [0u8; 16];
    let mut out = Vec::with_capacity(bytes.len());
    for block in bytes.chunks(16) {
        let mut b = GenericArray::clone_from_slice(block);
        aes.decrypt_block(&mut b);
        out.extend(b.iter().zip(prev).map(|(x, p)| x ^ p));
        prev.copy_from_slice(block);
    }
    let pad = *out.last()? as usize;
    (1..=16).contains(&pad).then(|| out.truncate(out.len() - pad))?;
    Some(out)
}

/// Writes to the host (argv[1]).
pub struct Ipc(Mutex<UnixStream>);

impl Ipc {
    pub fn send(&self, msg: &Value) {
        let frame = encrypt(msg.to_string().as_bytes()) + "$";
        if let Err(e) = self.0.lock().unwrap().write_all(frame.as_bytes()) {
            say!("ipc send: {e}");
        }
    }
}

/// Connects both sockets; `on_message` runs on the reader thread for every host message, `on_close` when the host goes.
pub fn connect(recv_path: &str, send_path: &str, on_message: impl Fn(Value) + Send + 'static, on_close: impl FnOnce() + Send + 'static) -> std::io::Result<Ipc> {
    let up = UnixStream::connect(recv_path)?;
    let mut down = UnixStream::connect(send_path)?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 65536];
        let mut inbox = String::new();
        let mut parts: Vec<String> = Vec::new();
        while let Ok(n) = down.read(&mut buf) {
            if n == 0 || down.write_all(b"ack").is_err() {
                break;
            }
            inbox.push_str(&String::from_utf8_lossy(&buf[..n]));
            while let Some(end) = inbox.find('$') {
                let piece: String = inbox.drain(..=end).collect();
                let piece = &piece[..piece.len() - 1];
                let hex = match piece.split('#').collect::<Vec<_>>()[..] {
                    [hex, _id, total, idx, ""] => {
                        let (total, idx) = (total.parse().unwrap_or(1), idx.parse().unwrap_or(0));
                        parts.resize(parts.len().max(total), String::new());
                        if idx < total {
                            parts[idx] = hex.to_string();
                        }
                        if parts.iter().any(String::is_empty) {
                            continue;
                        }
                        parts.drain(..).collect()
                    }
                    _ => piece.to_string(),
                };
                match decrypt(&hex).and_then(|p| serde_json::from_slice(strip_nul(&p)).ok()) {
                    Some(v) => on_message(v),
                    None => say!("ipc: unreadable message"),
                }
            }
        }
        on_close();
    });
    Ok(Ipc(Mutex::new(up)))
}

fn strip_nul(b: &[u8]) -> &[u8] {
    let end = b.iter().rposition(|&c| c != 0).map_or(0, |i| i + 1);
    &b[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cbc_round_trip_matches_host_framing() {
        let hex = encrypt(br#"{"type":"update","command":"native-ready"}"#);
        // same bytes as the server's encryptMessage (node:crypto aes-128-cbc)
        assert_eq!(hex, "d3cb1ae7deeb177344597c0813073c6c9f85fa2587a9b40fc6d1f2ddb62acf87a8c0f77ff2e00e869a5123ddb7771f9f");
        assert_eq!(decrypt(&hex).unwrap(), br#"{"type":"update","command":"native-ready"}"#);
        // a full padding block when the input is block-aligned
        assert_eq!(encrypt(&[b'x'; 16]).len(), 64);
        assert!(decrypt("zz").is_none());
    }
}
