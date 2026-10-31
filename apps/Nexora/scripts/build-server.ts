// The server as one executable for Tauri's externalBin (src-tauri/tauri.release.conf.json):
// src-tauri/binaries/nexora-server-<target triple>[.exe]. Tauri runs this before `tauri build` with
// TAURI_ENV_TARGET_TRIPLE set (Bun cross-compiles, so any runner builds any target); run by hand it builds for
// this machine.
import { $ } from "bun";
import { join } from "node:path";

const BUN_TARGET: Record<string, string> = {
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
};

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || /^host: (.+)$/m.exec(await $`rustc -vV`.text())?.[1];
const target = triple && BUN_TARGET[triple];
if (!target) throw new Error(`No Bun build target for ${triple}`);

const out = join(import.meta.dir, "../src-tauri/binaries", `nexora-server-${triple}${triple.includes("windows") ? ".exe" : ""}`);
await $`bun build --compile --minify --sourcemap --target=${target} src/index.ts --outfile ${out}`.cwd(join(import.meta.dir, "../../../server"));
console.log(`server → ${out}`);
