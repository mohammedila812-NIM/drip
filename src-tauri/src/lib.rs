// Native side of Drip: place the window at top-centre, make it click-through, and stream the global cursor
// (window-relative, logical px) only while it is near. Idle polling is 8 Hz, near 60 Hz, only on change.
// [drip] adds: foreground-window probe (4 Hz, emits "island:fg" on change, follows the window's monitor, steps out of the way
//        of fullscreen apps) and the plugin runtime (plugin discovery + child-process plugins over JSON lines).
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, path::{Component, Path, PathBuf}, process::{Child, Command, Stdio}, sync::Mutex, thread, time::{Duration, Instant}};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, RunEvent, State, WebviewWindow};

#[derive(Default)] struct Procs(Mutex<HashMap<String, Child>>);   // running exec plugins
#[derive(Default)] struct Fg(Mutex<Value>);                        // last foreground snapshot (frontend may mount after the first event)

// ---------- foreground window (Windows) ----------
#[cfg(windows)]
mod fg {
    use serde_json::{json, Value};
    use windows::{core::PWSTR, Win32::{
        Foundation::{CloseHandle, HWND, RECT},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::{Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN},
             WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsZoomed}},
    }};

    /// None = nothing to report (no window, or Drip itself has focus: keep the previous state).
    pub fn probe(me: u32) -> Option<Value> {
        unsafe {
            let h = GetForegroundWindow();
            if h == HWND::default() { return None; }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            if pid == me { return None; }

            let (mut t, mut c, mut b) = ([0u16; 256], [0u16; 64], [0u16; 520]);
            let n = GetWindowTextW(h, &mut t).max(0) as usize; let title = String::from_utf16_lossy(&t[..n]);
            let n = GetClassNameW(h, &mut c).max(0) as usize; let class = String::from_utf16_lossy(&c[..n]);
            let shell = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"].contains(&class.as_str());

            let path = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok().and_then(|p| {
                let mut l = b.len() as u32;
                let r = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(b.as_mut_ptr()), &mut l);
                let _ = CloseHandle(p);
                r.ok().map(|_| String::from_utf16_lossy(&b[..l as usize]))
            }).unwrap_or_default();
            let exe = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();

            let mut r = RECT::default(); let _ = GetWindowRect(h, &mut r);
            let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let _ = GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mut mi);
            let m = mi.rcMonitor;
            let max = IsZoomed(h).as_bool();
            let covers = r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
            let qs = SHQueryUserNotificationState().ok();
            // fullscreen = covers the whole monitor without being merely maximized, or Windows says a game / presentation owns the screen
            let full = !shell && ((covers && !max) || qs.map_or(false, |s| [QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE].contains(&s)));
            // top = a window is sitting under the island zone (top edge of the monitor, spanning its centre)
            let mc = (m.left + m.right) / 2;
            let top = !shell && r.top <= m.top + 12 && r.left <= mc - 300 && r.right >= mc + 300;
            Some(json!({ "exe": exe, "title": title, "full": full, "max": max, "top": top, "shell": shell, "mon": [m.left, m.top, m.right, m.bottom] }))
        }
    }
}
#[cfg(not(windows))]
mod fg { pub fn probe(_: u32) -> Option<serde_json::Value> { None } }

// ---------- window placement ----------
// Centre the 480x220 window on the top edge of monitor `m` (size is set in logical px so mixed-DPI setups stay correct).
fn dock(w: &WebviewWindow, m: &Monitor) {
    let x = m.position().x + (m.size().width as f64 - 480.0 * m.scale_factor()) as i32 / 2;
    let p = PhysicalPosition::new(x, m.position().y);
    let _ = w.set_position(p); let _ = w.set_size(LogicalSize::new(480.0, 220.0)); let _ = w.set_position(p);
}

// ---------- plugins ----------
fn pdir(app: &AppHandle) -> PathBuf { app.path().app_data_dir().unwrap_or_default().join("plugins") }
fn safe(id: &str) -> bool { !id.is_empty() && !id.starts_with('.') && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) }

/// Always re-read from disk by folder name: the frontend can never hand us a command line to run.
fn manifest(app: &AppHandle, id: &str) -> Option<Value> {
    if !safe(id) { return None; }
    let mut m: Value = serde_json::from_str(&std::fs::read_to_string(pdir(app).join(id).join("plugin.json")).ok()?).ok()?;
    if !m.is_object() { return None; }
    m["id"] = json!(id);
    Some(m)
}

#[tauri::command]
fn plugins_list(app: AppHandle) -> Vec<Value> {
    let dir = pdir(&app); let _ = std::fs::create_dir_all(&dir);
    let mut out = vec![];
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        if let Some(mut m) = manifest(&app, &e.file_name().to_string_lossy()) {
            if let Some(main) = m["main"].as_str().map(String::from) {
                let p = Path::new(&main);
                if p.components().all(|c| matches!(c, Component::Normal(_))) {   // no "..", no absolute paths
                    if let Ok(code) = std::fs::read_to_string(e.path().join(p)) { m["code"] = json!(code); }
                }
            }
            out.push(m);
        }
    }
    out
}

#[tauri::command]
fn plugin_run(app: AppHandle, procs: State<Procs>, id: String) -> Result<(), String> {
    let m = manifest(&app, &id).ok_or("unknown plugin")?;
    let argv: Vec<String> = m["exec"].as_array().ok_or("no exec")?.iter().filter_map(|v| v.as_str().map(String::from)).collect();
    let (prog, args) = argv.split_first().ok_or("empty exec")?;
    let mut cmd = Command::new(prog);
    cmd.args(args).current_dir(pdir(&app).join(&id)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); } // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("no stdout")?;
    if let Some(mut old) = procs.0.lock().unwrap().insert(id.clone(), child) { let _ = old.kill(); let _ = old.wait(); }
    let h = app.clone();
    thread::spawn(move || { for line in BufReader::new(out).lines().map_while(Result::ok) { let _ = h.emit("island:plugin", json!({ "id": id, "line": line })); } });
    Ok(())
}

#[tauri::command]
async fn plugin_send(procs: State<'_, Procs>, id: String, line: String) -> Result<(), String> {
    if let Some(i) = procs.0.lock().unwrap().get_mut(&id).and_then(|c| c.stdin.as_mut()) { let _ = writeln!(i, "{line}"); let _ = i.flush(); }
    Ok(())
}

#[tauri::command]
fn plugin_stop(procs: State<Procs>, id: String) {
    if let Some(mut c) = procs.0.lock().unwrap().remove(&id) { let _ = c.kill(); let _ = c.wait(); }
}

#[tauri::command]
fn fg_now(fg: State<Fg>) -> Value { fg.0.lock().unwrap().clone() }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Procs::default()).manage(Fg::default())
        .invoke_handler(tauri::generate_handler![plugins_list, plugin_run, plugin_send, plugin_stop, fg_now])
        .setup(|app| {
            let w = app.get_webview_window("main").unwrap();
            let _ = std::fs::create_dir_all(pdir(app.handle()));
            if let Some(m) = w.primary_monitor()? { dock(&w, &m); }
            w.set_ignore_cursor_events(true)?;
            let h = app.handle().clone();
            thread::spawn(move || {
                let (mut far, mut last, mut full, mut mon) = (false, (0.0, 0.0), false, (i32::MIN, i32::MIN));
                let (mut probe_at, mut last_fg, me) = (Instant::now(), Value::Null, std::process::id());
                loop {
                    let mut ms = 120;
                    if probe_at.elapsed() >= Duration::from_millis(250) {
                        probe_at = Instant::now();
                        if let Some(f) = fg::probe(me) {
                            if f != last_fg {
                                let nf = f["full"].as_bool().unwrap_or(false);
                                // fullscreen: drop out of the topmost band so games keep their direct-flip path; restore afterwards
                                if nf != full { full = nf; let _ = w.set_always_on_top(!full); }
                                // follow the foreground window to its monitor
                                let m = (f["mon"][0].as_i64().unwrap_or(0) as i32, f["mon"][1].as_i64().unwrap_or(0) as i32);
                                if m != mon {
                                    mon = m;
                                    if let Ok(all) = w.available_monitors() { if let Some(t) = all.iter().find(|t| (t.position().x, t.position().y) == m) { dock(&w, t); } }
                                }
                                *h.state::<Fg>().0.lock().unwrap() = f.clone();
                                let _ = w.emit("island:fg", &f);
                                last_fg = f;
                            }
                        }
                    }
                    if full { ms = 250; }   // nothing to track behind a fullscreen app
                    else if let (Ok(c), Ok(p), Ok(sf)) = (w.cursor_position(), w.outer_position(), w.scale_factor()) {
                        let (x, y) = ((c.x - p.x as f64) / sf, (c.y - p.y as f64) / sf);
                        if y < 400.0 && (x - 240.0).abs() < 450.0 { // 240 = half of the 480 px window
                            far = false; ms = 16;
                            if (x, y) != last { last = (x, y); let _ = w.emit("cursor", (x, y)); }
                        } else if !far { far = true; let _ = w.emit("cursor", (9999, 9999)); }
                    }
                    thread::sleep(Duration::from_millis(ms));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building drip")
        .run(|app, ev| {
            if let RunEvent::Exit = ev { for c in app.state::<Procs>().0.lock().unwrap().values_mut() { let _ = c.kill(); } }
        });
}
