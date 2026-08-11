# Attention Wallpaper — implementation brief

Build a production-shaped Windows 11 x64 MVP in this directory. Do not stop at a mockup or a scaffold. Run tests and a release build before finishing.

## Product

An independent, local-first Windows desktop app that blends user-authored goals, questions/problem types, and sentences into the wallpaper. It finds low-distraction regions locally, avoids desktop icons/taskbar/faces/existing text, lays text out with `@chenglou/pretext`, composites a per-monitor PNG, and applies it through `IDesktopWallpaper::SetWallpaper`.

V1 dynamic behavior means rotating/recompositing content every 25 minutes, not video wallpaper or an always-on-top overlay. The wallpaper itself is non-interactive; editing happens in the tray editor.

## Required stack and deliverable

- Tauri 2, Rust, React, TypeScript, Vite.
- A runnable Windows app with a polished Chinese-first UI and five sections: 内容、壁纸、显示器、AI 生成、隐私.
- System tray actions: 打开编辑器、下一组、暂停一小时、重新布局、恢复原壁纸、设置、退出.
- SQLite persistence for content, settings, display history, wallpaper profiles, and generation metadata. Secrets/device token use Windows Credential Manager or a clearly isolated adapter with a secure Windows implementation.
- Tests for selection, scheduling, attention map, layout fallback, validation, and API contracts.
- README with exact development/build commands, architecture, privacy guarantees, limitations, and model installation instructions.

## Content model and behavior

```ts
type ContentItem = {
  id: string
  kind: "goal" | "question" | "sentence"
  body: string
  priority: "low" | "normal" | "high"
  startsAt: string | null
  endsAt: string | null
  frequency: "occasional" | "normal" | "frequent"
  enabled: boolean
}
```

- Show at most three items per monitor.
- Select by priority, frequency, and time since last shown. Avoid repeats across monitors when enough eligible items exist.
- Prepare a new set every 25 minutes. If desktop visibility cannot be reliably detected in the MVP, persist a pending rotation and apply it on the next explicit refresh/next-set action; document the limitation rather than pretending.
- Layout fallback order: reduce item count, reduce max line width/reflow, enable translucent cards, use a reserved screen-edge safe rail.
- Enforce effective text contrast >= 4.5:1.

## Local vision and attention map

No Kimi or other LLM in the attention/layout path. Never upload imported wallpaper or local analysis.

Implement an extensible local pipeline with real deterministic heuristic components working out of the box, plus ONNX adapters that become active when valid weights are installed:

- U2-NetP-style subject saliency adapter.
- FaceDetLite-equivalent face detector adapter; expand face boxes by 15%.
- PP-OCRv6-tiny-style text detection adapter; detection boxes only, no recognition; expand by 12 px.
- Spectral-residual saliency, edge density, luminance variance, local color variance, and readability penalty.
- Icon/taskbar hard exclusions. Use Windows UI Automation for desktop icon rectangles where feasible; if unavailable, expose a typed adapter and use conservative edge-safe fallback with a visible diagnostics status.

The baseline must produce a meaningful map without downloaded model weights. Do not generate fake detections. Missing models must be reported as `unavailable`, lower confidence, and force conservative layout.

```text
softCost =
    0.45 * subjectSaliency
  + 0.20 * spectralSaliency
  + 0.15 * edgeDensity
  + 0.20 * readabilityPenalty
```

Normalize components, combine hard masks, apply light Gaussian smoothing, and score multi-scale candidate rectangles using mean/max cost, area, edge distance, contrast, and cross-monitor repetition.

Use ONNX locally only. Prefer Windows ML/DirectML when available and fall back to CPU. Do not download weights automatically. Provide checksummed model-manifest support and third-party license notices. If the native ONNX bridge is too risky for the first pass, complete the typed adapter, manifest validation, diagnostics, and tested heuristic fallback; do not claim inference works when it does not.

## Wallpaper rendering and Windows integration

- Import local wallpapers and preserve original files.
- Render/crop independently per monitor and composite text into a new PNG.
- Use named bundled fonts, not `system-ui`, so Pretext measurement and Canvas rendering stay aligned.
- Save the original per-monitor wallpaper path and position before first apply.
- Apply via the public Windows `IDesktopWallpaper` COM API; restore from the saved snapshot via tray and settings.
- Retrieve desktop icon rectangles without reading filenames. If the API fails, return diagnostics and use the conservative fallback.
- Handle multiple monitors and DPI correctly. Never leave a blank desktop on failures; use atomic temp/output file replacement and retain the last known-good composition.
- On non-Windows development/tests, native calls must fail gracefully behind interfaces.

## AI wallpaper service contract

Attention analysis is always local. AI generation is user-triggered only.

Implement the client contracts and a small local mock server/package for:

- `POST /v1/activate`
- `POST /v1/wallpapers:generate`
- `GET /v1/jobs/{id}`
- `GET /v1/quota`

Generation request includes monitor dimensions, an explicit negative-space mask/region, and the user prompt. Use a provider-neutral `ImageGenerator`/`PromptDirector` interface. Add a Gemini 3.1 Flash Image server adapter only when configured by environment variables; no hard-coded keys and no fabricated image responses. Validate generated images locally before allowing Apply.

Default quota semantics: 3 generations/day, 20/month, one concurrent task/device. Intermediate files expire after 15 minutes in the mock/service abstraction.

## UX requirements

- Calm, editorial visual direction; avoid generic dashboard styling, excessive gradients, or dense cards.
- Make local/private status obvious. Show model availability and whether a layout used heuristics or ONNX.
- Provide useful empty states and seeded sample content, but keep sample data separable from real user data.
- Wallpaper page supports import, analyze, preview, apply, and restore.
- Display page shows each monitor and its current layout/diagnostic status.
- AI page clearly says generation may upload the prompt and optional generation reference, while imported wallpapers and attention maps stay local.

## Acceptance priorities

1. Offline loop works end to end: create content -> import wallpaper -> analyze -> preview composition -> apply -> next set -> restore.
2. Tests and build pass on this Windows machine.
3. Missing optional models or cloud configuration never break the offline loop.
4. No fake security, detection, generation, or Windows integration claims.
5. Keep all work inside this project directory and do not modify sibling workspace projects.

