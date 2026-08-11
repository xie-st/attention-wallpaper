# Remove the 隐私 UI section

The "隐私" section is removed as a top-level UI tab. The MVP has 3 top-level sections instead of the README's 5: **内容 / 壁纸 / 显示器**. Privacy guarantees (all data local, never uploaded) move to a static block in 设置 or an "关于" page. ONNX model status (loaded/unavailable/error) — now meaningful after ADR-0008 — also lives in 设置 as a diagnostics block.

## Why

After AI generation is removed (ADR-0007), the 隐私 section had no interactive content — it was a pure-display page restating "everything is local" in an app whose entire value prop is being local. A standalone tab for a non-interactive guarantee is empty calories. With ONNX now wired (ADR-0008), the model status that lived in 隐私 becomes a settings diagnostic, not a privacy concern — it belongs next to the model manifest path config.

## Consequences

- UI sections: 5 → 3 (内容 / 壁纸 / 显示器); 设置 holds privacy statement + ONNX diagnostics.
- `src/sections/` loses the privacy section directory; its content is split into 设置 blocks.
- README's "隐私" references update to point to 设置.
