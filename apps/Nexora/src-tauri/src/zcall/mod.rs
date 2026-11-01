//! Linux port of Zalo PC's call helper ZaloCall, which Zalo never shipped for Linux. The server runs it exactly like
//! Zalo PC's main.js runs ZaloCall (`nexora --zcall <recv socket> <send socket>`), so one host serves both.
//! Specs: Client/docs/data/call-signaling.md, call-media.md, call-port-answers.md.

/// Diagnostics: to stderr (the host logs it) and, once `init` names it, to the logPath file ZaloCall also writes.
macro_rules! say {
    ($($t:tt)*) => { $crate::zcall::log(format!($($t)*)) };
}

mod call;
mod ipc;
mod media;
mod rtcp;
mod srtp;
mod ui;
mod zrtp;

use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use gtk::glib;

use call::{Engine, Event};

pub fn run(recv: &str, send: &str) {
    if let Err(e) = gtk::init() {
        return say!("zcall: no display: {e}");
    }
    // glib 0.18 (Tauri's gtk) still has it; the async-channel replacement would be a new dependency
    #[allow(deprecated)]
    let (tx, rx) = glib::MainContext::channel(glib::Priority::DEFAULT);
    let (on_message, on_close) = (tx.clone(), tx.clone());
    let ipc = match ipc::connect(recv, send, move |v| drop(on_message.send(Event::Host(v))), move || drop(on_close.send(Event::HostGone))) {
        Ok(ipc) => Arc::new(ipc),
        Err(e) => return say!("zcall: cannot reach the host: {e}"),
    };
    ipc.send(&serde_json::json!({ "type": "update", "command": "native-ready" }));
    let engine = Engine::new(ipc, tx);
    rx.attach(None, move |event| {
        Engine::handle(&engine, event);
        glib::ControlFlow::Continue
    });
    gtk::main();
}

static LOG: Mutex<Option<std::fs::File>> = Mutex::new(None);

fn set_log_file(path: &str) {
    let file = std::fs::OpenOptions::new().create(true).append(true).open(path);
    *LOG.lock().unwrap() = file.map_err(|e| eprintln!("zcall: log {path}: {e}")).ok();
}

pub fn log(line: String) {
    eprintln!("{line}");
    if let Some(f) = LOG.lock().unwrap().as_mut() {
        let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let _ = writeln!(f, "{}.{:03} {line}", t.as_secs(), t.subsec_millis());
    }
}
