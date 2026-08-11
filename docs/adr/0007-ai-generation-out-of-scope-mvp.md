# AI wallpaper generation is out of scope for the MVP

The AI wallpaper subsystem — `mock-server/`, `packages/ai-client/`, the "AI生成" UI section, the 4-endpoint contract (`/v1/activate`, `/v1/wallpapers:generate`, `/v1/jobs/{id}`, `/v1/quota`), quota management, Gemini adapter, and PNG validation — is removed from the MVP. The wallpaper is always a user-imported PNG/JPG. AI generation may return in a future phase when the "desktop as AI-controlled information window" vision becomes the focus.

## Why

The user's stated core need is projecting curated Passages from existing articles (Hamming, a teacher's words) onto the desktop as reminders — the wallpaper is a carrier, not the artifact. The AI subsystem's mock server produces deterministic placeholder images (honest fakes, per the README), which have zero value in real use. The Gemini adapter is dormant without an API key. Carrying the full subsystem costs maintenance surface (4 endpoints, quota, PNG validation, a UI section, integration tests) for no MVP gain. The user explicitly called the AI-vision "后话" (a later concern). Removing is reversible: the subsystem sits in isolated packages and can be reinstated.

## Considered options

- **Remove AI generation for MVP** (accepted) — focuses the MVP on the Passage→wallpaper pipeline; reversible.
- **Keep mock, remove Gemini** (B) — mock placeholders still useless in real use; not worth keeping.
- **Keep status quo** (C) — dead weight; contradicts MVP focus.
- **Make AI generation core** (D) — the user's "后话"; explicitly deferred.

## Consequences

- `mock-server/`, `packages/ai-client/`, `tests/` (mock-server integration), and the "AI生成" section UI are removed or quarantined.
- The UI collapses from 5 sections to 4: 内容 / 壁纸 / 显示器 / 隐私.
- `packages/attention`, `packages/content-model`, `packages/pretext-layout` are untouched — the core pipeline is intact.
- README's "AI wallpaper service" and ONNX sections are rewritten to reflect MVP scope.
- Future reinstatement is a known, isolated lift.
