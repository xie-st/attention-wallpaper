# Passages render as plain text directly on the wallpaper

A **Passage** is composited onto the **Wallpaper** as plain text laid directly on the image — no card, no panel, no container. The attention pipeline (FFT spectral residual, edge density, readability penalty, softCost) exists to find a region where this plain text is legible and to enforce WCAG ≥4.5:1 contrast. When that fails for a given background, the layout degrades through the existing fallback ladder (reduce_count → reflow → translucent cards → safe rail) — the translucent-card mode is a *degraded fallback*, not a primary visual choice.

## Why

The product's verb is **Reminder**, and reminders work best when they are part of the environment rather than a distinct object demanding attention. A card or panel (option B) reframes the Passage as "a thing to look at", which contradicts the low-distraction-sediment intent. Option C (full-screen text layer) suppresses the background image, negating the value of either imported or AI-generated wallpapers. The README's entire attention pipeline is built to solve the plain-text-on-image problem; choosing cards would demote 80% of that code to "where do I put the card".

## Considered options

- **Plain text directly on wallpaper** (accepted) — most "wallpaper-native"; the attention pipeline's whole purpose.
- **Translucent card / panel** (B) — legible and styleable but feels like a desktop widget, not sediment; demotes the attention pipeline.
- **Full-screen text layer over faded background** (C) — maximum text impact but suppresses the wallpaper, negating imported/AI backgrounds.
- **Floating reader panel, not on wallpaper** (D) — rejects the project's core premise; out of scope.

## Consequences

- The "壁纸" section's composite step renders plain text via @chenglou/pretext, no card DOM.
- The fallback ladder stays as the safety net; "translucent cards" is a degraded state, not a feature to develop further.
- Font choice and text color (relative to the saliency-analyzed background) become the primary visual levers — decided in a follow-up ADR.
- AI wallpaper generation should produce backgrounds with large low-distraction regions suitable for plain-text overlay.
