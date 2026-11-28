//! Darwin's documented bulk attribute ABI. All record offsets are bounds checked.
//! Unsupported filesystems fall back to std::fs::read_dir in the caller.
use crate::Entry;
use std::{fs::File, io, os::fd::AsRawFd, path::Path};

#[repr(C)]
struct AttrList {
    count: u16,
    reserved: u16,
    common: u32,
    volume: u32,
    directory: u32,
    file: u32,
    fork: u32,
}
unsafe extern "C" {
    fn getattrlistbulk(
        fd: i32,
        attributes: *mut AttrList,
        buffer: *mut std::ffi::c_void,
        size: usize,
        options: u64,
    ) -> i32;
}
const NAME: u32 = 1;
const DEVICE: u32 = 2;
const TYPE: u32 = 8;
const MODIFIED: u32 = 0x400;
const FLAGS: u32 = 0x40000;
const ID: u32 = 0x02000000;
const COMMON: u32 = NAME | DEVICE | TYPE | MODIFIED | FLAGS | ID;

fn u32_at(record: &[u8], offset: usize) -> Result<u32, ()> {
    Ok(u32::from_ne_bytes(
        record
            .get(offset..offset + 4)
            .ok_or(())?
            .try_into()
            .map_err(|_| ())?,
    ))
}
fn u64_at(record: &[u8], offset: usize) -> Result<u64, ()> {
    Ok(u64::from_ne_bytes(
        record
            .get(offset..offset + 8)
            .ok_or(())?
            .try_into()
            .map_err(|_| ())?,
    ))
}

fn parse(record: &[u8], directory: &Path, parent: usize) -> Result<Option<Entry>, ()> {
    let common = u32_at(record, 4)?;
    let file = u32_at(record, 16)?;
    if common & COMMON != COMMON {
        return Err(());
    }
    // uint32 length + attribute_set_t (five uint32s), then common attrs in bit order.
    let reference = 24usize;
    let offset = u32_at(record, reference)? as i32;
    let length = u32_at(record, reference + 4)? as usize;
    let start = reference.checked_add_signed(offset as isize).ok_or(())?;
    let name = record
        .get(start..start.checked_add(length).ok_or(())?)
        .ok_or(())?;
    let name = name.strip_suffix(&[0]).ok_or(())?;
    let name = std::str::from_utf8(name).map_err(|_| ())?;
    if name == "." || name == ".." || name.contains('/') {
        return Err(());
    }
    let device = u32_at(record, 32)?;
    let kind = u32_at(record, 36)?;
    let seconds = u64_at(record, 40)?;
    let nanos = u64_at(record, 48)?;
    let flags = u32_at(record, 56)?;
    let file_id = u64_at(record, 60)?;
    if flags & 0x40000000 != 0 || (kind == 1 && flags & (0x2 | 0x10 | 0x20000 | 0x100000) != 0) || (kind != 1 && kind != 2) {
        return Ok(None);
    }
    let mut cursor = 68;
    let mut links = 1;
    let mut size = 0;
    let mut allocated = 0;
    if file & 1 != 0 {
        links = u32_at(record, cursor)? as u64;
        cursor += 4;
    }
    if file & 2 != 0 {
        size = u64_at(record, cursor)?;
        cursor += 8;
    }
    if file & 4 != 0 {
        allocated = u64_at(record, cursor)?;
    }
    if kind == 1 && file & 7 != 7 {
        return Err(());
    }
    let path = directory.join(name).to_str().ok_or(())?.to_string();
    Ok(Some(Entry {
        id: 0,
        parent: Some(parent),
        name: name.into(),
        path,
        directory: kind == 2,
        size: if kind == 1 { size } else { 0 },
        allocated: if kind == 1 { allocated } else { 0 },
        modified: seconds.saturating_mul(1_000_000_000).saturating_add(nanos),
        identity: format!("{device}:{file_id}"),
        links,
    }))
}

pub fn read(directory: &Path, parent: usize) -> io::Result<(Vec<Entry>, usize)> {
    let handle = File::open(directory)?;
    // u64 backing guarantees the alignment required by Darwin, even though fields are 4-byte packed.
    let mut buffer = vec![0u64; 8192];
    let mut entries = Vec::new();
    let mut skipped = 0;
    let mut attributes = AttrList {
        count: 5,
        reserved: 0,
        common: COMMON | 0x80000000,
        volume: 0,
        directory: 0,
        file: 7,
        fork: 0,
    };
    loop {
        // SAFETY: fd remains owned by handle, attrlist ABI matches sys/attr.h, buffer is writable/aligned.
        let count = unsafe {
            getattrlistbulk(
                handle.as_raw_fd(),
                &mut attributes,
                buffer.as_mut_ptr().cast(),
                buffer.len() * 8,
                0,
            )
        };
        if count < 0 {
            return Err(io::Error::last_os_error());
        }
        if count == 0 {
            break;
        }
        // SAFETY: the u64 allocation is initialized and the byte view has exactly the same size.
        let bytes =
            unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), buffer.len() * 8) };
        let mut offset = 0usize;
        for _ in 0..count {
            let length = u32_at(bytes, offset)
                .map_err(|_| io::Error::other("Invalid bulk length"))?
                as usize;
            if length < 24 {
                return Err(io::Error::other("Invalid bulk record"));
            }
            let record = bytes
                .get(
                    offset
                        ..offset
                            .checked_add(length)
                            .ok_or(io::Error::other("Bulk length overflow"))?,
                )
                .ok_or(io::Error::other("Truncated bulk record"))?;
            match parse(record, directory, parent) {
                Ok(Some(entry)) => entries.push(entry),
                Ok(None) => skipped += 1,
                Err(_) => return Err(io::Error::other("Unsupported bulk attributes")),
            }
            offset += length;
        }
    }
    Ok((entries, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bulk_metadata_matches_standard_metadata() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("你好.txt"), vec![7u8; 8193]).unwrap();
        std::fs::create_dir(dir.path().join("folder")).unwrap();
        let (entries, _) = read(dir.path(), 0).unwrap();
        assert_eq!(entries.len(), 2);
        for entry in entries {
            let expected = crate::inspect(Path::new(&entry.path), 0, Some(0)).unwrap();
            assert_eq!(entry.identity, expected.identity);
            assert_eq!(entry.size, expected.size);
            assert_eq!(entry.allocated, expected.allocated);
            assert_eq!(entry.modified, expected.modified);
            if !entry.directory {
                assert_eq!(entry.links, expected.links);
            }
        }
    }
    #[test]
    fn corrupt_records_never_read_past_buffer() {
        for size in 0..100 {
            assert!(parse(&vec![0u8; size], Path::new("/"), 0).is_err());
        }
    }
}
