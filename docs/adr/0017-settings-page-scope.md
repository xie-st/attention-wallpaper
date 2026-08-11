# Settings page scope

The 设置 page contains three blocks:

1. **轮换间隔** — numeric input, 5–120 min, default 15 (ADR-0003).
2. **ONNX 诊断** — model status per slot (u2netp / FaceDetLite / PP-OCRv6-tiny): loaded / failed-checksum / wrong-shape / inference-error / not-installed; plus a model manifest directory path picker.
3. **关于** — app version, third-party licenses link, and the privacy statement (all data local, never uploaded; no telemetry, no auto-update, no auto-download) folded in as a footer block.

The Passage soft-length cap (200 chars, ADR-0013) is a fixed constant, not exposed in Settings.

## Why

The cadence interval and ONNX diagnostics are genuinely user-facing — the user needs to tune exposure frequency and see why ONNX isn't engaging. The 200-char cap is a layout-quality constant, not a preference; exposing it invites users to break the layout/readability balance. The privacy statement is non-interactive and belongs as a footer under "关于" rather than its own block.

## Consequences

- `src/sections/设置/` (or a settings modal) renders three blocks in order.
- No Passage-length setting input.
- ONNX status renders the bridge's real diagnostics (ADR-0008), replacing the old "unavailable" stub.
- README's privacy section collapses into the 关于 footer.
