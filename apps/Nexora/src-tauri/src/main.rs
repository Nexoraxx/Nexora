#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // the server starts the Linux call engine as `nexora --zcall <recv socket> <send socket>`
    #[cfg(target_os = "linux")]
    if let [_, flag, recv, send] = std::env::args().collect::<Vec<_>>().as_slice() {
        if flag == "--zcall" {
            return nexora_lib::zcall::run(recv, send);
        }
    }
    nexora_lib::run()
}
