# 注意力壁纸 — Attention Wallpaper

An independent, local-first Windows 11 x64 desktop app that blends user-authored goals, questions, and sentences into the wallpaper along low-distraction regions. It finds low-distraction regions locally, uses conservative hard exclusions, lays text out with [@chenglou/pretext](https://www.npmjs.com/package/@chenglou/pretext), composites a per-monitor PNG, and applies it through `IDesktopWallpaper::SetWallpaper`.

## Quick start

### Prerequisites

- **Node.js** 20+ and **pnpm** 11+
- **Rust** 1.77+ (stable, MSVC toolchain)
- **Visual Studio 2022 Build Tools** (C++ workload) or full VS
- **Windows 10/11 SDK**
- **WebView2 Runtime** (preinstalled on Windows 11)

### Development

```bash
pnpm install              # install JS dependencies
pnpm test                 # run all 56 unit + integration tests
pnpm typecheck            # TypeScript strict typecheck
pnpm build                # production frontend build (Vite)
pnpm mock:server          # start the local AI mock server (port 4319)
pnpm tauri:dev            # full desktop dev (Rust + WebView2 + hot reload)
```

### Release build

```bash
pnpm tauri:build          # produces MSI + NSIS installer
```

Installer artifacts are written to:
```
src-tauri/target/release/bundle/
```

## Architecture

```
attention-wallpaper/
├── packages/
│   ├── attention/          # Local vision: FFT spectral residual, edge density,
│   │                       # luminance variance, readability penalty, softCost,
│   │                       # hard masks, candidate scoring, layout fallback ladder,
│   │                       # ONNX adapter types (unavailable-by-default)
│   ├── content-model/      # ContentItem types, selection (priority/frequency/
│   │                       # recency), 25-min scheduling, validation, samples
│   ├── pretext-layout/     # @chenglou/pretext wrapper, font, WCAG contrast
│   └── ai-client/          # API contracts, quota, PNG validation, ApiClient
├── mock-server/            # Local mock AI service (4 endpoints, quota, 15-min TTL)
├── src/                    # React + TypeScript frontend (5 sections)
│   ├── sections/           # 内容 / 壁纸 / 显示器 / AI生成 / 隐私
│   └── lib/
│       ├── tauri.ts        # Tauri bridge with browser-dev fallback
│       └── compositor.ts   # Decode → analyze → select → layout → composite → PNG
├── src-tauri/              # Rust crate (Tauri 2)
│   └── src/
│       ├── lib.rs          # App setup, state, plugin registration
│       ├── db.rs           # SQLite persistence (content, settings, rotation, profiles)
│       ├── commands.rs     # Tauri IPC commands
│       ├── tray.rs         # System tray (6 actions)
│       └── platform/       # Windows FFI: IDesktopWallpaper + honest native fallbacks
│           ├── mod.rs      # Cross-platform interface + fallbacks
│           └── windows.rs  # windows-sys raw FFI implementation
├── tests/                  # End-to-end mock server integration tests
└── scripts/                # Icon generation
```

### Offline pipeline

The core offline loop is fully local:

1. **Create content** — User authors goals/questions/sentences in the 内容 section.
2. **Import wallpaper** — User imports a PNG/JPG in the 壁纸 section.
3. **Analyze** — The attention pipeline runs locally:
   - Spectral-residual saliency (FFT-based, deterministic)
   - Sobel edge density
   - Luminance variance + color variance
   - Readability penalty (0.5·lumVar + 0.3·edges + 0.2·colorVar)
   - Conservative edge-safe exclusions (the UI Automation icon adapter is not wired yet)
   - softCost = 0.45·subject + 0.20·spectral + 0.15·edges + 0.20·readability
   - Gaussian smoothing + multi-scale candidate scoring
4. **Select content** — Priority/frequency/recency-weighted selection, max 3 per monitor, no cross-monitor repeats.
5. **Layout** — Greedy best-candidate placement with fallback ladder:
   reduce_count → reflow → translucent cards → safe rail.
   Effective contrast ≥ 4.5:1 enforced.
6. **Composite** — Text rendered onto wallpaper via Canvas + @chenglou/pretext.
7. **Apply** — PNG written atomically, applied via `IDesktopWallpaper::SetWallpaper`.
8. **Next set** — Tray action rotates content every 25 minutes.
9. **Restore** — Original wallpaper path saved per-monitor; tray restores on demand.

### Rotation

Content rotates every 25 minutes. The MVP cannot reliably detect "desktop safe to disturb" (no fake detection), so pending rotations are persisted and applied on the next explicit refresh / next-set tray action. See **Limitations** below.

## Privacy guarantees

| Data | Where it stays | Uploaded? |
|------|---------------|-----------|
| Attention analysis (saliency, edges, readability) | Local | Never |
| Imported wallpaper files | Local | Never |
| Desktop icon positions | Adapter not active in this Alpha; conservative fallback only | Never |
| Content (goals/questions/sentences) | Local SQLite | Never |
| ONNX model inference | Local | Never |
| AI wallpaper generation (user-triggered) | Prompt → AI service | Yes (prompt only, not wallpaper) |
| Device token | Mock mode uses an in-memory development token; production persistence is not implemented | Never without user action |

**No telemetry. No auto-update. No automatic model downloads.**

## AI wallpaper service

AI generation is user-triggered only. The contract:

- `POST /v1/activate` — Device activation
- `POST /v1/wallpapers:generate` — Submit generation job
- `GET /v1/jobs/{id}` — Poll job status
- `GET /v1/quota` — Check quota (3/day, 20/month, 1 concurrent)

The mock server (`pnpm mock:server`) implements all four endpoints with deterministic local generation. A Gemini 3.1 Flash Image adapter is included but activates only when `GEMINI_API_KEY` is set — no hard-coded keys, no fabricated images.

Generated images are validated locally (PNG signature + IHDR dimensions) before allowing Apply.

## ONNX model installation

Models are **not** auto-downloaded. The baseline uses pure heuristic saliency (always works). To enable ONNX-enhanced detection:

1. Obtain model weights from their original sources:
   - **U2-NetP** — [U-2-Net](https://github.com/xuebinqin/U-2-Net) (Apache 2.0)
   - **FaceDetLite** — a lightweight face detector (e.g. [PaddleDetection](https://github.com/PaddlePaddle/PaddleDetection))
   - **PP-OCRv6-tiny** — [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (detection only, no recognition)

2. Place `.onnx` weight files in `models/`

3. Create `models/manifest.json` with sha256 checksums:
   ```json
   [
     {
       "id": "u2netp",
       "kind": "subject_saliency",
       "onnxPath": "models/u2netp.onnx",
       "sha256": "<64-hex-char sha256>",
       "bytes": <file size in bytes>,
       "inputSize": [320, 320],
       "license": "Apache-2.0",
       "homepage": "https://github.com/xuebinqin/U-2-Net"
     }
   ]
   ```

4. Set the model manifest directory in 设置 (Settings) and restart.

5. Model status will show "ONNX" in the 隐私 section.

**Without models, all components report `unavailable` and use heuristic fallback. Missing models never break the offline loop.**

See `THIRD_PARTY_LICENSES.md` for model license notices.

## System tray

| Action | Behavior |
|--------|----------|
| 打开编辑器 | Show the main window |
| 下一组 | Rotate to next content set |
| 暂停一小时 | Pause rotation for 1 hour |
| 重新布局 | Re-run analysis + composite + apply |
| 恢复原壁纸 | Restore the saved original wallpaper |
| 设置 | Show settings |
| 退出 | Exit the app |

## Limitations (honest)

1. **Desktop-safe detection**: The MVP cannot reliably detect when the desktop is "safe to disturb." Pending rotations are persisted and applied on the next explicit refresh/next-set action — not silently applied.
2. **ONNX inference**: The ONNX native bridge is not wired in the first pass. The typed adapter, manifest validation, diagnostics, and tested heuristic fallback are complete. We do not claim inference works when it does not.
3. **Face/text detection**: Without installed ONNX models, faces and existing text are not auto-excluded. The layout becomes more conservative (wider margins, edge-safe fallback). No fake detections are generated.
4. **Desktop icons**: The UI Automation adapter is not wired in this Alpha. The app reports this explicitly and uses a conservative edge-safe fallback; it does not use unsafe cross-process list-view pointers.
5. **Multi-monitor**: Monitor enumeration and wallpaper application use `IDesktopWallpaper` device paths. If that API is unavailable, the app falls back to GDI display diagnostics and applies to all monitors rather than pretending per-monitor matching succeeded.
6. **AI generation**: The mock server produces deterministically-labelled placeholder images, not real AI-generated art. The Gemini adapter only activates with an explicit API key.

## Development notes

- On non-Windows dev machines, native calls fail gracefully behind typed interfaces. The frontend works in browser-preview mode with localStorage-backed state.
- Windows release builds have been verified from this workspace path containing Chinese characters. If `RC.EXE` fails, regenerate the multi-size Windows icon with `pnpm tauri icon src-tauri/icons/icon.png --output src-tauri/icons` before changing paths.
- Tests use Vitest (Node environment). The mock-server test starts a real HTTP server on a random port.

## Tech stack

- **Tauri 2** (Rust) — desktop shell, system tray, IPC
- **React 18 + TypeScript** — frontend
- **Vite 5** — bundler
- **@chenglou/pretext** — text measurement and layout
- **rusqlite** (SQLite, bundled) — local persistence
- **windows-sys** — raw FFI for IDesktopWallpaper and monitor diagnostics
- **Vitest** — testing
