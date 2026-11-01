import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "@/app";
import { FileViewerWindow } from "@/app/file-viewer";
import { inTauri } from "@/core/tauri/native";

// the same bundle runs the main window and the file viewer window (open_viewer, label "viewer")
const isViewer = inTauri && getCurrentWindow().label === "viewer";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode>{isViewer ? <FileViewerWindow /> : <App />}</React.StrictMode>);
