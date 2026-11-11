import decode, { init } from "@jsquash/jxl/decode";
import wasmUrl from "@jsquash/jxl/codec/dec/jxl_dec.wasm?url";

// JPEG XL off the UI thread. The webview's own decoder when it has one (WebKitGTK with libjxl, Safari), else libjxl as
// WASM (WebView2 on Windows). The decoder finds its .wasm through import.meta.url, which doesn't survive bundling: it
// gets the compiled module instead (init takes one at runtime; its typings only list the options).
let ready: Promise<unknown> | undefined;
const wasm = () =>
  (ready ??= fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => WebAssembly.compile(b))
    .then((module) => (init as unknown as (m: WebAssembly.Module) => Promise<unknown>)(module)));

// max > 0: a bubble, scaled to fit max px and sent as JPEG (fast to encode, small); 0: full size as PNG (the viewer)
onmessage = async ({ data: { id, bytes, max } }: MessageEvent<{ id: number; bytes: ArrayBuffer; max: number }>) => {
  try {
    const bitmap =
      (await createImageBitmap(new Blob([bytes], { type: "image/jxl" })).catch(() => null)) ??
      (await wasm().then(() => decode(bytes)).then((image) => createImageBitmap(image)));
    if (!bitmap) throw new Error("JPEG XL decode failed");
    const scale = max ? Math.min(1, max / Math.max(bitmap.width, bitmap.height)) : 1;
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    postMessage({ id, blob: await canvas.convertToBlob(max ? { type: "image/jpeg", quality: 0.9 } : { type: "image/png" }) });
  } catch (e) {
    postMessage({ id, error: String(e) });
  }
};
