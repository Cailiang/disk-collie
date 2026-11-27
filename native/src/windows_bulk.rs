//! Batch Windows directory metadata without opening every below-threshold file.
//! Retained files still use handle-based inspection; mutations always revalidate.
use std::io;

const HEADER: usize = 104;
#[cfg(windows)]
const EXCLUDED_ATTRIBUTES: u32 = 0x400 | 0x1000 | 0x40000 | 0x400000;

#[derive(Debug, PartialEq)]
struct Item {
    name: Vec<u16>,
    attributes: u32,
    size: u64,
    modified: u64,
    file: u64,
}

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Invalid Windows directory metadata",
    )
}

fn parse(buffer: &[u8]) -> io::Result<Vec<Item>> {
    let mut offset = 0usize;
    let mut items = Vec::new();
    loop {
        let header = buffer
            .get(offset..offset.checked_add(HEADER).ok_or_else(invalid)?)
            .ok_or_else(invalid)?;
        let u32_at = |at| u32::from_le_bytes(header[at..at + 4].try_into().unwrap());
        let u64_at = |at| u64::from_le_bytes(header[at..at + 8].try_into().unwrap());
        let next = u32_at(0) as usize;
        let length = u32_at(60) as usize;
        if length == 0 || length % 2 != 0 || length > 65534 {
            return Err(invalid());
        }
        let end = offset
            .checked_add(HEADER)
            .and_then(|start| start.checked_add(length))
            .ok_or_else(invalid)?;
        let raw_name = buffer.get(offset + HEADER..end).ok_or_else(invalid)?;
        let name: Vec<_> = raw_name
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        if name.iter().any(|c| [0, 47, 92].contains(c)) || u64_at(40) > i64::MAX as u64 {
            return Err(invalid());
        }
        let ticks = u64_at(24);
        let modified = ticks.saturating_sub(116444736000000000).saturating_mul(100);
        items.push(Item {
            name,
            attributes: u32_at(56),
            size: u64_at(40),
            modified,
            file: u64_at(96),
        });
        if next == 0 {
            return Ok(items);
        }
        // Records are 8-byte aligned and cannot overlap their filename.
        if next % 8 != 0 || next < HEADER + length {
            return Err(invalid());
        }
        offset = offset.checked_add(next).ok_or_else(invalid)?;
    }
}

#[cfg(windows)]
pub(super) fn read(
    directory: &std::path::Path,
    parent: usize,
    minimum: u64,
) -> io::Result<(Vec<super::Entry>, usize)> {
    use std::{
        fs,
        mem::{offset_of, MaybeUninit},
        os::windows::{ffi::OsStringExt, fs::OpenOptionsExt, io::AsRawHandle},
    };
    use windows_sys::Win32::{
        Foundation::ERROR_NO_MORE_FILES,
        Storage::FileSystem::{
            FileIdBothDirectoryInfo, FileIdBothDirectoryRestartInfo, GetFileInformationByHandle,
            GetFileInformationByHandleEx, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO, FILE_LIST_DIRECTORY,
            FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        },
    };
    debug_assert_eq!(offset_of!(FILE_ID_BOTH_DIR_INFO, FileName), HEADER);
    let handle = fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(directory)?;
    let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
    // SAFETY: File owns the handle; the output has the exact API layout/size.
    if unsafe { GetFileInformationByHandle(handle.as_raw_handle() as _, info.as_mut_ptr()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let info = unsafe { info.assume_init() };
    if info.dwFileAttributes & EXCLUDED_ATTRIBUTES != 0 {
        return Err(invalid());
    }
    let mut entries = Vec::new();
    let mut skipped = 0;
    // u64 storage guarantees alignment for the Windows directory record layout.
    let mut buffer = vec![0u64; 8192];
    let mut class = FileIdBothDirectoryRestartInfo;
    loop {
        buffer.fill(0);
        // SAFETY: aligned writable buffer is live for the synchronous API call.
        if unsafe {
            GetFileInformationByHandleEx(
                handle.as_raw_handle() as _,
                class,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * 8) as u32,
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
                return Ok((entries, skipped));
            }
            // Caller restarts with the standard reader on unsupported filesystems/errors.
            return Err(error);
        }
        class = FileIdBothDirectoryInfo;
        // SAFETY: initialized u64 storage can be read as bytes across its full size.
        let bytes =
            unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), buffer.len() * 8) };
        for item in parse(bytes)? {
            if item.name == [46] || item.name == [46, 46] {
                continue;
            }
            if item.attributes & EXCLUDED_ATTRIBUTES != 0 {
                skipped += 1;
                continue;
            }
            let path = directory.join(std::ffi::OsString::from_wide(&item.name));
            let directory = item.attributes & 0x10 != 0;
            if item.file == 0 || (!directory && item.size >= minimum) {
                match super::inspect(&path, 0, Some(parent)) {
                    Ok(entry) => entries.push(entry),
                    Err(_) => skipped += 1,
                }
            } else {
                entries.push(super::Entry {
                    id: 0,
                    parent: Some(parent),
                    name: path.file_name().unwrap().to_string_lossy().into(),
                    path: path.to_string_lossy().into(),
                    directory,
                    size: if directory { 0 } else { item.size },
                    // Preserve the existing Windows logical-size allocation estimate.
                    allocated: if directory { 0 } else { item.size },
                    modified: item.modified,
                    identity: format!("{}:{}", info.dwVolumeSerialNumber, item.file),
                    // Unknown link counts are only used for files that are not retained.
                    // Their stable IDs still deduplicate hardlink allocation totals.
                    links: if directory { 1 } else { 0 },
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(name: &[u16]) -> Vec<u8> {
        let mut data = vec![0; HEADER + name.len() * 2];
        data[24..32].copy_from_slice(&116444736000000123u64.to_le_bytes());
        data[40..48].copy_from_slice(&1234u64.to_le_bytes());
        data[56..60].copy_from_slice(&0x20u32.to_le_bytes());
        data[60..64].copy_from_slice(&((name.len() * 2) as u32).to_le_bytes());
        data[96..104].copy_from_slice(&987u64.to_le_bytes());
        for (pair, value) in data[HEADER..].chunks_exact_mut(2).zip(name) {
            pair.copy_from_slice(&value.to_le_bytes());
        }
        data
    }
    #[test]
    fn reads_multiple_records_and_preserves_windows_names() {
        let mut first = record(&"文件.bin".encode_utf16().collect::<Vec<_>>());
        first.resize(first.len().next_multiple_of(8), 0);
        let next = first.len() as u32;
        first[..4].copy_from_slice(&next.to_le_bytes());
        first.extend(record(&[0xd800, 46, 97])); // Windows can store unpaired surrogates.
        let items = parse(&first).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(
            (items[0].size, items[0].file, items[0].modified),
            (1234, 987, 12300)
        );
        assert_eq!(items[1].name, [0xd800, 46, 97]);
    }
    #[test]
    fn rejects_truncated_overlapping_and_invalid_records() {
        let valid = record(&[97]);
        for length in 0..valid.len() {
            assert!(parse(&valid[..length]).is_err());
        }
        for (at, value) in [(0, 8u32), (0, 105), (0, u32::MAX), (60, 3), (60, u32::MAX)] {
            let mut bad = valid.clone();
            bad[at..at + 4].copy_from_slice(&value.to_le_bytes());
            assert!(parse(&bad).is_err());
        }
        for name in [0u16, 47, 92] {
            assert!(parse(&record(&[name])).is_err());
        }
    }
    #[cfg(windows)]
    #[test]
    fn bulk_metadata_matches_strong_inspection_and_hardlink_totals() {
        use super::super::{inspect, Index};
        use serde_json::json;
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("small"), b"data").unwrap();
        std::fs::hard_link(root.path().join("small"), root.path().join("linked")).unwrap();
        std::fs::create_dir(root.path().join("folder")).unwrap();
        let (entries, skipped) = read(root.path(), 0, 10 * 1024 * 1024).unwrap();
        assert_eq!((entries.len(), skipped), (3, 0));
        for entry in entries {
            assert_eq!(entry.links, if entry.directory { 1 } else { 0 });
            let strong = inspect(std::path::Path::new(&entry.path), 0, Some(0)).unwrap();
            assert_eq!(
                (entry.identity, entry.size, entry.modified),
                (strong.identity, strong.size, strong.modified)
            );
        }
        let mut index = Index::default();
        index
            .scan_options(root.path().to_str().unwrap(), 1, &json!({"mode":"large"}))
            .unwrap();
        assert_eq!(index.entries[0].allocated, 4);
        assert_eq!(index.entries[0].size, 8);
        assert_eq!(index.entries.len(), 2);
    }
    #[cfg(windows)]
    #[test]
    fn reads_every_batch_in_a_wide_directory() {
        let root = tempfile::tempdir().unwrap();
        for i in 0..1200 {
            std::fs::write(root.path().join(format!("文件-{i:04}.txt")), b"small").unwrap();
        }
        let (entries, skipped) = read(root.path(), 0, 10 * 1024 * 1024).unwrap();
        assert_eq!((entries.len(), skipped), (1200, 0));
        let names: std::collections::HashSet<_> = entries.iter().map(|entry| &entry.name).collect();
        assert_eq!(names.len(), 1200);
        assert!(entries
            .iter()
            .all(|entry| entry.size == 5 && entry.links == 0));
    }
}
