//! Read-only storage index. Mutation stays in Electron's main process.
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, Metadata},
    io::{self, BufRead, Read, Seek, SeekFrom, Write},
    path::Path,
    time::{Instant, UNIX_EPOCH},
};

const MAX_ENTRIES: usize = 2_000_000;
#[cfg(target_os = "macos")]
mod macos_bulk;

fn read_directory(directory: &Path, parent: usize) -> (Vec<Entry>, usize, usize) {
    #[cfg(target_os = "macos")]
    if std::env::var_os("MEMENTO_STANDARD_READDIR").is_none() {
        if let Ok((entries, skipped)) = macos_bulk::read(directory, parent) {
            return (entries, 0, skipped);
        }
    }
    let mut entries = Vec::new();
    let mut errors = 0;
    let mut skipped = 0;
    match fs::read_dir(directory) {
        Ok(reader) => {
            for child in reader {
                match child {
                    Ok(child) => match inspect(&child.path(), 0, Some(parent)) {
                        Ok(entry) => entries.push(entry),
                        Err(_) => skipped += 1,
                    },
                    Err(_) => errors += 1,
                }
            }
        }
        Err(_) => errors += 1,
    }
    (entries, errors, skipped)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: usize,
    parent: Option<usize>,
    name: String,
    path: String,
    directory: bool,
    size: u64,
    allocated: u64,
    modified: u64,
    identity: String,
    links: u64,
}

#[cfg(not(windows))]
fn identity(m: &Metadata) -> (String, u64, u64) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (
            format!("{}:{}", m.dev(), m.ino()),
            m.nlink(),
            m.blocks() * 512,
        )
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        (
            format!(
                "{}:{}:{}",
                m.creation_time(),
                m.last_write_time(),
                m.file_size()
            ),
            1,
            m.file_size(),
        )
    }
    #[cfg(not(any(unix, windows)))]
    {
        (format!("{}", m.len()), 1, m.len())
    }
}

fn offline_or_link(m: &Metadata) -> bool {
    if m.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        if m.st_flags() & 0x40000000 != 0 {
            return true;
        } // UF_DATALESS: never recall iCloud data
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0 {
            return true;
        }
    }
    false
}

fn inspect(path: &Path, id: usize, parent: Option<usize>) -> Result<Entry, String> {
    let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if offline_or_link(&m) || !(m.is_file() || m.is_dir()) {
        return Err("link, placeholder or special file".into());
    }
    let (identity, links, allocated) = file_identity(path, &m)?;
    Ok(Entry {
        id,
        parent,
        name: path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into(),
        path: path.to_string_lossy().into(),
        directory: m.is_dir(),
        size: if m.is_file() { m.len() } else { 0 },
        allocated: if m.is_file() { allocated } else { 0 },
        modified: m
            .modified()
            .ok()
            .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
            .map(|v| v.as_nanos() as u64)
            .unwrap_or(0),
        identity,
        links,
    })
}

fn file_identity(_path: &Path, m: &Metadata) -> Result<(String, u64, u64), String> {
    #[cfg(windows)]
    {
        use std::{
            mem::MaybeUninit,
            os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
        };
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
            FILE_SHARE_WRITE,
        };
        let file = fs::OpenOptions::new()
            .read(true)
            .access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            // Directory handles need BACKUP_SEMANTICS; reparse points must stay unopened.
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(_path)
            .map_err(|e| e.to_string())?;
        let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
        // SAFETY: handle is owned by File; output is correctly sized and checked before use.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, info.as_mut_ptr()) } == 0
        {
            return Err(io::Error::last_os_error().to_string());
        }
        let info = unsafe { info.assume_init() };
        return Ok((
            format!(
                "{}:{}:{}",
                info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
            ),
            info.nNumberOfLinks as u64,
            m.len(),
        ));
    }
    #[cfg(not(windows))]
    {
        Ok(identity(m))
    }
}

fn emit(v: Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

#[derive(Default)]
struct Index {
    entries: Vec<Entry>,
    errors: usize,
    skipped: usize,
    limited: bool,
    elapsed: u128,
    generation: u64,
}

impl Index {
    fn scan(&mut self, root: &str, request: u64) -> Result<Value, String> {
        let started = Instant::now();
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let root = {
            let value = root.to_string_lossy();
            // Use ordinary shell-compatible paths in IPC, including UNC shares.
            let value = if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
                format!(r"\\{unc}")
            } else {
                value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
            };
            std::path::PathBuf::from(value)
        };
        if !root.is_dir() {
            return Err("Choose a directory".into());
        }
        self.entries.clear();
        self.errors = 0;
        self.skipped = 0;
        self.limited = false;
        self.generation += 1;
        self.entries.push(inspect(&root, 0, None)?);
        let mut pending = vec![0usize];
        let mut last = Instant::now();
        while !pending.is_empty() && self.entries.len() < MAX_ENTRIES {
            let end = pending.len().min(128);
            let batch: Vec<_> = pending
                .drain(..end)
                .map(|id| (id, self.entries[id].path.clone()))
                .collect();
            let results: Vec<_> = batch
                .par_iter()
                .map(|(parent, directory)| read_directory(Path::new(directory), *parent))
                .collect();
            for (children, errors, skipped) in results {
                self.errors += errors;
                self.skipped += skipped;
                for mut entry in children {
                    if self.entries.len() >= MAX_ENTRIES {
                        self.limited = true;
                        break;
                    }
                    if entry.identity.split(':').next()
                        != self.entries[0].identity.split(':').next()
                    {
                        self.skipped += 1;
                        continue;
                    }
                    entry.id = self.entries.len();
                    if entry.directory {
                        pending.push(entry.id);
                    }
                    self.entries.push(entry);
                }
            }
            if last.elapsed().as_millis() >= 150 {
                emit(
                    json!({"event":"progress", "request":request, "phase":"indexing", "entries":self.entries.len(), "errors":self.errors, "skipped":self.skipped, "elapsedMs":started.elapsed().as_millis(), "path":batch.last().map(|v| &v.1)}),
                );
                last = Instant::now();
            }
        }
        self.limited |= !pending.is_empty();
        // Count hard-linked data once. Both names remain visible, but aren't duplicate candidates.
        let mut identities = HashSet::new();
        for entry in &mut self.entries {
            if !entry.directory && !identities.insert(entry.identity.clone()) {
                entry.allocated = 0;
            }
        }
        for i in (1..self.entries.len()).rev() {
            let entry = &self.entries[i];
            let (parent, size, allocated) = (entry.parent.unwrap(), entry.size, entry.allocated);
            self.entries[parent].size = self.entries[parent].size.saturating_add(size);
            self.entries[parent].allocated =
                self.entries[parent].allocated.saturating_add(allocated);
        }
        self.elapsed = started.elapsed().as_millis();
        Ok(self.summary())
    }
    fn summary(&self) -> Value {
        json!({"generation":self.generation,"root":self.entries.first(),"entries":self.entries.len(),"errors":self.errors,"skipped":self.skipped,"limited":self.limited,"elapsedMs":self.elapsed})
    }
    fn get(&self, id: usize) -> Result<&Entry, String> {
        self.entries.get(id).ok_or("Unknown index entry".into())
    }
    fn validate(&self, id: usize) -> Result<&Entry, String> {
        let old = self.get(id)?;
        let path = Path::new(&old.path);
        for component in path.ancestors() {
            let metadata = fs::symlink_metadata(component).map_err(|e| e.to_string())?;
            if offline_or_link(&metadata) {
                return Err("Path changed or became a link".into());
            }
        }
        let fresh = inspect(path, id, old.parent)?;
        if fresh.identity != old.identity
            || (!old.directory && (fresh.size != old.size || fresh.modified != old.modified))
        {
            return Err("Item changed since scan; scan again".into());
        }
        Ok(old)
    }
    fn duplicates(&self, request: u64) -> Result<Value, String> {
        let started = Instant::now();
        let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
        for entry in &self.entries {
            if !entry.directory && entry.size >= 1024 && entry.links == 1 {
                by_size.entry(entry.size).or_default().push(entry.id);
            }
        }
        let candidates: Vec<_> = by_size
            .into_values()
            .filter(|v| v.len() > 1)
            .flatten()
            .collect();
        emit(
            json!({"event":"progress","request":request,"phase":"sampling","entries":candidates.len(),"elapsedMs":0}),
        );
        let samples: Vec<_> = candidates
            .par_iter()
            .filter_map(|id| self.hash(*id, true).ok().map(|hash| (hash, *id)))
            .collect();
        let mut by_sample: HashMap<(u64, String), Vec<usize>> = HashMap::new();
        for (hash, id) in samples {
            by_sample
                .entry((self.entries[id].size, hash))
                .or_default()
                .push(id);
        }
        let candidates: Vec<_> = by_sample
            .into_values()
            .filter(|v| v.len() > 1)
            .flatten()
            .collect();
        emit(
            json!({"event":"progress","request":request,"phase":"hashing","entries":candidates.len(),"elapsedMs":started.elapsed().as_millis()}),
        );
        let hashes: Vec<_> = candidates
            .par_iter()
            .filter_map(|id| self.hash(*id, false).ok().map(|hash| (hash, *id)))
            .collect();
        let mut groups: HashMap<String, Vec<&Entry>> = HashMap::new();
        for (hash, id) in hashes {
            groups.entry(hash).or_default().push(&self.entries[id]);
        }
        let mut result: Vec<_> = groups
            .into_iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|(hash, mut files)| {
                files.sort_by(|a, b| a.modified.cmp(&b.modified).then(a.path.cmp(&b.path)));
                let reclaimable: u64 = files.iter().skip(1).map(|e| e.allocated).sum();
                json!({"id":hash,"files":files,"reclaimable":reclaimable})
            })
            .collect();
        result.sort_by_key(|v| std::cmp::Reverse(v["reclaimable"].as_u64().unwrap_or(0)));
        Ok(json!({"groups":result,"elapsedMs":started.elapsed().as_millis()}))
    }
    fn hash(&self, id: usize, sample: bool) -> Result<String, String> {
        let entry = self.validate(id)?;
        if entry.directory {
            return Err("Not a file".into());
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let mut file = options.open(&entry.path).map_err(|e| e.to_string())?;
        let before = file.metadata().map_err(|e| e.to_string())?;
        if file_identity(Path::new(&entry.path), &before)?.0 != entry.identity
            || before.len() != entry.size
        {
            return Err("File changed".into());
        }
        let mut hash = blake3::Hasher::new();
        let mut buffer = vec![0u8; if sample { 8192 } else { 256 * 1024 }];
        if sample {
            for offset in [
                0,
                entry.size.saturating_sub(8192) / 2,
                entry.size.saturating_sub(8192),
            ] {
                file.seek(SeekFrom::Start(offset))
                    .map_err(|e| e.to_string())?;
                let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                hash.update(&buffer[..n]);
            }
        } else {
            loop {
                let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
        }
        let after = file.metadata().map_err(|e| e.to_string())?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err("File changed while hashing".into());
        }
        self.validate(id)?;
        Ok(hash.finalize().to_hex().to_string())
    }
}

#[derive(Deserialize)]
struct Request {
    request: u64,
    command: String,
    #[serde(default)]
    args: Value,
}

fn system() -> Value {
    use sysinfo::{Disks, System};
    let mut s = System::new_all();
    s.refresh_all();
    std::thread::sleep(std::time::Duration::from_millis(220));
    s.refresh_all();
    let disks = Disks::new_with_refreshed_list();
    let own = s
        .process(sysinfo::Pid::from_u32(std::process::id()))
        .and_then(|p| p.user_id());
    let mut processes: Vec<_> = s.processes().iter().map(|(pid,p)| json!({"pid":pid.as_u32(),"name":p.name().to_string_lossy(),"command":p.exe().map(|v|v.to_string_lossy().to_string()).unwrap_or_default(),"cpuPercent":p.cpu_usage(),"memoryBytes":p.memory(),"memoryPercent":p.memory() as f64 / s.total_memory().max(1) as f64 * 100.0,"isSystem":pid.as_u32() <= 4 || own.is_none() || p.user_id()!=own})).collect();
    processes.sort_by(|a, b| b["memoryBytes"].as_u64().cmp(&a["memoryBytes"].as_u64()));
    processes.truncate(200);
    json!({"hostname":System::host_name(),"osVersion":System::long_os_version(),"totalMemory":s.total_memory(),"usedMemory":s.used_memory(),"cpu":s.global_cpu_usage(),"processes":processes,"processCommands":s.processes().values().filter_map(|p|p.exe().map(|v|v.to_string_lossy().to_string())).collect::<Vec<_>>(),"processNames":s.processes().values().map(|p|p.name().to_string_lossy().to_string()).collect::<Vec<_>>(),"disks":disks.iter().map(|d|json!({"mount":d.mount_point(),"total":d.total_space(),"free":d.available_space()})).collect::<Vec<_>>()})
}

fn terminate(pid: u32, force: bool) -> Result<Value, String> {
    use sysinfo::{Pid, Signal, System};
    let system = System::new_all();
    let own_pid = Pid::from_u32(std::process::id());
    let own = system
        .process(own_pid)
        .ok_or("Cannot verify current user")?;
    let target = system
        .process(Pid::from_u32(pid))
        .ok_or("Process has exited")?;
    if pid <= 4 || own.user_id().is_none() || target.user_id() != own.user_id() {
        return Err("System or another user's process is protected".into());
    }
    let mut ancestor = Some(own_pid);
    while let Some(id) = ancestor {
        if id.as_u32() == pid {
            return Err("Memento and its parent processes are protected".into());
        }
        ancestor = system.process(id).and_then(|p| p.parent());
    }
    let signal = if force { Signal::Kill } else { Signal::Term };
    let success = target.kill_with(signal).unwrap_or(false);
    if success {
        Ok(json!({"ok":true}))
    } else {
        Err("The platform could not send this signal. Use force quit if appropriate.".into())
    }
}

fn handle(index: &mut Index, req: &Request) -> Result<Value, String> {
    let id = req.args["id"].as_u64().unwrap_or(0) as usize;
    match req.command.as_str() {
        "scan" => index.scan(
            req.args["root"].as_str().ok_or("Missing root")?,
            req.request,
        ),
        "summary" => Ok(index.summary()),
        "children" => {
            let mut children: Vec<_> = index
                .entries
                .iter()
                .filter(|e| e.parent == Some(id))
                .collect();
            children.sort_by_key(|e| std::cmp::Reverse(e.size));
            Ok(
                json!({"parent":index.get(id)?,"items":children.into_iter().skip(req.args["offset"].as_u64().unwrap_or(0) as usize).take(200).collect::<Vec<_>>()}),
            )
        }
        "large" => {
            let min = req.args["minimum"].as_u64().unwrap_or(100 * 1024 * 1024);
            let search = req.args["search"].as_str().unwrap_or("").to_lowercase();
            let mut items: Vec<_> = index
                .entries
                .iter()
                .filter(|e| {
                    !e.directory && e.size >= min && e.name.to_lowercase().contains(&search)
                })
                .collect();
            items.sort_by_key(|e| std::cmp::Reverse(e.size));
            let count = items.len();
            Ok(
                json!({"count":count,"items":items.into_iter().skip(req.args["offset"].as_u64().unwrap_or(0) as usize).take(100).collect::<Vec<_>>()}),
            )
        }
        "entry" => Ok(json!(index.validate(id)?)),
        "duplicates" => index.duplicates(req.request),
        "hash" => Ok(json!({"hash":index.hash(id, false)?})),
        "system" => Ok(system()),
        "terminate" => terminate(
            req.args["pid"].as_u64().ok_or("Missing PID")? as u32,
            req.args["force"].as_bool().unwrap_or(false),
        ),
        "measure" => {
            let paths = req.args["paths"].as_array().ok_or("Missing paths")?;
            let results: Vec<_> = paths
                .par_iter()
                .map(|v| {
                    let root = v.as_str().unwrap_or("");
                    let mut pending = Vec::new();
                    let mut bytes = 0u64;
                    let mut errors = 0usize;
                    let mut count = 0usize;
                    match inspect(Path::new(root), 0, None) {
                        Ok(e) if e.directory => pending.push(std::path::PathBuf::from(root)),
                        Ok(e) => bytes = e.allocated,
                        Err(_) => errors += 1,
                    }
                    while let Some(path) = pending.pop() {
                        let (entries, failed, skipped) = read_directory(&path, 0);
                        errors += failed + skipped;
                        count += entries.len();
                        if count > MAX_ENTRIES {
                            errors += 1;
                            break;
                        }
                        for entry in entries {
                            if entry.directory {
                                pending.push(entry.path.into())
                            } else {
                                bytes = bytes.saturating_add(entry.allocated)
                            }
                        }
                    }
                    json!({"path":root,"size":bytes,"errors":errors})
                })
                .collect();
            Ok(json!(results))
        }
        _ => Err("Unknown command".into()),
    }
}

fn main() {
    rayon::ThreadPoolBuilder::new()
        .num_threads(
            std::thread::available_parallelism()
                .map(|v| v.get())
                .unwrap_or(2)
                .clamp(2, 4),
        )
        .build_global()
        .unwrap();
    let mut index = Index::default();
    for line in io::stdin().lock().lines() {
        let line = match line {
            Ok(v) => v,
            Err(_) => break,
        };
        let req: Request = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                emit(json!({"error":e.to_string()}));
                continue;
            }
        };
        match handle(&mut index, &req) {
            Ok(result) => emit(json!({"request":req.request,"result":result})),
            Err(error) => emit(json!({"request":req.request,"error":error})),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn index_groups_only_equal_content_and_revalidates_changes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("a"), vec![7u8; 4096]).unwrap();
        fs::write(root.join("nested/b"), vec![7u8; 4096]).unwrap();
        fs::write(root.join("c"), vec![9u8; 4096]).unwrap();
        let mut index = Index::default();
        index.scan(root.to_str().unwrap(), 1).unwrap();
        assert_eq!(index.entries[0].size, 12288);
        let groups = index.duplicates(2).unwrap();
        assert_eq!(groups["groups"].as_array().unwrap().len(), 1);
        let id = index.entries.iter().find(|e| e.name == "a").unwrap().id;
        fs::write(root.join("a"), b"changed").unwrap();
        assert!(index.validate(id).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn links_do_not_escape_or_become_reclaimable_copies() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a"), vec![1u8; 2048]).unwrap();
        fs::hard_link(dir.path().join("a"), dir.path().join("b")).unwrap();
        std::os::unix::fs::symlink("/", dir.path().join("escape")).unwrap();
        let mut index = Index::default();
        index.scan(dir.path().to_str().unwrap(), 1).unwrap();
        assert_eq!(index.entries.len(), 3);
        assert_eq!(index.skipped, 1);
        assert!(index.duplicates(2).unwrap()["groups"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    #[test]
    fn full_hash_rejects_sample_collisions() {
        let dir = tempfile::tempdir().unwrap();
        let a = vec![5u8; 128 * 1024];
        let mut b = a.clone();
        b[20000] = 9;
        fs::write(dir.path().join("a"), a).unwrap();
        fs::write(dir.path().join("b"), b).unwrap();
        let mut index = Index::default();
        index.scan(dir.path().to_str().unwrap(), 1).unwrap();
        assert_eq!(index.hash(1, true).unwrap(), index.hash(2, true).unwrap());
        assert!(index.duplicates(2).unwrap()["groups"]
            .as_array()
            .unwrap()
            .is_empty());
    }
}
