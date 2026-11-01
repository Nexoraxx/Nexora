import decode, { init } from "@jsquash/jxl/decode";
import wasmUrl from "@jsquash/jxl/codec/dec/jxl_dec.wasm?url";

// JPEG XL → PNG off the UI thread (libjxl as WASM). Phones upload photos as JXL and the Linux and Windows webviews
// can't show it. The decoder finds its .wasm through import.meta.url, which doesn't survive bundling: it gets the
// compiled module instead (init takes one at runtime; its typings only list the options).
const ready = fetch(wasmUrl)
  .then((r) => r.arrayBuffer())
  .then((b) => WebAssembly.compile(b))
  .then((module) => (init as unknown as (m: WebAssembly.Module) => Promise<unknown>)(module));

onmessage = async ({ data: { id, bytes } }: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => {
  try {
    await ready;
    const image = await decode(bytes);
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext("2d")!.putImageData(image, 0, 0);
    postMessage({ id, blob: await canvas.convertToBlob({ type: "image/png" }) });
  } catch (e) {
    postMessage({ id, error: String(e) });
  }
};
