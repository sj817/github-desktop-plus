use std::io::{self, Read, Write};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_PAYLOAD_SIZE: usize = 16 * 1024 * 1024;
const HEADER_SIZE: usize = 9;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum FrameKind {
    Hello = 1,
    HelloAck = 2,
    Spawn = 3,
    Spawned = 4,
    Stdin = 5,
    StdinEnd = 6,
    Stdout = 7,
    Stderr = 8,
    Kill = 9,
    Exit = 10,
    Error = 11,
    Shutdown = 12,
    Ping = 13,
    Pong = 14,
}

impl TryFrom<u8> for FrameKind {
    type Error = io::Error;

    fn try_from(value: u8) -> Result<Self, io::Error> {
        let kind = match value {
            1 => Self::Hello,
            2 => Self::HelloAck,
            3 => Self::Spawn,
            4 => Self::Spawned,
            5 => Self::Stdin,
            6 => Self::StdinEnd,
            7 => Self::Stdout,
            8 => Self::Stderr,
            9 => Self::Kill,
            10 => Self::Exit,
            11 => Self::Error,
            12 => Self::Shutdown,
            13 => Self::Ping,
            14 => Self::Pong,
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("unknown frame kind {value}"),
                ));
            }
        };
        Ok(kind)
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct Frame {
    pub kind: FrameKind,
    pub request_id: u64,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(kind: FrameKind, request_id: u64, payload: Vec<u8>) -> Self {
        Self {
            kind,
            request_id,
            payload,
        }
    }

    pub fn json<T: serde::Serialize>(
        kind: FrameKind,
        request_id: u64,
        value: &T,
    ) -> serde_json::Result<Self> {
        Ok(Self::new(kind, request_id, serde_json::to_vec(value)?))
    }
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Frame>> {
    let mut length_bytes = [0_u8; 4];
    loop {
        match reader.read(&mut length_bytes[..1]) {
            Ok(0) => return Ok(None),
            Ok(1) => break,
            Ok(_) => unreachable!("one-byte read returned more than one byte"),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    reader.read_exact(&mut length_bytes[1..])?;

    let frame_length = u32::from_be_bytes(length_bytes) as usize;
    if !(HEADER_SIZE..=HEADER_SIZE + MAX_PAYLOAD_SIZE).contains(&frame_length) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid frame length {frame_length}"),
        ));
    }

    let mut header = [0_u8; HEADER_SIZE];
    reader.read_exact(&mut header)?;
    let kind = FrameKind::try_from(header[0])?;
    let request_id = u64::from_be_bytes(header[1..].try_into().expect("fixed frame header"));
    let mut payload = vec![0_u8; frame_length - HEADER_SIZE];
    reader.read_exact(&mut payload)?;

    Ok(Some(Frame::new(kind, request_id, payload)))
}

pub fn write_frame(writer: &mut impl Write, frame: &Frame) -> io::Result<()> {
    if frame.payload.len() > MAX_PAYLOAD_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("payload is too large: {} bytes", frame.payload.len()),
        ));
    }

    let frame_length = HEADER_SIZE + frame.payload.len();
    writer.write_all(&(frame_length as u32).to_be_bytes())?;
    writer.write_all(&[frame.kind as u8])?;
    writer.write_all(&frame.request_id.to_be_bytes())?;
    writer.write_all(&frame.payload)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_round_trip_preserves_binary_payload() {
        let expected = Frame::new(FrameKind::Stdout, 42, vec![0, 1, 2, 254, 255]);
        let mut encoded = Vec::new();
        write_frame(&mut encoded, &expected).expect("encode frame");

        let actual = read_frame(&mut encoded.as_slice())
            .expect("decode frame")
            .expect("one frame");
        assert_eq!(actual, expected);
    }

    #[test]
    fn rejects_frames_smaller_than_the_header() {
        let mut encoded = Vec::from(8_u32.to_be_bytes());
        encoded.extend_from_slice(&[0; 8]);
        let error = read_frame(&mut encoded.as_slice()).expect_err("invalid frame");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn clean_eof_has_no_frame() {
        assert!(read_frame(&mut [].as_slice()).expect("clean eof").is_none());
    }

    #[test]
    fn truncated_length_is_an_error() {
        let error = read_frame(&mut [0_u8, 0].as_slice()).expect_err("truncated length");
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }
}
