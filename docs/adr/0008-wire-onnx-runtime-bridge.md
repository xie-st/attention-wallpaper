# Wire the ONNX Runtime native bridge in the MVP

The ONNX-enhanced attention tier is made **active** in the MVP, not merely retained as dead adapter code. The Rust crate (`src-tauri/`) gains a native inference bridge using the `ort` crate (ONNX Runtime Rust binding) that loads user-installed `.onnx` models from `models/` per `manifest.json`, runs inference locally (CPU execution provider; GPU optional later), and feeds results into the attention pipeline's `softCost`. When no models are present, or a model fails to load, the pipeline transparently falls back to the heuristic tier — the offline loop never breaks.

Models are never auto-downloaded. The user obtains U2-NetP (Apache-2.0), FaceDetLite, and PP-OCRv6-tiny from upstream sources, places them in `models/`, and writes `manifest.json` with sha256 checksums. ONNX Runtime ships as a native dynamic library; bundling strategy must ensure the binary is relocatable on Windows.

## Why

The user chose to wire the bridge now rather than defer. Benefits: face detection prevents Passages from covering faces in photos; subject saliency (U2-NetP) is materially more accurate than FFT spectral residual on complex backgrounds; existing-text detection (PP-OCRv6) prevents stacking new text on wallpaper text. All inference is local — consistent with the local-first/privacy guarantee. The heuristic tier remains as fallback, so the cost of this decision is bounded: worst case the bridge fails to load and the app behaves as heuristic-only.

## Considered options

- **Wire ONNX Runtime now** (accepted) — user's choice; real local inference, material quality gain on face/subject/text avoidance.
- **Strip all ONNX code, heuristic-only** (A, my earlier recommendation) — simplest but forfeits the quality gain the user wants.
- **Retain adapters, no bridge** (B, original README state) — dead code; satisfies neither "working" nor "removed".
- **Defer to post-MVP** — the user declined to defer.

## Consequences

- New Rust dependency: `ort` (ONNX Runtime Rust binding) + ONNX Runtime native binary bundled with the installer.
- `src-tauri/src/platform/` (or a new `src-tauri/src/inference/`) gains the native bridge: model loading, manifest verification, session management, inference execution, result marshalling to the JS-side attention pipeline.
- `packages/attention` ONNX adapter types become *consumed* (not just defined); a real data path replaces the `unavailable` stub.
- Model status diagnostics become meaningful (loaded / failed-checksum / wrong-shape / inference-error / not-installed).
- The "隐私" section is removed as a UI section (separate decision, see ADR-0009); ONNX status moves into 设置.
- Release build size grows by ONNX Runtime (~10-30 MB) — acceptable for a local desktop app.
- Cross-platform dev (non-Windows) must handle `ort` gracefully — inference unavailable, heuristic fallback engages, frontend preview mode unaffected.
