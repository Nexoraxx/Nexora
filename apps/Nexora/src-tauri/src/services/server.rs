use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use crate::models::server::Server;

#[cfg(debug_assertions)]
fn command() -> Command {
    let mut cmd = Command::new("bun");
    cmd.args(["run", "src/index.ts"]).current_dir(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../server"));
    cmd
}

#[cfg(not(debug_assertions))]
fn command() -> Command {
    let exe = std::env::current_exe().expect("app executable path");
    #[allow(unused_mut)]
    let mut cmd = Command::new(exe.with_file_name(format!("nexora-server{}", std::env::consts::EXE_SUFFIX)));
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::os::windows::process::CommandExt::creation_flags(&mut cmd, CREATE_NO_WINDOW);
    }
    cmd
}

pub fn spawn(data_dir: &Path) -> Server {
    let mut child = command()
        .env("DATA_DIR", data_dir)
        // Linux call engine: the server runs this executable as `--zcall <recv> <send>` (src/zcall)
        .env("NEXORA_APP_EXE", std::env::current_exe().unwrap_or_default())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to start the Nexora server (dev: is `bun` on PATH?)");

    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let info = loop {
        let line = lines.next().expect("server exited before READY").expect("read server stdout");
        if let Some(json) = line.strip_prefix("READY ") {
            break serde_json::from_str(json).expect("invalid READY line");
        }
        println!("{line}");
    };
    std::thread::spawn(move || lines.map_while(Result::ok).for_each(|line| println!("{line}")));
    Server { info, _child: Mutex::new(child) }
}
