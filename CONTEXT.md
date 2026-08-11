# Attention Wallpaper

A local-first Windows desktop app that renders a user-imported article as multi-column text directly on the desktop, with an AI pet walking across the text layer driving scroll progress. Built with Tauri 2 + React + Rust. The "wallpaper" is a static solid color; all dynamic content (article text + pet animation) lives in a transparent always-on-top overlay window.

> **Note**: This CONTEXT.md reflects the architectural pivot in ADR-0019. Earlier ADRs (0001–0018) defining the Passages-on-wallpaper model are superseded; this glossary describes the post-pivot product.

## Language

**Source Article**:
An article the user imports (.docx/.txt/.md) that becomes the desktop's text layer. The whole article is the unit — no Passage extraction, no highlighting, no per-paragraph curation. Multiple articles may be stored; the user advances from one to the next.
_Avoid_: Document, file, text

**Overlay Window**:
A transparent, always-on-top, decoration-less Tauri window that covers the desktop and renders the article text columns + the pet via Canvas + requestAnimationFrame. Distinct from the Editor Window (the normal Tauri window for managing articles + settings). Wallpaper-engine-style: it does not paint a wallpaper PNG, it paints onto a transparent overlay.
_Avoid_: Wallpaper layer, foreground window, canvas

**Editor Window**:
A normal Tauri window (with decorations) for importing/managing Source Articles, choosing the solid background color, configuring the pet, and reading about/privacy. Opened on demand via tray; closed without quitting the app.
_Avoid_: Main window, settings window

**Pet**:
An AI character that walks around the Overlay Window's Canvas. Movement is stop-and-go: variable step size, side-to-side drift, with a net downward average rate. The pet's vertical position drives article text scroll (pet descends → text advances; double-click pet → pet walks backward → text rewinds). Movement is non-deterministic but bounded by an average rate. The pet is **scripted** (Perlin noise + state machine), not ML-driven — no inference, no ONNX.
_Avoid_: Avatar, character, mascot

**Spritesheet**:
The pet's asset format — a Codex-compatible 8×9 standard atlas (`1536×1872`, 8 columns × 9 rows of `192×208` cells) plus a `pet.json` manifest. Adopted from the Codex pets ecosystem (OpenAI's `hatch-pet` skill, `openpets.sh`, `codex-pets.net`) so community pets drop in directly. The 8×11 v2 superset (with 16 gaze directions) is also supported.
_Avoid_: Pet image, character art, sprite

**Pet Behavior State**:
One of 9 states mapped to the spritesheet rows, re-semanticized from Codex's "AI agent status" to this product's "reader walker" metaphor: `idle` (stationary), `drift-right` / `drift-left` (side-to-side during walks), `celebrate` (flourish on rewind-complete/article-switch), `hop` (rare idle hop), `end-of-article` (scroll reached the end), `pause` (stop-and-go pause), `walk-down` (core forward state — pet descends, Scroll Progress advances), `walk-up` (rewind state — pet ascends after double-click, Scroll Progress rewinds). Drives which spritesheet row the renderer plays.
_Avoid_: Animation state, agent state

**Scroll Progress**:
The current vertical offset into the Source Article's pretext-laid-out text, synchronized with the pet's vertical position. Not time-driven (no 15-min cadence); advanced or rewound purely by pet movement.
_Avoid_: Rotation, position, page

**Display Column**:
One of two pretext-laid-out text columns on the right half of the screen. Column count is fixed at 2; column width adapts to display dimensions and font size. The left half is reserved for desktop icons (by assumption). The final partial column, if it can't be filled, degrades to a single row per the user's layout rule (re-confirm in grilling).
_Avoid_: Text pane, text region, slot

**Solid Background**:
The desktop wallpaper itself — a single solid color set once via `IDesktopWallpaper::SetWallpaper` (or kept as the user's existing wallpaper). The Overlay Window's transparency lets this color show through behind the text. No PNG/JPG import.
_Avoid_: Wallpaper image, background image

## Relationships

- A **Source Article** is imported via the **Editor Window** and stored locally.
- The **Overlay Window** renders the current **Source Article** as **Display Columns** + the **Pet**.
- The **Pet**'s vertical position determines **Scroll Progress** through the current **Source Article**.
- When **Scroll Progress** reaches the end of a **Source Article**, the next stored article begins (ordering TBD).
- The **Solid Background** is set once and does not change with scroll or article switching.

## Flagged ambiguities (to resolve in follow-up grilling)

- "剩下的部分就变成一行" — the exact layout rule for the final partial column is not yet precise.
- Whether the pet AI is a scripted behavior (perlin noise + state machine) or an actual inference-driven agent (would re-open ADR-0008 ONNX question).
- Article switching: when scroll reaches the end, what determines the next article? Priority/import-time/manual?
- Multi-monitor: does the overlay span all monitors, or is it per-monitor with one pet?
- Tray actions: "下一组" no longer makes sense under pet-driven scroll. Tray re-spec needed.
- The "AI selects which段" mode the user mentioned as an alternative to sequential scroll — deferred to post-MVP, or still in scope?
