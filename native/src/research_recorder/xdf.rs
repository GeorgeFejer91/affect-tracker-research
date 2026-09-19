//! Small XDF 1 writer. Source timestamps are explicit; no resampling or dejitter.
//! Specification: https://github.com/sccn/xdf/wiki/Specifications
use std::collections::BTreeMap;
use std::io::{self, Write};

pub const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SampleFormat {
    Float32,
    Double64,
    Int8,
    Int16,
    Int32,
    Int64,
    String,
}

impl SampleFormat {
    pub fn name(self) -> &'static str {
        match self {
            Self::Float32 => "float32",
            Self::Double64 => "double64",
            Self::Int8 => "int8",
            Self::Int16 => "int16",
            Self::Int32 => "int32",
            Self::Int64 => "int64",
            Self::String => "string",
        }
    }
    fn width(self) -> Option<usize> {
        match self {
            Self::Float32 | Self::Int32 => Some(4),
            Self::Double64 | Self::Int64 => Some(8),
            Self::Int8 => Some(1),
            Self::Int16 => Some(2),
            Self::String => None,
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDescription {
    pub name: String,
    pub stream_type: String,
    pub source_id: String,
    pub hostname: String,
    pub channels: usize,
    pub rate: f64,
    pub format: SampleFormat,
    /// Full native LSL description tree, serialized by the library's XML writer.
    pub desc_xml: String,
}

#[derive(Default)]
struct StreamState {
    count: u64,
    first: Option<f64>,
    last: Option<f64>,
}

pub struct XdfWriter<W: Write> {
    output: W,
    streams: BTreeMap<u32, (StreamDescription, StreamState)>,
    failed: bool,
    finished: bool,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

pub fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn write_varint(output: &mut impl Write, value: u64) -> io::Result<()> {
    if value <= u8::MAX as u64 {
        output.write_all(&[1, value as u8])
    } else if value <= u32::MAX as u64 {
        output.write_all(&[4])?;
        output.write_all(&(value as u32).to_le_bytes())
    } else {
        output.write_all(&[8])?;
        output.write_all(&value.to_le_bytes())
    }
}

pub fn text_sample(values: &[String]) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    for value in values {
        if bytes.len().saturating_add(value.len()).saturating_add(9) > MAX_CHUNK_BYTES {
            return Err(invalid("XDF text sample exceeds byte limit"));
        }
        write_varint(&mut bytes, value.len() as u64)?;
        bytes.extend_from_slice(value.as_bytes());
    }
    Ok(bytes)
}

impl<W: Write> XdfWriter<W> {
    pub fn new(mut output: W, recording_id: &str, recipe_hash: &str) -> io::Result<Self> {
        output.write_all(b"XDF:")?;
        let mut writer = Self {
            output,
            streams: BTreeMap::new(),
            failed: false,
            finished: false,
        };
        let header = format!("<?xml version=\"1.0\"?><info><version>1.0</version><recording_id>{}</recording_id><recipe_sha256>{}</recipe_sha256><recorder>Experiment Runner</recorder></info>", escape_xml(recording_id), escape_xml(recipe_hash));
        writer.chunk(1, header.as_bytes())?;
        Ok(writer)
    }

    pub fn add_stream(&mut self, id: u32, description: StreamDescription) -> io::Result<()> {
        if id == 0
            || self.streams.contains_key(&id)
            || self.streams.len() >= 18
            || !(1..=512).contains(&description.channels)
            || !description.rate.is_finite()
            || description.rate < 0.0
            || description.desc_xml.len() > 1024 * 1024
        {
            return Err(invalid("Invalid, duplicate or oversized XDF stream"));
        }
        let header = format!("<info><name>{}</name><type>{}</type><channel_count>{}</channel_count><nominal_srate>{}</nominal_srate><channel_format>{}</channel_format><source_id>{}</source_id><hostname>{}</hostname>{}</info>",
            escape_xml(&description.name), escape_xml(&description.stream_type), description.channels, description.rate,
            description.format.name(), escape_xml(&description.source_id), escape_xml(&description.hostname), description.desc_xml);
        let mut bytes = id.to_le_bytes().to_vec();
        bytes.extend_from_slice(header.as_bytes());
        self.chunk(2, &bytes)?;
        self.streams
            .insert(id, (description, StreamState::default()));
        Ok(())
    }

    pub fn sample(
        &mut self,
        id: u32,
        timestamp: f64,
        format: SampleFormat,
        channels: usize,
        values: &[u8],
    ) -> io::Result<()> {
        let (desc, _) = self
            .streams
            .get(&id)
            .ok_or_else(|| invalid("Unknown XDF stream"))?;
        if !timestamp.is_finite()
            || desc.format != format
            || desc.channels != channels
            || format
                .width()
                .is_some_and(|width| values.len() != channels * width)
        {
            return Err(invalid("XDF sample does not match its stream"));
        }
        if values.len() > MAX_CHUNK_BYTES - 32 {
            return Err(invalid("XDF sample exceeds byte limit"));
        }
        if format == SampleFormat::String {
            let mut rest = values;
            for _ in 0..channels {
                let (&width, tail) = rest
                    .split_first()
                    .ok_or_else(|| invalid("Missing XDF string length"))?;
                if !matches!(width, 1 | 4 | 8) || tail.len() < width as usize {
                    return Err(invalid("Invalid XDF string length"));
                }
                let mut encoded = [0u8; 8];
                encoded[..width as usize].copy_from_slice(&tail[..width as usize]);
                let length = usize::try_from(u64::from_le_bytes(encoded))
                    .map_err(|_| invalid("XDF string too long"))?;
                rest = &tail[width as usize..];
                if rest.len() < length || std::str::from_utf8(&rest[..length]).is_err() {
                    return Err(invalid("Invalid XDF UTF-8 sample"));
                }
                rest = &rest[length..];
            }
            if !rest.is_empty() {
                return Err(invalid("XDF sample has extra channels"));
            }
        }
        let mut bytes = id.to_le_bytes().to_vec();
        write_varint(&mut bytes, 1)?;
        bytes.push(8);
        bytes.extend_from_slice(&timestamp.to_le_bytes());
        bytes.extend_from_slice(values);
        self.chunk(3, &bytes)?;
        let (_, state) = self.streams.get_mut(&id).expect("validated stream");
        state.count += 1;
        state.first.get_or_insert(timestamp);
        state.last = Some(timestamp);
        Ok(())
    }

    pub fn clock_offset(
        &mut self,
        id: u32,
        source_collection_time: f64,
        offset: f64,
    ) -> io::Result<()> {
        if !self.streams.contains_key(&id)
            || !source_collection_time.is_finite()
            || !offset.is_finite()
        {
            return Err(invalid("Invalid XDF clock observation"));
        }
        let mut bytes = id.to_le_bytes().to_vec();
        bytes.extend_from_slice(&source_collection_time.to_le_bytes());
        bytes.extend_from_slice(&offset.to_le_bytes());
        self.chunk(4, &bytes)
    }

    pub fn checkpoint(&mut self) -> io::Result<()> {
        self.chunk(
            5,
            &[
                0x43, 0xa5, 0x46, 0xdc, 0xcb, 0xf5, 0x41, 0x0f, 0xb3, 0x0e, 0xd5, 0x46, 0x73, 0x83,
                0xcb, 0xe4,
            ],
        )?;
        self.flush()
    }

    pub fn finish(&mut self) -> io::Result<()> {
        let footers: Vec<_> = self.streams.iter().map(|(id, (_, state))| {
            let times = state.first.zip(state.last).map(|(a,b)| format!("<first_timestamp>{a}</first_timestamp><last_timestamp>{b}</last_timestamp>")).unwrap_or_default();
            let xml = format!("<info>{times}<sample_count>{}</sample_count></info>", state.count);
            let mut bytes = id.to_le_bytes().to_vec(); bytes.extend_from_slice(xml.as_bytes()); bytes
        }).collect();
        for bytes in footers {
            self.chunk(6, &bytes)?;
        }
        self.flush()?;
        self.finished = true;
        Ok(())
    }

    pub fn flush(&mut self) -> io::Result<()> {
        let result = self.output.flush();
        if result.is_err() {
            self.failed = true;
        }
        result
    }
    pub fn output(&self) -> &W {
        &self.output
    }
    fn chunk(&mut self, tag: u16, bytes: &[u8]) -> io::Result<()> {
        if self.failed || self.finished {
            return Err(invalid("XDF writer is closed or failed"));
        }
        if bytes.len() > MAX_CHUNK_BYTES {
            return Err(invalid("XDF chunk exceeds byte limit"));
        }
        let result = (|| {
            write_varint(&mut self.output, bytes.len() as u64 + 2)?;
            self.output.write_all(&tag.to_le_bytes())?;
            self.output.write_all(bytes)
        })();
        if result.is_err() {
            self.failed = true;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn desc(format: SampleFormat) -> StreamDescription {
        StreamDescription {
            name: "Synthetic & test".into(),
            stream_type: "Test".into(),
            source_id: "fixture".into(),
            hostname: "synthetic".into(),
            channels: 1,
            rate: 0.0,
            format,
            desc_xml: "<desc/>".into(),
        }
    }
    #[test]
    fn validates_streams_and_preserves_timestamps_and_int64_bytes() {
        let mut writer = XdfWriter::new(Vec::new(), "test", "hash").unwrap();
        writer.add_stream(1, desc(SampleFormat::Int64)).unwrap();
        assert!(writer.add_stream(1, desc(SampleFormat::Int64)).is_err());
        assert!(writer
            .sample(1, f64::NAN, SampleFormat::Int64, 1, &0i64.to_le_bytes())
            .is_err());
        assert!(writer
            .sample(1, 10.0, SampleFormat::Float32, 1, &0f32.to_le_bytes())
            .is_err());
        writer
            .sample(1, 10.125, SampleFormat::Int64, 1, &i64::MAX.to_le_bytes())
            .unwrap();
        writer.clock_offset(1, 10.2, -0.3).unwrap();
        writer.finish().unwrap();
        assert!(writer
            .output()
            .windows(8)
            .any(|v| v == i64::MAX.to_le_bytes()));
        assert!(writer
            .output()
            .windows(8)
            .any(|v| v == 10.125f64.to_le_bytes()));
        assert!(writer
            .sample(1, 11.0, SampleFormat::Int64, 1, &0i64.to_le_bytes())
            .is_err());
    }
    #[test]
    fn variable_length_boundaries_and_utf8_lengths() {
        for (n, prefix, length) in [
            (255, 1, 2),
            (256, 4, 5),
            (u32::MAX as u64, 4, 5),
            (u32::MAX as u64 + 1, 8, 9),
        ] {
            let mut bytes = Vec::new();
            write_varint(&mut bytes, n).unwrap();
            assert_eq!(bytes[0], prefix);
            assert_eq!(bytes.len(), length);
        }
        assert_eq!(text_sample(&["ä".into()]).unwrap(), vec![1, 2, 0xc3, 0xa4]);
    }
    #[test]
    fn failed_sink_never_receives_a_successful_footer() {
        struct Fails {
            remaining: usize,
        }
        impl Write for Fails {
            fn write(&mut self, b: &[u8]) -> io::Result<usize> {
                if b.len() > self.remaining {
                    return Err(io::Error::other("disk full"));
                }
                self.remaining -= b.len();
                Ok(b.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut writer = XdfWriter::new(Fails { remaining: 1000 }, "test", "hash").unwrap();
        writer.add_stream(1, desc(SampleFormat::String)).unwrap();
        assert!(writer
            .sample(
                1,
                1.0,
                SampleFormat::String,
                1,
                &text_sample(&["x".repeat(1000)]).unwrap()
            )
            .is_err());
        assert!(writer.finish().is_err());
    }
    #[test]
    fn exports_independent_reader_fixture_when_requested() {
        let Some(path) = std::env::var_os("AFFECT_RUNNER_XDF_FIXTURE") else {
            return;
        };
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        let mut writer =
            XdfWriter::new(file, "synthetic-fixture", "0".repeat(64).as_str()).unwrap();
        let formats = [
            SampleFormat::Float32,
            SampleFormat::Double64,
            SampleFormat::Int8,
            SampleFormat::Int16,
            SampleFormat::Int32,
            SampleFormat::Int64,
            SampleFormat::String,
        ];
        for (index, format) in formats.into_iter().enumerate() {
            writer.add_stream(index as u32 + 1, desc(format)).unwrap();
        }
        let values = [
            1.25f32.to_le_bytes().to_vec(),
            (-2.5f64).to_le_bytes().to_vec(),
            vec![(-127i8) as u8],
            (-30000i16).to_le_bytes().to_vec(),
            (-2_000_000_000i32).to_le_bytes().to_vec(),
            i64::MAX.to_le_bytes().to_vec(),
            text_sample(&["marker:ä<&>".into()]).unwrap(),
        ];
        for (index, format) in formats.into_iter().enumerate() {
            writer
                .sample(index as u32 + 1, 100.25, format, 1, &values[index])
                .unwrap();
            writer.clock_offset(index as u32 + 1, 100.0, 0.125).unwrap();
        }
        writer.checkpoint().unwrap();
        writer.finish().unwrap();
        writer.output().sync_all().unwrap();
    }
}
