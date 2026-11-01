//! The RTCP a Zalo peer can't do without (docs/data/call-media.md §11). It treats a second with no fresh audio
//! receiver report as 100% loss (CallController::_updateRating), which shows the partner "unstable network". After
//! 3 s with no video RTCP it halves its video bitrate down to a suspend (VideoRtpRtcp::checkNoReport). Its parser
//! (RTCPParserV2::Validate) drops any compound packet that doesn't start with SR/RR, so a PLI has to follow an RR.
//! ponytail: RR only (no SR: the partner gets no RTT or lip sync from us), jitter/LSR/DLSR reported as 0.

/// RFC 3550 A.3 statistics of one incoming stream.
#[derive(Default)]
pub struct RecvStats {
    ssrc: Option<u32>,
    base: u32,
    max: u16,
    cycles: u32,
    received: u32,
    expected_prior: u32,
    received_prior: u32,
}

impl RecvStats {
    pub fn update(&mut self, rtp: &[u8]) {
        let Some(hdr) = rtp.get(..12) else { return };
        let seq = u16::from_be_bytes([hdr[2], hdr[3]]);
        if self.ssrc.is_none() {
            (self.base, self.max) = (u32::from(seq), seq);
        } else if seq.wrapping_sub(self.max) < 0x8000 {
            if seq < self.max {
                self.cycles += 1 << 16;
            }
            self.max = seq;
        }
        self.ssrc = Some(u32::from_be_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]));
        self.received += 1;
    }

    pub fn ssrc(&self) -> Option<u32> {
        self.ssrc
    }

    /// The report block for this stream since the previous call (RFC 3550 §6.4.1).
    pub fn block(&mut self) -> Option<[u8; 24]> {
        let ssrc = self.ssrc?;
        let ext_max = self.cycles + u32::from(self.max);
        let expected = ext_max.wrapping_sub(self.base).wrapping_add(1);
        let lost = i64::from(expected) - i64::from(self.received);
        let lost_interval = i64::from(expected.wrapping_sub(self.expected_prior)) - i64::from(self.received - self.received_prior);
        let expected_interval = i64::from(expected.wrapping_sub(self.expected_prior));
        (self.expected_prior, self.received_prior) = (expected, self.received);
        let fraction = if expected_interval > 0 && lost_interval > 0 { ((lost_interval << 8) / expected_interval).min(255) as u8 } else { 0 };
        let mut b = [0u8; 24];
        b[..4].copy_from_slice(&ssrc.to_be_bytes());
        b[4] = fraction;
        b[5..8].copy_from_slice(&(lost.clamp(-0x80_0000, 0x7f_ffff) as i32).to_be_bytes()[1..]);
        b[8..12].copy_from_slice(&ext_max.to_be_bytes());
        Some(b)
    }
}

/// Compound RTCP: an RR from `sender` with zero or one report block, then a PLI asking `pli` for a keyframe.
pub fn report(sender: u32, block: Option<[u8; 24]>, pli: Option<u32>) -> Vec<u8> {
    let blocks = u8::from(block.is_some());
    let mut p = vec![0x80 | blocks, 201, 0, 1 + 6 * blocks];
    p.extend(sender.to_be_bytes());
    p.extend(block.into_iter().flatten());
    if let Some(media) = pli {
        p.extend([0x81, 206, 0, 2]);
        p.extend(sender.to_be_bytes());
        p.extend(media.to_be_bytes());
    }
    p
}

/// What the partner's RTCP says about our stream `ours`.
#[derive(Default, Debug, PartialEq)]
pub struct Feedback {
    pub keyframe: bool,
    /// fraction lost (/256), cumulative lost, extended highest sequence number
    pub seen: Option<(u8, i32, u32)>,
}

pub fn parse(mut p: &[u8], ours: u32) -> Feedback {
    let mut f = Feedback::default();
    while p.len() >= 8 && p[0] >> 6 == 2 {
        let len = ((usize::from(u16::from_be_bytes([p[2], p[3]])) + 1) * 4).min(p.len());
        let (count, pt) = (usize::from(p[0] & 0x1f), p[1]);
        let blocks = match pt {
            200 => p.get(28..len),
            201 => p.get(8..len),
            _ => None,
        };
        for b in blocks.into_iter().flat_map(|b| b.chunks_exact(24)).take(count) {
            if b[..4] == ours.to_be_bytes() {
                let lost = i32::from_be_bytes([b[5], b[6], b[7], 0]) >> 8;
                f.seen = Some((b[4], lost, u32::from_be_bytes([b[8], b[9], b[10], b[11]])));
            }
        }
        // PSFB PLI (1) / FIR (4)
        f.keyframe |= pt == 206 && matches!(count, 1 | 4);
        p = &p[len..];
    }
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rtp(seq: u16) -> Vec<u8> {
        let mut p = vec![0x80, 97, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7];
        p[2..4].copy_from_slice(&seq.to_be_bytes());
        p
    }

    #[test]
    fn report_blocks_count_loss_across_a_wrap() {
        let mut s = RecvStats::default();
        assert_eq!(s.block(), None);
        for seq in [0xfffe, 0xffff, 1, 0] {
            s.update(&rtp(seq)); // wraps, 0 arrives late
        }
        let b = s.block().unwrap();
        assert_eq!(b[..4], 7u32.to_be_bytes());
        // expected 0xfffe..=0x10001 = 4, received 4 → cumulative 0, fraction 0
        assert_eq!((b[4], &b[5..8], &b[8..12]), (0, &[0, 0, 0][..], &0x1_0001u32.to_be_bytes()[..]));
        s.update(&rtp(5)); // 2..=4 lost
        let b = s.block().unwrap();
        assert_eq!((b[4], &b[5..8]), (192, &[0, 0, 3][..])); // 3 of 4 lost
    }

    #[test]
    fn compound_starts_with_rr_and_round_trips() {
        let mut s = RecvStats::default();
        s.update(&rtp(10));
        let p = report(1, s.block(), Some(7));
        assert_eq!(p[..4], [0x81, 201, 0, 7]);
        assert_eq!(p.len(), 8 + 24 + 12);
        assert_eq!(p[32..], [0x81, 206, 0, 2, 0, 0, 0, 1, 0, 0, 0, 7]);
        assert_eq!(parse(&p, 7), Feedback { keyframe: true, seen: Some((0, 0, 10)) });
        assert_eq!(parse(&report(1, None, None), 7), Feedback::default());
        assert_eq!(report(1, None, None), [0x80, 201, 0, 1, 0, 0, 0, 1]);
    }
}
