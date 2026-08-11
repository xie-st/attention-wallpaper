# Pet format: Codex-compatible spritesheet + scripted behavior (no ML)

The pet adopts the **Codex 8×9 standard spritesheet format** (`1536×1872`, 8 columns × 9 rows of `192×208` cells) as the asset format. The 9 rows are re-semanticized for this product's "reader/walker" metaphor instead of Codex's "AI agent status indicator" metaphor. Pet behavior is driven by a **scripted state machine + Perlin-noise motion** in the overlay window's Canvas — no ML/LLM inference, no ONNX, no Rust-side `inference/` module.

## Why

The Codex spritesheet format is the de-facto standard backed by OpenAI's official `hatch-pet` skill and a large community ecosystem (`openpets.sh`, `codex-pets.net`, `petdex.crafter.run`, hundreds of installable pets). Adopting it gives:
- **Compatible pet assets** — any community pet drops in directly; the `hatch-pet` skill can generate custom pets.
- **A proven runtime model** — CoPet (Tauri 2 + Rust + React) demonstrates the architecture works: transparent overlay window, Canvas-rendered sprite frames, Rust-core state derivation, React-frontend composition.

The pet's described behavior (stop-and-go, variable step size, side-to-side drift, average downward rate, double-click reverses) is **pure kinematics** — Perlin noise + state machine. There is no decision that requires inference. ADR-0008 (ONNX bridge) remains void; `packages/attention` remains deletable; no `src-tauri/src/inference/` module is built.

## State row mapping (8×9 standard)

The 9 rows are re-semanticized from Codex's "AI agent状态" to this product's "reader walker" metaphor:

| Row | Codex semantic | Our semantic | When it plays |
|-----|----------------|--------------|---------------|
| 0 | `idle` | `idle` | Pet stationary (between walks) |
| 1 | `running-right` | `drift-right` | Side-to-side drift rightward during walks |
| 2 | `running-left` | `drift-left` | Side-to-side drift leftward during walks |
| 3 | `waving` | `celebrate` | Brief flourish on rewind complete or article-switch |
| 4 | `jumping` | `hop` | Random idle hop (rare, for liveliness) |
| 5 | `failed` | `end-of-article` | Pet reaches the end of the Source Article (no more text) |
| 6 | `waiting` | `pause` | Pet in a stop-and-go pause (not walking, not idle-long) |
| 7 | `running` (work) | `walk-down` | **Core state** — pet walking downward, advancing Scroll Progress |
| 8 | `review` | `walk-up` | **Rewind state** — pet walking upward after double-click, decreasing Scroll Progress |

The 8×11 v2 format (with 16 gaze directions) is supported as a superset — when present, the pet's eyes follow the mouse cursor when nearby.

## Considered options

- **Codex 8×9 format + scripted behavior** (accepted) — ecosystem-compatible, no ML, kinematics sufficient.
- **8×9 format + ML-driven behavior** (rejected) — kinematics problem doesn't need inference; would re-open ADR-0008.
- **Custom spritesheet format** (rejected) — forfeits community pet compatibility and the `hatch-pet` skill.
- **Use only 4-5 rows** (rejected) — breaks compatibility with community pets (all 9 rows expected); wastes available animations.

## Consequences

- `src-tauri/src/platform/` gains no `inference/` module; `packages/attention` is deleted (per ADR-0019).
- `packages/pretext-layout` is retained (article column layout) but its contrast/pickTextLumaFor helpers become unused against a solid-color background — flag for later cleanup.
- The Overlay Window's React frontend gains a `PetRenderer` component that loads a `pet.json` + `spritesheet.webp` pair and renders frames via Canvas at ~30 fps.
- A `PetBehavior` state machine (TS) drives row selection: `walk-down` is the default forward state; `walk-up` is the rewind state; `pause`/`idle`/`drift-*`/`hop` are noise-triggered stop-and-go flavors; `end-of-article` triggers when scroll reaches the article's end; `celebrate` fires on rewind-complete or article-switch.
- Perlin noise (or similar) modulates step size + horizontal drift + pause duration within the `walk-down`/`walk-up` states, bounded by an average downward rate (configurable).
- Pet assets are user-installable: a `pets/` directory (or `~/.attention-wallpaper/pets/`) holds `pet.json` + `spritesheet.webp` packages; built-in pet(s) bundled with the app.
- `CONTEXT.md` gains `Pet`, `Pet Behavior State`, `Spritesheet` terms.
- ADR-0014 (tray four actions) — "下一组" no longer makes sense under pet-driven scroll; tray re-spec needed (deferred to a later grilling round).
