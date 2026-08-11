import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { OverlayWindow } from "./overlay/OverlayWindow";
import "./styles.css";

const isOverlay = new URLSearchParams(window.location.search).get("window") === "overlay";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isOverlay ? <OverlayWindow /> : <App />}</React.StrictMode>,
);
