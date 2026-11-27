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

const NONE: u32 = u32::MAX;
#[cfg(target_os = "macos")]
mod macos_bulk;

fn read_directory(directory: &Path, parent: usize) -> (Vec<Entry>, usize, usize) {
    #[cfg(target_os = "macos")]
    if std::env::var_os("DISKCOLLIE_STANDARD_READDIR").is_none() {
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
                "{}:{}",
                info.dwVolumeSerialNumber,
                ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64
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

// Paths are reconstructed only for visible results and I/O. One compact record per
// retained item, with linked child lists, avoids millions of full path allocations.
struct Record {
    name: Box<str>,
    parent: u32,
    first: u32,
    next: u32,
    directory: bool,
    size: u64,
    allocated: u64,
    modified: u64,
    volume: u64,
    file: u64,
    links: u64,
}
impl Record {
    fn from(e: &Entry) -> Self {
        let mut identity = e.identity.split(':').map(|v| v.parse::<u64>().unwrap_or(0));
        Self {
            name: e.name.clone().into_boxed_str(),
            parent: e.parent.map(|v| v as u32).unwrap_or(NONE),
            first: NONE,
            next: NONE,
            directory: e.directory,
            size: e.size,
            allocated: e.allocated,
            modified: e.modified,
            volume: identity.next().unwrap_or(0),
            file: identity.next().unwrap_or(0),
            links: e.links,
        }
    }
}
#[derive(Default)]
struct Index {
    entries: Vec<Record>,
    removed: HashSet<usize>,
    root: String,
    visited: usize,
    errors: usize,
    skipped: usize,
    elapsed: u128,
    generation: u64,
    mode: String,
    hashes: std::sync::Mutex<HashMap<(u64, u64, u64, u64, bool), String>>,
}
impl Index {
    #[cfg(test)]
    fn scan(&mut self, root: &str, request: u64) -> Result<Value, String> {
        self.scan_options(root, request, &json!({}))
    }
    fn scan_options(&mut self, root: &str, request: u64, options: &Value) -> Result<Value, String> {
        let started = Instant::now();
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let root = {
            let v = root.to_string_lossy();
            std::path::PathBuf::from(if let Some(unc) = v.strip_prefix(r"\\?\UNC\") {
                format!(r"\\{unc}")
            } else {
                v.strip_prefix(r"\\?\").unwrap_or(&v).to_string()
            })
        };
        if !root.is_dir() {
            return Err("Choose a directory".into());
        }
        self.entries = Vec::new();
        self.removed.clear();
        self.root = root.to_string_lossy().into();
        self.errors = 0;
        self.skipped = 0;
        self.visited = 1;
        self.generation += 1;
        self.mode = options["mode"].as_str().unwrap_or("analysis").to_string();
        let minimum = if self.mode == "large" {
            10 * 1024 * 1024
        } else {
            options["minimum"].as_u64().unwrap_or(200 * 1024)
        };
        let include_hidden = options["includeHidden"].as_bool().unwrap_or(false);
        let excluded: Vec<_> = options["excludePaths"]
            .as_array()
            .map(|v| v.iter().filter_map(|v| v.as_str()).map(|p| fs::canonicalize(p).unwrap_or_else(|_| std::path::PathBuf::from(p))).collect())
            .unwrap_or_default();
        let excluded_names: Vec<_> = options["excludeNames"].as_array()
            .map(|names| names.iter().filter_map(|name| name.as_str()).collect())
            .unwrap_or_default();
        self.entries.push(Record::from(&inspect(&root, 0, None)?));
        #[allow(unused_mut)] // mutated only for macOS system/Data firmlinks below
        let mut volumes = HashSet::from([self.entries[0].volume]);
        // APFS firmlinks can cross from the system volume to Data. Traverse their
        // ordinary paths once; never descend through /System/Volumes aliases.
        #[cfg(target_os = "macos")]
        if root == Path::new("/") {
            if let Ok(e) = inspect(Path::new("/Users"), 0, None) {
                volumes.insert(Record::from(&e).volume);
            }
        }
        let mut directories = HashSet::from([(self.entries[0].volume, self.entries[0].file)]);
        let mut hardlinks = HashSet::new();
        let mut pending = std::collections::VecDeque::from([0usize]);
        let mut last = Instant::now();
        while !pending.is_empty() {
            let batch: Vec<_> = (0..pending.len().min(128))
                .filter_map(|_| pending.pop_front())
                .map(|id| (id, self.path(id)))
                .collect();
            let results: Vec<_> = batch
                .par_iter()
                .map(|(id, p)| read_directory(Path::new(p), *id))
                .collect();
            for (children, errors, skipped) in results {
                self.errors += errors;
                self.skipped += skipped;
                for entry in children {
                    self.visited += 1;
                    if excluded.contains(&std::path::PathBuf::from(&entry.path))
                        || excluded_names.iter().any(|name| if cfg!(windows) {entry.name.eq_ignore_ascii_case(name)} else {entry.name == *name}) {
                        self.skipped += 1;
                        continue;
                    }
                    let mut record = Record::from(&entry);
                    let parent = record.parent as usize;
                    if !volumes.contains(&record.volume) {
                        self.skipped += 1;
                        continue;
                    }
                    if entry.directory {
                        if (root == Path::new("/")
                            && (entry.path == "/System/Volumes" || entry.path == "/Volumes"))
                            || (!include_hidden && entry.name.starts_with('.'))
                            || !directories.insert((record.volume, record.file))
                        {
                            self.skipped += 1;
                            continue;
                        }
                    } else {
                        if record.links > 1 && !hardlinks.insert((record.volume, record.file)) {
                            record.allocated = 0;
                        }
                        let retain = self.mode == "analysis"
                            || (record.size >= minimum
                                && (self.mode != "duplicates"
                                    || (record.links == 1 && entry.name != ".DS_Store")));
                        if !retain {
                            self.entries[parent].size =
                                self.entries[parent].size.saturating_add(record.size);
                            self.entries[parent].allocated = self.entries[parent]
                                .allocated
                                .saturating_add(record.allocated);
                            continue;
                        }
                    }
                    let id = self.entries.len();
                    if id >= NONE as usize {
                        return Err("Index exceeds addressable memory".into());
                    }
                    record.next = self.entries[parent].first;
                    self.entries[parent].first = id as u32;
                    if record.directory {
                        pending.push_back(id)
                    }
                    self.entries.push(record);
                }
            }
            if last.elapsed().as_millis() >= 120 {
                emit(
                    json!({"event":"progress","request":request,"phase":"indexing","entries":self.visited,"errors":self.errors,"skipped":self.skipped,"elapsedMs":started.elapsed().as_millis(),"path":batch.last().map(|v|&v.1)}),
                );
                last = Instant::now();
            }
        }
        for i in (1..self.entries.len()).rev() {
            let e = &self.entries[i];
            let (p, s, a) = (e.parent as usize, e.size, e.allocated);
            self.entries[p].size = self.entries[p].size.saturating_add(s);
            self.entries[p].allocated = self.entries[p].allocated.saturating_add(a);
        }
        self.elapsed = started.elapsed().as_millis();
        Ok(self.summary())
    }
    fn path(&self, id: usize) -> String {
        let mut parts = Vec::new();
        let mut current = id;
        while current != 0 {
            let e = &self.entries[current];
            parts.push(e.name.as_ref());
            current = e.parent as usize;
        }
        let mut p = std::path::PathBuf::from(&self.root);
        for part in parts.iter().rev() {
            p.push(part)
        }
        p.to_string_lossy().into()
    }
    fn summary(&self) -> Value {
        json!({"generation":self.generation,"root":if self.entries.is_empty(){None}else{self.get(0).ok()},"entries":self.visited,"retained":self.entries.len(),"errors":self.errors,"skipped":self.skipped,"limited":false,"elapsedMs":self.elapsed,"mode":self.mode})
    }
    fn get(&self, id: usize) -> Result<Entry, String> {
        if self.removed.contains(&id) {
            return Err("Item was removed".into());
        }
        let e = self.entries.get(id).ok_or("Unknown index entry")?;
        Ok(Entry {
            id,
            parent: if e.parent == NONE {
                None
            } else {
                Some(e.parent as usize)
            },
            name: e.name.to_string(),
            path: self.path(id),
            directory: e.directory,
            size: e.size,
            allocated: e.allocated,
            modified: e.modified,
            identity: format!("{}:{}", e.volume, e.file),
            links: e.links,
        })
    }
    fn validate(&self, id: usize) -> Result<Entry, String> {
        let old = self.get(id)?;
        let path = Path::new(&old.path);
        for component in path.ancestors() {
            let m = fs::symlink_metadata(component).map_err(|e| e.to_string())?;
            if offline_or_link(&m) {
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
    #[cfg(test)]
    fn duplicates(&self, request: u64) -> Result<Value, String> {
        self.duplicates_minimum(request, 1024)
    }
    fn duplicates_minimum(&self, request: u64, minimum: u64) -> Result<Value, String> {
        let started = Instant::now();
        let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
        for (id, e) in self.entries.iter().enumerate() {
            if !self.removed.contains(&id) && !e.directory && e.size >= minimum && e.links == 1 {
                by_size.entry(e.size).or_default().push(id)
            }
        }
        let candidates: Vec<_> = by_size
            .into_values()
            .filter(|v| v.len() > 1)
            .flatten()
            .collect();
        let samples = self.hash_stage(&candidates, true, request, "sampling", started);
        let mut by_sample: HashMap<(u64, String), Vec<usize>> = HashMap::new();
        for (hash, id) in samples {
            by_sample
                .entry((self.entries[id].size, hash))
                .or_default()
                .push(id)
        }
        let candidates: Vec<_> = by_sample
            .into_values()
            .filter(|v| v.len() > 1)
            .flatten()
            .collect();
        let hashes = self.hash_stage(&candidates, false, request, "hashing", started);
        let mut groups: HashMap<String, Vec<Entry>> = HashMap::new();
        for (hash, id) in hashes {
            if let Ok(e) = self.get(id) {
                groups.entry(hash).or_default().push(e)
            }
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
    fn hash_stage(
        &self,
        ids: &[usize],
        sample: bool,
        request: u64,
        phase: &str,
        started: Instant,
    ) -> Vec<(String, usize)> {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        };
        let done = AtomicUsize::new(0);
        let last = Mutex::new(Instant::now());
        emit(
            json!({"event":"progress","request":request,"phase":phase,"entries":0,"total":ids.len(),"elapsedMs":started.elapsed().as_millis()}),
        );
        ids.par_iter().filter_map(|id|{let result=self.hash_file(*id,sample,false).ok().map(|hash|(hash,*id));let n=done.fetch_add(1,Ordering::Relaxed)+1;if let Ok(mut clock)=last.try_lock(){if clock.elapsed().as_millis()>=120 || n==ids.len(){emit(json!({"event":"progress","request":request,"phase":phase,"entries":n,"total":ids.len(),"elapsedMs":started.elapsed().as_millis()}));*clock=Instant::now();}}result}).collect()
    }
    fn hash(&self, id: usize, sample: bool) -> Result<String, String> {
        self.hash_file(id, sample, true)
    }
    fn hash_file(&self, id: usize, sample: bool, strict: bool) -> Result<String, String> {
        let entry = if strict {
            self.validate(id)?
        } else {
            self.get(id)?
        };
        if entry.directory {
            return Err("Not a file".into());
        }
        // Discovery uses descriptor metadata; mutation always validates every path
        // component and bypasses this session cache, including the surviving copy.
        let key = (
            self.entries[id].volume,
            self.entries[id].file,
            entry.size,
            entry.modified,
            sample,
        );
        let fresh = inspect(Path::new(&entry.path), id, entry.parent)?;
        if fresh.identity != entry.identity
            || fresh.size != entry.size
            || fresh.modified != entry.modified
        {
            return Err("File changed".into());
        }
        // Coarse filesystem clocks can give consecutive writes the same mtime.
        // Recently modified (or future-dated) files must be read again. Stable
        // cached previews still never authorize removal: strict hashing bypasses all caches.
        let stable = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .is_some_and(|now| {
                now.as_nanos().saturating_sub(entry.modified as u128) >= 4_000_000_000
            });
        if !strict && stable {
            if let Some(hash) = self.hashes.lock().unwrap().get(&key) {
                return Ok(hash.clone());
            }
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
        if offline_or_link(&before)
            || file_identity(Path::new(&entry.path), &before)?.0 != entry.identity
            || before.len() != entry.size
            || before
                .modified()
                .ok()
                .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
                .map(|v| v.as_nanos() as u64)
                .unwrap_or(0)
                != entry.modified
        {
            return Err("File changed".into());
        }
        let mut hash = blake3::Hasher::new();
        let mut buffer = vec![0u8; if sample { 16 * 1024 } else { 1024 * 1024 }];
        if sample {
            for offset in [
                0,
                entry.size.saturating_sub(16384) / 2,
                entry.size.saturating_sub(16384),
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
        if strict {
            self.validate(id)?;
        }
        let hash = hash.finalize().to_hex().to_string();
        if !strict {
            let mut cache = self.hashes.lock().unwrap();
            if cache.len() >= 100_000 {
                cache.clear()
            }
            cache.insert(key, hash.clone());
        }
        Ok(hash)
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
            return Err("DiskCollie and its parent processes are protected".into());
        }
        ancestor = system.process(id).and_then(|p| p.parent());
    }
    let signal = if force { Signal::Kill } else { Signal::Term };
    let success = target.kill_with(signal).unwrap_or(false);
    if !success {
        return Err("The platform could not send this signal. Use force quit if appropriate.".into());
    }
    let started = target.start_time();
    for _ in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(120));
        let fresh = System::new_all();
        if fresh.process(Pid::from_u32(pid)).is_none_or(|p| p.start_time() != started) {
            return Ok(json!({"ok":true}));
        }
    }
    Err("The process is still running; exit could not be confirmed.".into())
}

fn handle(index: &mut Index, req: &Request) -> Result<Value, String> {
    let id = req.args["id"].as_u64().unwrap_or(0) as usize;
    match req.command.as_str() {
        "scan" => index.scan_options(
            req.args["root"].as_str().ok_or("Missing root")?,
            req.request,
            &req.args,
        ),
        "forget" => {
            let paths = req.args["paths"].as_array().ok_or("Missing paths")?;
            // Only reconcile main-process-confirmed removals; IDs remain stable.
            for id in 1..index.entries.len() {
                if index.removed.contains(&id) {
                    continue;
                }
                let current = index.path(id);
                if paths
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|p| Path::new(&current).starts_with(p))
                {
                    index.removed.insert(id);
                    if !index.entries[id].directory {
                        let size = index.entries[id].size;
                        let allocated = index.entries[id].allocated;
                        let mut parent = index.entries[id].parent;
                        while parent != NONE {
                            let record = &mut index.entries[parent as usize];
                            record.size = record.size.saturating_sub(size);
                            record.allocated = record.allocated.saturating_sub(allocated);
                            parent = record.parent;
                        }
                    }
                }
            }
            Ok(index.summary())
        }
        "summary" => Ok(index.summary()),
        "children" => {
            index.get(id)?;
            let mut children = Vec::new();
            let mut child = index.entries[id].first;
            while child != NONE {
                if !index.removed.contains(&(child as usize)) {
                    children.push(child as usize);
                }
                child = index.entries[child as usize].next;
            }
            children.sort_by_key(|i| std::cmp::Reverse(index.entries[*i].size));
            Ok(
                json!({"parent":index.get(id)?,"items":children.into_iter().skip(req.args["offset"].as_u64().unwrap_or(0) as usize).take(200).filter_map(|i|index.get(i).ok()).collect::<Vec<_>>()}),
            )
        }
        "large" => {
            let min = req.args["minimum"].as_u64().unwrap_or(100 * 1024 * 1024);
            let search = req.args["search"].as_str().unwrap_or("").to_lowercase();
            let selected = req.args["category"].as_str().unwrap_or("all");
            let mut counts: HashMap<String, usize> = HashMap::new();
            let mut items = Vec::new();
            for (id, e) in index.entries.iter().enumerate() {
                if index.removed.contains(&id)
                    || e.directory
                    || e.size < min
                    || !e.name.to_lowercase().contains(&search)
                {
                    continue;
                }
                let extension = e
                    .name
                    .rsplit_once('.')
                    .map(|(_, v)| v.to_lowercase())
                    .unwrap_or_default();
                let category = req.args["categories"]
                    .as_object()
                    .and_then(|categories| {
                        categories.iter().find(|(_, exts)| {
                            exts.as_array().is_some_and(|exts| {
                                exts.iter().any(|ext| ext.as_str() == Some(&extension))
                            })
                        })
                    })
                    .map(|(key, _)| key.as_str())
                    .unwrap_or("other");
                *counts.entry(category.into()).or_default() += 1;
                if selected == "all" || selected == category {
                    items.push(id)
                }
            }
            items.sort_by_key(|id| std::cmp::Reverse(index.entries[*id].size));
            let count = items.len();
            Ok(
                json!({"count":count,"categories":counts,"items":items.into_iter().skip(req.args["offset"].as_u64().unwrap_or(0) as usize).take(100).filter_map(|id|index.get(id).ok()).collect::<Vec<_>>()}),
            )
        }
        "entry" => Ok(json!(index.validate(id)?)),
        "duplicates" => {
            index.duplicates_minimum(req.request, req.args["minimum"].as_u64().unwrap_or(1024))
        }
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
                    match inspect(Path::new(root), 0, None) {
                        Ok(e) if e.directory => pending.push(std::path::PathBuf::from(root)),
                        Ok(e) => bytes = e.allocated,
                        Err(_) => errors += 1,
                    }
                    while let Some(path) = pending.pop() {
                        let (entries, failed, skipped) = read_directory(&path, 0);
                        errors += failed + skipped;
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
        let id = index
            .entries
            .iter()
            .position(|e| e.name.as_ref() == "a")
            .unwrap();
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
        b[30000] = 9;
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
    #[test]
    fn projections_prune_candidates_without_losing_directory_totals() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".hidden")).unwrap();
        fs::create_dir(dir.path().join("visible")).unwrap();
        fs::write(dir.path().join(".hidden/large"), vec![1; 220_000]).unwrap();
        fs::write(dir.path().join("visible/a"), vec![3; 220_000]).unwrap();
        fs::write(dir.path().join("visible/b"), vec![3; 220_000]).unwrap();
        fs::write(dir.path().join("tiny"), vec![9; 32]).unwrap();
        let mut index = Index::default();
        index
            .scan_options(
                dir.path().to_str().unwrap(),
                1,
                &json!({"mode":"duplicates","minimum":200*1024}),
            )
            .unwrap();
        assert_eq!(index.get(0).unwrap().size, 440_032);
        assert_eq!(index.entries.len(), 4); // root, visible, two candidates
        assert_eq!(
            index.duplicates_minimum(2, 200 * 1024).unwrap()["groups"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        index
            .scan_options(
                dir.path().to_str().unwrap(),
                3,
                &json!({"mode":"duplicates","minimum":200*1024,"includeHidden":true}),
            )
            .unwrap();
        assert_eq!(index.get(0).unwrap().size, 660_032);
        // Explicit hidden roots are inspected even with the default child policy.
        index
            .scan_options(
                dir.path().join(".hidden").to_str().unwrap(),
                4,
                &json!({"mode":"duplicates"}),
            )
            .unwrap();
        assert_eq!(index.entries.len(), 2);
    }
    #[test]
    fn all_scan_modes_skip_hidden_directories_and_explicit_application_data_by_default() {
        let dir = tempfile::tempdir().unwrap();
        for name in [".hidden", "AppData", "Documents"] {
            fs::create_dir(dir.path().join(name)).unwrap();
            fs::write(dir.path().join(name).join("large.bin"), vec![1; 11 * 1024 * 1024]).unwrap();
        }
        for mode in ["analysis", "large", "duplicates"] {
            let mut index = Index::default();
            index.scan_options(dir.path().to_str().unwrap(), 1, &json!({"mode":mode,"excludePaths":[dir.path().join("AppData").to_str().unwrap()]})).unwrap();
            assert_eq!(index.entries.len(), 3);
            assert_eq!(index.get(0).unwrap().size, 11 * 1024 * 1024);
            index.scan_options(dir.path().to_str().unwrap(), 2, &json!({"mode":mode,"includeHidden":true})).unwrap();
            assert_eq!(index.entries.len(), 7);
        }
    }
    #[test]
    fn cleanup_exclusions_prune_protected_trees_and_names_before_duplicate_hashing() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["private/var/db", "Downloads", "Projects/.ssh", "private-copy"] {
            fs::create_dir_all(dir.path().join(name)).unwrap();
            for file in ["a.bin", "b.bin"] {
                fs::write(dir.path().join(name).join(file), vec![3; 2048]).unwrap();
            }
        }
        for mode in ["large", "duplicates"] {
            let mut index = Index::default();
            index.scan_options(dir.path().to_str().unwrap(), 1, &json!({"mode":mode,"minimum":1024,"includeHidden":true,"excludePaths":[dir.path().join("private")],"excludeNames":[".ssh"]})).unwrap();
            for id in 1..index.entries.len() {
                let entry = index.get(id).unwrap();
                assert!(!entry.path.starts_with(&dir.path().join("private").to_string_lossy().to_string()) || entry.path.contains("private-copy"));
                assert!(!entry.path.contains(".ssh"));
            }
            if mode == "duplicates" {
                let result = index.duplicates(2).unwrap();
                assert_eq!(result["groups"][0]["files"].as_array().unwrap().len(), 4);
            }
        }
    }
    #[test]
    fn cached_discovery_never_authorizes_changed_content() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a", "b"] {
            fs::write(dir.path().join(name), vec![1; 8192]).unwrap();
        }
        let mut index = Index::default();
        index.scan(dir.path().to_str().unwrap(), 1).unwrap();
        assert_eq!(
            index.duplicates(2).unwrap()["groups"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(!index.hashes.lock().unwrap().is_empty());
        let previous_hash = index.duplicates(2).unwrap()["groups"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let target = dir.path().join("b");
        let modified = fs::metadata(&target).unwrap().modified().unwrap();
        fs::write(&target, vec![2; 8192]).unwrap();
        // Reproduce coarse clocks deterministically, including fast NTFS writes.
        fs::OpenOptions::new()
            .write(true)
            .open(&target)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert!(index.duplicates(3).unwrap()["groups"]
            .as_array()
            .unwrap()
            .is_empty());
        let id = index
            .entries
            .iter()
            .position(|e| e.name.as_ref() == "b")
            .unwrap();
        assert_ne!(index.hash(id, false).unwrap(), previous_hash);
    }
    #[test]
    fn category_queries_count_before_pagination_and_preserve_children() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["movie.MOV", "copy.zip", "notes.pdf"] {
            fs::write(dir.path().join(name), vec![1; 2048]).unwrap();
        }
        let mut index = Index::default();
        index.scan(dir.path().to_str().unwrap(), 1).unwrap();
        let query = Request {
            request: 2,
            command: "large".into(),
            args: json!({"minimum":1,"category":"video","categories":{"video":["mov"],"archive":["zip"]}}),
        };
        let result = handle(&mut index, &query).unwrap();
        assert_eq!(result["count"], 1);
        assert_eq!(result["categories"]["other"], 1);
        assert_eq!(result["items"][0]["name"], "movie.MOV");
        let children = handle(
            &mut index,
            &Request {
                request: 3,
                command: "children".into(),
                args: json!({"id":0}),
            },
        )
        .unwrap();
        assert_eq!(children["items"].as_array().unwrap().len(), 3);
    }
    #[test]
    fn confirmed_removals_preserve_ids_queries_and_ancestor_totals() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("cache")).unwrap();
        for name in ["cache/a.mov", "cache/b.mov", "cache-other.mov", "keep.mov"] {
            fs::write(dir.path().join(name), vec![1; 2048]).unwrap();
        }
        let mut index = Index::default();
        index.scan(dir.path().to_str().unwrap(), 1).unwrap();
        let keep = index
            .entries
            .iter()
            .position(|e| e.name.as_ref() == "keep.mov")
            .unwrap();
        let removed = index
            .entries
            .iter()
            .position(|e| e.name.as_ref() == "cache")
            .unwrap();
        let location = index.get(removed).unwrap().path;
        let query = |command: &str, args: Value| Request {
            request: 2,
            command: command.into(),
            args,
        };
        handle(&mut index, &query("forget", json!({"paths":[location]}))).unwrap();
        assert_eq!(index.get(0).unwrap().size, 4096);
        assert_eq!(index.get(keep).unwrap().name, "keep.mov");
        assert!(index.get(removed).is_err());
        assert_eq!(
            handle(&mut index, &query("large", json!({"minimum":1}))).unwrap()["count"],
            2
        );
        let children = handle(&mut index, &query("children", json!({"id":0}))).unwrap();
        assert_eq!(children["items"].as_array().unwrap().len(), 2);
        assert_eq!(
            index.duplicates(3).unwrap()["groups"][0]["files"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        handle(&mut index, &query("forget", json!({"paths":[location]}))).unwrap();
        assert_eq!(
            index.get(0).unwrap().size,
            4096,
            "Repeated reconciliation must be idempotent"
        );
        index.scan(dir.path().to_str().unwrap(), 4).unwrap();
        assert_eq!(index.get(0).unwrap().size, 8192);
        assert!(index.removed.is_empty());
    }
}
