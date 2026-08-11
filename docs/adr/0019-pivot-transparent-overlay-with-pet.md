# Pivot: transparent overlay window with article text + AI pet — supersedes the wallpaper-composite architecture

The product pivots from "composite Passages onto an imported wallpaper PNG via IDesktopWallpaper" to "a transparent always-on-top overlay window rendering scrolling article text in columns + an AI pet walking around". The wallpaper itself is a static solid color set once via the OS; all dynamic content (text layout + pet animation) lives in the overlay window's Canvas.

## What changed (the user's pivot)

- **Background**: solid color (set via `IDesktopWallpaper::SetWallpaper` once, or just the user's existing wallpaper kept). No imported PNG.
- **Text**: the **full Source Article** is laid out by pretext into **two columns on the right half** of the screen (the left half is left for desktop icons, by assumption). Font size + display dimensions determine how much text fits.
- **Pet**: an AI pet walks around the overlay layer — stop-and-go, variable step size, side-to-side drift, but a net downward average rate. Pet's vertical position drives text scroll (pet moves down → text advances; double-click pet → pet walks backward → text rewinds).
- **No Passage concept**: the unit is the Source Article. No sentence-level highlighting, no Passage library, no priority/included/lastShown per Passage, no Passage selection algorithm.

## Why

The user redefined the product. The previous "low-distraction Passage on imported wallpaper" model was built on a strong attention pipeline (FFT + Sobel + readability) that becomes meaningless against a solid-color background where every region is equally (un)interesting. The transparent-overlay approach is the only technically viable way to render a walking pet + scrolling text on the desktop — `IDesktopWallpaper::SetWallpaper` cannot sustain animation frame rates (~30-60 fps) without desktop flicker and API overhead. This mirrors standard desktop-pet / Wallpaper-Engine implementations.

## Superseded ADRs

The following ADRs are **superseded by this ADR-0019**. Their rationale no longer applies; their decisions are void. They remain in `docs/adr/` as historical record.

| Superseded ADR | Topic | Why superseded |
|----------------|-------|----------------|
| ADR-0001 | One Passage per wallpaper | No Passage; the unit is the Source Article, all of which is on-screen via scroll. |
| ADR-0002 | Time-driven rotation + persisted pending | Rotation is now pet-position-driven, not time-driven. |
| ADR-0003 | Default cadence 15 min | No time cadence; pet's average downward rate drives text progress. |
| ADR-0004 | Passages authored by highlighting | No Passage; no highlight-to-promote workflow. |
| ADR-0005 | Plain text directly on wallpaper | Text is rendered in overlay Canvas, not composited onto a wallpaper PNG. |
| ADR-0006 | Single serif typeface + auto black/white | Still a single typeface, but color choice logic changes (no background-saliency analysis on solid color). Sub-decision re-opened. |
| ADR-0008 | Wire ONNX Runtime bridge | No saliency/face/text detection needed against solid color. ONNX bridge void. (Re-evaluate if pet AI needs inference later — not MVP.) |
| ADR-0010 | Auto multi-monitor + merge 显示器 | Overlay window model is per-monitor or single-spanning; merge was about wallpaper apply. Re-open for overlay scope. |
| ADR-0012 | Wallpaper local file import only | No wallpaper file imported; background is solid color set by user. |
| ADR-0013 | Passage soft length cap 200 | No Passage. |
| ADR-0015 | Sentence selection atom + cascade delete + metadata-mutable | No Passage; Source Article is the only content unit. Delete behavior re-specified for articles only. |
| ADR-0016 | Rotation set = one Source Article + article priority + top-1 selection | The "rotation set" concept is void; text scroll is continuous, not set-based. Article priority may still apply (for article-switch ordering) — re-opened. |
| ADR-0017 | Settings page scope (cadence / ONNX / 关于) | Cadence gone; ONNX gone. Settings scope re-specified. |
| ADR-0018 | planRotationSet + composeSet split | Selection/orchestration tier void. |

## Surviving ADRs (still in force)

| ADR | Topic | Status |
|-----|-------|--------|
| ADR-0007 | AI generation out of scope | Survives. No AI image generation; pet AI is a different concern (decided in follow-up). |
| ADR-0009 | Remove 隐私 section | Survives. Still no privacy section; privacy note still folds into 关于. |
| ADR-0011 | 内容 section two tabs (文章 / Passage 库) | Modified: only the 文章 tab survives, minus the highlighting flow. Passage 库 tab removed. Sub-decision re-opened. |
| ADR-0014 | Tray reduced to four | Survives, but "下一组" no longer makes sense (no rotation set). Tray may need re-spec. Re-opened. |

## Net-new architectural shape (to be refined in follow-up ADRs)

1. **Two Tauri windows**:
   - **Editor window** (normal Tauri window, decorations on, user-facing): import Source Article, choose solid background color, configure pet, read about/privacy. Only opened on demand.
   - **Overlay window** (transparent, always-on-top, decorations off, covers the desktop): renders the scrolling two-column article text + the walking pet via Canvas + requestAnimationFrame. Persists across workspace switches; sits below taskbar or sits above (TBD).
2. **`packages/attention` deleted entirely** — no saliency/edge/readability pipeline. Solid color needs no analysis.
3. **`packages/pretext-layout` retained and elevated** — it now lays out the *entire article* into Text Regions (per ADR-0022), not a single Passage. Its `maxLines` truncation concept is replaced by "total scroll length" (text overflows off-screen and is revealed by pet-driven scroll).
4. **`packages/content-model` rewritten** — only `SourceArticle` type remains; no `Passage`, no selection algorithm, no scheduling. Article ordering for "next article after this one is fully scrolled" is the only selection-like concern.
5. **`src-tauri/src/inference/` not built** — ADR-0008 void. Rust ONNX bridge not needed.
6. **`src-tauri/src/platform/`** — `apply_wallpaper` used once at setup to set a solid color; `list_monitors` still used to size the overlay window. `get_desktop_icon_rects` is now load-bearing per ADR-0021/0022.
7. **Editor UI sections collapse further** — likely just 内容 (article list + reader) + 设置 (background color, pet config, 关于). To be re-grilled.
8. **MVP scope: single-monitor only**. The overlay window covers the primary monitor. Multi-monitor support (cross-monitor span, per-monitor overlay, or secondary-monitor solid-only) deferred to post-MVP. This is a scope bound, not an architectural decision — the algorithm in ADR-0022 is monitor-count-agnostic.

## Consequences

- `docs/CONTEXT.md` must be updated to remove `Passage`, `Priority`, `Rotation Set`, `Attention Pipeline`, and the `Reminder vs Reading` framing (replaced by a reading-driven-by-pet framing). Net-new terms (`Pet`, `Scroll Progress`, `Display Column`) will be added as the new direction is grilled out.
- `docs/DEVELOPMENT_PLAN.md` is partially void — Phases 1–2 (gap analysis + architecture) analyzed an architecture that no longer exists. Phases 3+ must be re-planned against the new shape.
- `docs/gap-analysis.md` and `docs/architecture-refactor.md` are historical artifacts describing the pre-pivot architecture. They are not deleted (they document why we got here) but are no longer prescriptive.
- The GitHub issue tracker (Phases 4–6) will be planned against the new shape, not the old.
- Skills plan (Phase 5 tracer-bullet slices) must be re-cut entirely.
