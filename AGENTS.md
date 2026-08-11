# Attention Wallpaper

A local-first Windows desktop app that projects curated passages from articles you deeply agree with onto the desktop wallpaper as low-distraction reminders. Built with Tauri 2 + React 18 + TypeScript + Rust.

## Agent skills

This repo is configured for the mattpocock/skills pack plus anthropics/frontend-design and vercel-labs/agent-skills. The engineering skills read the following config files before doing their work.

### Issue tracker

GitHub Issues (via `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at root + `docs/adr/` (0001–0017). See `docs/agents/domain.md`.

## Before working

1. Read `CONTEXT.md` — learn the domain vocabulary (Passage, Source Article, Wallpaper, Reminder vs Reading, Priority, Attention Pipeline).
2. Read `docs/adr/` — 0001–0017 define the MVP architecture. Later ADRs supersede earlier ones where noted.
3. Read `docs/DEVELOPMENT_PLAN.md` — phased execution plan using the mattpocock/skills pack.
4. Read `docs/agents/domain.md` — how to consume the above.

## Key commands

```bash
pnpm install              # install JS dependencies
pnpm test                 # run all unit + integration tests
pnpm typecheck            # TypeScript strict typecheck
pnpm build                # production frontend build (Vite)
pnpm tauri:dev            # full desktop dev (Rust + WebView2 + hot reload)
pnpm tauri:build          # MSI + NSIS installer
```

## Aesthetic directive

Fresh/clean palette + minimal style (see `docs/DEVELOPMENT_PLAN.md` → "Aesthetic directive — 清新简约"). **Light theme**: off-white background (`#FAFBFC`), soft slate text (`#2E3440`), one accent (suggested calm sage `#6B8F71` or muted sky `#7AA6C2`, used sparingly for primary actions only). No saturated primaries, no dark-mode-by-default. Sans-serif UI chrome (Noto Sans SC) 14–16px body; serif reserved for Passage text on the wallpaper only (Noto Serif SC). Line icons only (stroke 1.5px, e.g. lucide), no drop shadows, no motion beyond native OS transitions. Non-negotiable for MVP.
