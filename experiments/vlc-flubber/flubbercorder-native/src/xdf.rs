use std::collections::HashMap;
use std::error::Error;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub struct Inspection {
    pub affect_samples: u64,
    pub markers: Vec<String>,
}

#[derive(Default)]
struct Stream {
    name: String,
    source_id: String,
    samples: u64,
    footer: Option<u64>,
    labels: Vec<String>,
}

fn number(file: &mut File) -> Result<u64> {
    let mut width = [0];
    file.read_exact(&mut width)?;
    let mut bytes = [0_u8; 8];
    match width[0] {
        1 | 4 | 8 => {
            file.read_exact(&mut bytes[..width[0] as usize])?;
            Ok(u64::from_le_bytes(bytes))
        }
        _ => Err("Invalid XDF number width".into()),
    }
}

fn xml_value<'a>(xml: &'a str, tag: &str) -> Result<&'a str> {
    let start = format!("<{tag}>");
    let end = format!("</{tag}>");
    let (_, tail) = xml.split_once(&start).ok_or("XDF XML field missing")?;
    Ok(tail.split_once(&end).ok_or("XDF XML field is unclosed")?.0)
}

pub fn inspect(
    path: &Path,
    source: &str,
    filename: &str,
    expected: &HashMap<String, String>,
) -> Result<Inspection> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut magic = [0; 4];
    file.read_exact(&mut magic)?;
    if &magic != b"XDF:" {
        return Err("XDF header is missing".into());
    }
    let mut streams: HashMap<u32, Stream> = HashMap::new();
    while file.stream_position()? < size {
        let length = number(&mut file)?;
        let end = file
            .stream_position()?
            .checked_add(length)
            .ok_or("XDF chunk overflow")?;
        if length < 2 || end > size {
            return Err("XDF chunk is truncated".into());
        }
        let mut tag_bytes = [0; 2];
        file.read_exact(&mut tag_bytes)?;
        let tag = u16::from_le_bytes(tag_bytes);
        if matches!(tag, 2 | 3 | 4 | 6) {
            if length < 6 {
                return Err("XDF stream chunk is truncated".into());
            }
            let mut id_bytes = [0; 4];
            file.read_exact(&mut id_bytes)?;
            let id = u32::from_le_bytes(id_bytes);
            match tag {
                2 => {
                    let remaining = end - file.stream_position()?;
                    if remaining > 1_000_000 || streams.contains_key(&id) {
                        return Err("XDF stream header is invalid".into());
                    }
                    let mut bytes = vec![0; remaining as usize];
                    file.read_exact(&mut bytes)?;
                    let xml = String::from_utf8(bytes)?;
                    streams.insert(
                        id,
                        Stream {
                            name: xml_value(&xml, "name")?.to_owned(),
                            source_id: xml_value(&xml, "source_id")?.to_owned(),
                            ..Stream::default()
                        },
                    );
                }
                3 => {
                    let stream = streams
                        .get_mut(&id)
                        .ok_or("XDF samples precede stream header")?;
                    let count = number(&mut file)?;
                    if count > 1_000_000 {
                        return Err("XDF sample chunk is too large".into());
                    }
                    stream.samples = stream
                        .samples
                        .checked_add(count)
                        .ok_or("XDF sample count overflow")?;
                    if stream.source_id == format!("{source}-markers") {
                        for _ in 0..count {
                            let mut width = [0];
                            file.read_exact(&mut width)?;
                            if width[0] == 8 {
                                file.seek(SeekFrom::Current(8))?;
                            } else if width[0] != 0 {
                                return Err("XDF marker timestamp is invalid".into());
                            }
                            let n = number(&mut file)?;
                            if n > 1024 || file.stream_position()?.saturating_add(n) > end {
                                return Err("XDF marker label is invalid".into());
                            }
                            let mut bytes = vec![0; n as usize];
                            file.read_exact(&mut bytes)?;
                            stream.labels.push(String::from_utf8(bytes)?);
                        }
                    }
                }
                6 => {
                    let stream = streams
                        .get_mut(&id)
                        .ok_or("XDF footer precedes stream header")?;
                    let remaining = end - file.stream_position()?;
                    if remaining > 1_000_000 {
                        return Err("XDF stream footer is too large".into());
                    }
                    let mut bytes = vec![0; remaining as usize];
                    file.read_exact(&mut bytes)?;
                    let xml = String::from_utf8(bytes)?;
                    stream.footer = Some(xml_value(&xml, "sample_count")?.parse()?);
                }
                _ => {
                    if !streams.contains_key(&id) {
                        return Err("XDF clock data precedes stream header".into());
                    }
                }
            }
        }
        if file.stream_position()? > end {
            return Err("XDF chunk exceeds its declared size".into());
        }
        file.seek(SeekFrom::Start(end))?;
    }
    if streams.len() != expected.len()
        || streams
            .values()
            .any(|stream| stream.footer != Some(stream.samples))
    {
        return Err("XDF stream count or footer is inconsistent".into());
    }
    for (id, name) in expected {
        if !streams
            .values()
            .any(|s| &s.source_id == id && &s.name == name)
        {
            return Err(format!("XDF is missing required stream {name}").into());
        }
    }
    let affect = streams
        .values()
        .find(|s| s.source_id == format!("{source}-affect"))
        .ok_or("XDF affect stream is missing")?;
    let markers = streams
        .values()
        .find(|s| s.source_id == format!("{source}-markers"))
        .ok_or("XDF marker stream is missing")?;
    let names = [format!("{filename}_Start"), format!("{filename}_Stop")];
    if affect.samples == 0 || markers.labels != names || markers.samples != 2 {
        return Err("XDF affect samples or filename markers are incomplete".into());
    }
    Ok(Inspection {
        affect_samples: affect.samples,
        markers: markers.labels.clone(),
    })
}
