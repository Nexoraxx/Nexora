//! SRTP as Zalo's patched libsrtp runs it (docs/data/call-media.md §3): AES-128-CM with the RFC 3711 KDF, an
//! HMAC-SHA1 tag of 80 bits (srtpMode 1), 32 bits (2) or none (3), one 30-byte master key (16 key + 14 salt) for
//! both directions. srtpNoSeq forces suite 3 and keystream index 0, with no replay check.
//! ponytail: RTP only; RTCP goes unsent and incoming SRTCP is dropped, add SRTCP when RTCP feedback is wired.

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockEncrypt, KeyInit};
use aes::Aes128;
use hmac::{Hmac, Mac};
use sha1::Sha1;

fn keystream(aes: &Aes128, iv: [u8; 16], data: &mut [u8]) {
    let mut ctr = u128::from_be_bytes(iv);
    for chunk in data.chunks_mut(16) {
        let mut block = GenericArray::from(ctr.to_be_bytes());
        aes.encrypt_block(&mut block);
        chunk.iter_mut().zip(block.iter()).for_each(|(d, k)| *d ^= k);
        ctr = ctr.wrapping_add(1);
    }
}

// RFC 3711 §4.3.1, key derivation rate 0: IV = (master_salt XOR label<<48) * 2^16
fn derive(master: &Aes128, salt: &[u8], label: u8, len: usize) -> Vec<u8> {
    let mut iv = [0u8; 16];
    iv[..14].copy_from_slice(salt);
    iv[7] ^= label;
    let mut out = vec![0u8; len];
    keystream(master, iv, &mut out);
    out
}

fn header_len(p: &[u8]) -> Option<usize> {
    if p.len() < 12 || p[0] >> 6 != 2 {
        return None;
    }
    let mut n = 12 + 4 * (p[0] & 0x0f) as usize;
    if p[0] & 0x10 != 0 {
        n += 4 + 4 * u16::from_be_bytes([*p.get(n + 2)?, *p.get(n + 3)?]) as usize;
    }
    (n <= p.len()).then_some(n)
}

/// One direction of one media stream.
pub struct Srtp {
    aes: Aes128,
    salt: [u8; 14],
    auth: Option<(Vec<u8>, usize)>,
    no_seq: bool,
    roc: u32,
    last_seq: Option<u16>,
}

impl Srtp {
    pub fn new(master: &[u8], mode: i64, no_seq: bool) -> Option<Self> {
        let master_aes = Aes128::new(GenericArray::from_slice(master.get(..16)?));
        let salt = master.get(16..30)?;
        let tag = match mode {
            _ if no_seq => 0,
            1 => 10,
            2 => 4,
            3 => 0,
            _ => return None,
        };
        Some(Srtp {
            aes: Aes128::new(GenericArray::from_slice(&derive(&master_aes, salt, 0, 16))),
            salt: derive(&master_aes, salt, 2, 14).try_into().ok()?,
            auth: (tag > 0).then(|| (derive(&master_aes, salt, 1, 20), tag)),
            no_seq,
            roc: 0,
            last_seq: None,
        })
    }

    fn crypt(&self, p: &mut [u8], hdr: usize, index: u64) {
        let mut iv = [0u8; 16];
        iv[..14].copy_from_slice(&self.salt);
        (0..4).for_each(|i| iv[4 + i] ^= p[8 + i]);
        let index = if self.no_seq { 0 } else { index }.to_be_bytes();
        (0..6).for_each(|i| iv[8 + i] ^= index[2 + i]);
        keystream(&self.aes, iv, &mut p[hdr..]);
    }

    fn tag(&self, data: &[u8], roc: u32) -> Option<Vec<u8>> {
        let (key, len) = self.auth.as_ref()?;
        let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(key).ok()?;
        mac.update(data);
        mac.update(&roc.to_be_bytes());
        Some(mac.finalize().into_bytes()[..*len].to_vec())
    }

    pub fn protect(&mut self, rtp: &[u8]) -> Option<Vec<u8>> {
        let hdr = header_len(rtp)?;
        let seq = u16::from_be_bytes([rtp[2], rtp[3]]);
        if self.last_seq.is_some_and(|last| seq < last && last - seq > 0x8000) {
            self.roc = self.roc.wrapping_add(1);
        }
        self.last_seq = Some(seq);
        let mut p = rtp.to_vec();
        self.crypt(&mut p, hdr, (u64::from(self.roc) << 16) | u64::from(seq));
        if let Some(t) = self.tag(&p, self.roc) {
            p.extend(t);
        }
        Some(p)
    }

    pub fn unprotect(&mut self, srtp: &[u8]) -> Option<Vec<u8>> {
        let body = srtp.len().checked_sub(self.auth.as_ref().map_or(0, |a| a.1))?;
        let hdr = header_len(&srtp[..body])?;
        let seq = u16::from_be_bytes([srtp[2], srtp[3]]);
        // RFC 3711 §3.3.1 index estimate
        let roc = match self.last_seq {
            Some(s) if s < 0x8000 && seq > s && seq - s > 0x8000 => self.roc.wrapping_sub(1),
            Some(s) if s >= 0x8000 && s - 0x8000 > seq => self.roc.wrapping_add(1),
            _ => self.roc,
        };
        if self.tag(&srtp[..body], roc).is_some_and(|t| t != srtp[body..]) {
            return None;
        }
        let mut p = srtp[..body].to_vec();
        self.crypt(&mut p, hdr, (u64::from(roc) << 16) | u64::from(seq));
        match self.last_seq {
            _ if roc == self.roc.wrapping_add(1) => (self.roc, self.last_seq) = (roc, Some(seq)),
            Some(s) if roc == self.roc && seq <= s => {}
            _ if roc == self.roc => self.last_seq = Some(seq),
            _ => {}
        }
        Some(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn rfc3711_b3_key_derivation() {
        let master = Aes128::new(GenericArray::from_slice(&hex("E1F97A0D3E018BE0D64FA32C06DE4139")));
        let salt = hex("0EC675AD498AFEEBB6960B3AABE6");
        assert_eq!(derive(&master, &salt, 0, 16), hex("C61E7A93744F39EE10734AFE3FF7A087"));
        assert_eq!(derive(&master, &salt, 2, 14), hex("30CBBC08863D8C85D49DB34A9AE1"));
        assert_eq!(derive(&master, &salt, 1, 20), hex("CEBE321F6FF7716B6FD4AB49AF256A156D38BAA4"));
    }

    #[test]
    fn protect_unprotect_all_modes() {
        let key = b"0123456789abcdef0123456789abcd";
        let rtp: Vec<u8> = [0x80, 112, 0xff, 0xfe, 0, 0, 1, 0, 0xde, 0xad, 0xbe, 0xef].into_iter().chain(*b"opus frame").collect();
        for (mode, no_seq, tag) in [(1, false, 10), (2, false, 4), (3, false, 0), (1, true, 0)] {
            let (mut tx, mut rx) = (Srtp::new(key, mode, no_seq).unwrap(), Srtp::new(key, mode, no_seq).unwrap());
            let sealed = tx.protect(&rtp).unwrap();
            assert_eq!(sealed.len(), rtp.len() + tag);
            assert_eq!(sealed[..12], rtp[..12]);
            assert_ne!(sealed[12..22], rtp[12..]);
            assert_eq!(rx.unprotect(&sealed).unwrap(), rtp);
            if tag > 0 {
                let mut bad = sealed.clone();
                bad[13] ^= 1;
                assert!(rx.unprotect(&bad).is_none());
            }
        }
        // noSeq: the keystream ignores the sequence number
        let mut a = Srtp::new(key, 3, true).unwrap();
        let mut next = rtp.clone();
        next[3] = 0xff;
        assert_eq!(a.protect(&rtp).unwrap()[12..], a.protect(&next).unwrap()[12..]);
        // sequence wrap bumps the rollover counter on both sides
        let (mut tx, mut rx) = (Srtp::new(key, 1, false).unwrap(), Srtp::new(key, 1, false).unwrap());
        for seq in [0xfffeu16, 0xffff, 0, 1] {
            let mut p = rtp.clone();
            p[2..4].copy_from_slice(&seq.to_be_bytes());
            assert_eq!(rx.unprotect(&tx.protect(&p).unwrap()).unwrap(), p);
        }
        assert_eq!((tx.roc, rx.roc), (1, 1));
    }
}
