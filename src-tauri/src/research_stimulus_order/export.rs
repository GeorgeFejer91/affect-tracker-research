//! Bounded, text-only spreadsheet exports of the owner-verified library.
use super::VideoLibrary;
use crate::research_error::{CommandError, ResearchResult};
use serde::Deserialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryFormat {
    Csv,
    Xlsx,
}
impl LibraryFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Xlsx => "xlsx",
        }
    }
}
fn rows(library: &VideoLibrary) -> Vec<Vec<String>> {
    let mut result = vec![[
        "Video annotation",
        "Filename",
        "Relative path",
        "SHA-256",
        "Bytes",
    ]
    .map(String::from)
    .to_vec()];
    result.extend(library.videos.iter().map(|v| {
        vec![
            v.annotation_id.clone(),
            v.relative_path.rsplit('/').next().unwrap_or("").into(),
            v.relative_path.clone(),
            v.sha256.clone(),
            v.byte_length.to_string(),
        ]
    }));
    result
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn sheet(rows: Vec<Vec<String>>) -> String {
    let mut result = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews><cols><col min=\"1\" max=\"5\" width=\"28\" customWidth=\"1\"/></cols><sheetData>");
    for (r, row) in rows.iter().enumerate() {
        result.push_str(&format!("<row r=\"{}\">", r + 1));
        for (c, value) in row.iter().enumerate() {
            result.push_str(&format!(
                "<c r=\"{}{}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                char::from(b'A' + c as u8),
                r + 1,
                xml(value)
            ));
        }
        result.push_str("</row>");
    }
    result.push_str("</sheetData></worksheet>");
    result
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}
fn u16_at(target: &mut [u8], offset: usize, value: u16) {
    target[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}
fn u32_at(target: &mut [u8], offset: usize, value: u32) {
    target[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
fn zip(parts: Vec<(&str, String)>) -> Vec<u8> {
    let mut local = Vec::new();
    let mut central = Vec::new();
    let count = parts.len() as u16;
    for (name, source) in parts {
        let bytes = source.as_bytes();
        let crc = crc32(bytes);
        let size = bytes.len() as u32;
        let offset = local.len() as u32;
        let mut header = [0u8; 30];
        u32_at(&mut header, 0, 0x04034b50);
        u16_at(&mut header, 4, 20);
        u16_at(&mut header, 12, 33);
        u32_at(&mut header, 14, crc);
        u32_at(&mut header, 18, size);
        u32_at(&mut header, 22, size);
        u16_at(&mut header, 26, name.len() as u16);
        local.extend(header);
        local.extend(name.as_bytes());
        local.extend(bytes);
        let mut directory = [0u8; 46];
        u32_at(&mut directory, 0, 0x02014b50);
        u16_at(&mut directory, 4, 20);
        u16_at(&mut directory, 6, 20);
        u16_at(&mut directory, 14, 33);
        u32_at(&mut directory, 16, crc);
        u32_at(&mut directory, 20, size);
        u32_at(&mut directory, 24, size);
        u16_at(&mut directory, 28, name.len() as u16);
        u32_at(&mut directory, 42, offset);
        central.extend(directory);
        central.extend(name.as_bytes());
    }
    let mut end = [0u8; 22];
    u32_at(&mut end, 0, 0x06054b50);
    u16_at(&mut end, 8, count);
    u16_at(&mut end, 10, count);
    u32_at(&mut end, 12, central.len() as u32);
    u32_at(&mut end, 16, local.len() as u32);
    local.extend(central);
    local.extend(end);
    local
}
pub fn library_bytes(library: &VideoLibrary, format: LibraryFormat) -> Vec<u8> {
    rows_bytes(rows(library), format)
}
/// Pure encoding after the command verifies current files through P1's owner.
pub fn catalogue_bytes(
    catalogue: &crate::research_workspace_contribution::VideoCatalogueContribution,
    expected_library_sha256: &str,
    format: LibraryFormat,
) -> ResearchResult<Vec<u8>> {
    let library = super::location_variants::LocationLibrary::from_catalogue(catalogue)?;
    if library.integrity_sha256 != expected_library_sha256 {
        return Err(CommandError::invalid_contract(
            "Video catalogue changed before export.",
        ));
    }
    let mut records = vec![vec![
        "Video annotation".into(),
        "Filename".into(),
        "Relative path".into(),
        "SHA-256".into(),
        "Bytes".into(),
    ]];
    records.extend(library.videos.iter().map(|video| {
        vec![
            video.annotation_id.clone(),
            video.relative_path.rsplit('/').next().unwrap_or("").into(),
            video.relative_path.clone(),
            video.sha256.clone(),
            video.byte_length.to_string(),
        ]
    }));
    Ok(rows_bytes(records, format))
}
fn rows_bytes(records: Vec<Vec<String>>, format: LibraryFormat) -> Vec<u8> {
    if matches!(format, LibraryFormat::Csv) {
        let rows = records
            .iter()
            .map(|row| {
                row.iter()
                    .map(|value| {
                        let safe = if value.trim_start().starts_with(['=', '+', '@', '-']) {
                            format!("'{value}")
                        } else {
                            value.clone()
                        };
                        format!("\"{}\"", safe.replace('"', "\"\""))
                    })
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .collect::<Vec<_>>()
            .join("\r\n");
        return format!("\u{feff}{rows}\r\n").into_bytes();
    }
    let rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    let package_rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    let mut template = vec![vec!["Event".into(), "Variant 1".into(), "Variant 2".into()]];
    template.extend((1..=5).map(|i| vec![format!("Event {i}"), String::new(), String::new()]));
    zip(vec![
        ("[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>".into()),
        ("_rels/.rels", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"{package_rel}\"><Relationship Id=\"rId1\" Type=\"{rel}/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>")),
        ("xl/workbook.xml", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"{rel}\"><sheets><sheet name=\"Video library\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"Order template\" sheetId=\"2\" r:id=\"rId2\"/></sheets></workbook>")),
        ("xl/_rels/workbook.xml.rels", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"{package_rel}\"><Relationship Id=\"rId1\" Type=\"{rel}/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"{rel}/worksheet\" Target=\"worksheets/sheet2.xml\"/></Relationships>")),
        ("xl/worksheets/sheet1.xml", sheet(records)), ("xl/worksheets/sheet2.xml", sheet(template)),
    ])
}
pub fn write_export(path: &Path, format: LibraryFormat, bytes: &[u8]) -> ResearchResult<()> {
    if !path
        .extension()
        .is_some_and(|value| value.eq_ignore_ascii_case(format.extension()))
    {
        return Err(CommandError::invalid_contract(
            "Choose a filename with the selected spreadsheet extension.",
        ));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(CommandError::io)?;
    file.write_all(bytes).map_err(CommandError::io)?;
    file.sync_all().map_err(CommandError::io)?;
    Ok(())
}
