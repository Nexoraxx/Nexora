import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

export const inTauri = "__TAURI_INTERNALS__" in window;

// paths of files copied in a file manager: WebKitGTK hides them from the paste event, the app reads GTK's clipboard
export const clipboardFiles = (): Promise<string[]> => (inTauri ? invoke("clipboard_files") : Promise.resolve([]));

export const openExternal = (url: string) => (inTauri ? openUrl(url) : window.open(url, "_blank"));

// OS notification through Tauri's notification plugin (the browser's Notification outside Tauri)
export async function notify(title: string, body: string) {
  if ((await isPermissionGranted()) || (await requestPermission()) === "granted") sendNotification({ title, body });
}
