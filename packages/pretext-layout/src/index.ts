import {
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
  type PreparedTextWithSegments
} from "@chenglou/pretext";

export interface FontSpec {
  family: string;
  size: number;
  weight?: number;
  letterSpacing?: number;
}

export interface MeasuredLine {
  text: string;
  width: number;
}

export interface LaidOutText {
  lines: MeasuredLine[];
  totalHeight: number;
  /** True if every line fits within maxWidth. */
  fits: boolean;
}

export interface TextMeasurer {
  measureNaturalWidth(text: string, font: FontSpec): number;
  layoutLines(text: string, font: FontSpec, maxWidth: number, lineHeight: number): MeasuredLine[];
}

/** Build the CSS/Canvas font string used by both pretext and the renderer. */
export function canvasFont(font: FontSpec): string {
  const weight = font.weight ?? 500;
  const ls = font.letterSpacing ?? 0;
  const familyStr = font.family.includes(" ") ? `"${font.family}"` : font.family;
  // Pretext reads the font size out of the standard font shorthand. The
  // renderer applies letterSpacing separately via ctx.letterSpacing.
  void ls;
  return `${weight} ${font.size}px ${familyStr}`;
}

/**
 * Production measurer backed by @chenglou/pretext. Requires a Canvas context
 * (browser or WebView2). In Node this constructor throws when first used; use
 * the injectable interface in tests instead.
 */
export class PretextMeasurer implements TextMeasurer {
  private readonly cache = new Map<string, PreparedTextWithSegments>();

  private prepare(text: string, font: FontSpec): PreparedTextWithSegments {
    const key = canvasFont(font) + "\u0000" + text;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const prepared = prepareWithSegments(text, canvasFont(font), {
      letterSpacing: font.letterSpacing ?? 0
    });
    this.cache.set(key, prepared);
    return prepared;
  }

  measureNaturalWidth(text: string, font: FontSpec): number {
    return measureNaturalWidth(this.prepare(text, font));
  }

  layoutLines(text: string, font: FontSpec, maxWidth: number, lineHeight: number): MeasuredLine[] {
    const prepared = this.prepare(text, font);
    const { lines } = layoutWithLines(prepared, maxWidth, lineHeight);
    return lines.map((l) => ({ text: l.text, width: l.width }));
  }
}

/**
 * Core layout routine used by the compositor. Reflows text up to `maxLines`
 * within `maxWidth`; if it still doesn't fit, returns the truncated result with
 * `fits=false`. The fallback ladder (reduce count / reflow / translucent /
 * safe rail) is driven by the attention package; this function just reports
 * whether the text fits at the given size.
 */
export function layoutText(
  text: string,
  font: FontSpec,
  maxWidth: number,
  lineHeight: number,
  measurer: TextMeasurer,
  maxLines = 6
): LaidOutText {
  const all = measurer.layoutLines(text, font, maxWidth, lineHeight);
  const truncated = all.length > maxLines;
  let lines = truncated ? all.slice(0, maxLines) : all;
  if (truncated && lines.length > 0) {
    const last = lines[lines.length - 1];
    const ellipsis = "…";
    lines = lines.slice(0, -1).concat({ text: last.text.trimEnd() + ellipsis, width: last.width });
  }
  return { lines, totalHeight: lines.length * lineHeight, fits: !truncated };
}

/** Relative luminance from an sRGB [0,1] component. */
export function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.1 contrast ratio between two relative luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const a = Math.max(l1, l2);
  const b = Math.min(l1, l2);
  return (a + 0.05) / (b + 0.05);
}

/**
 * Choose black or white text for the given background luminance so contrast is
 * maximised. Returns 0 (black) or 1 (white) as a "text luma class".
 */
export function pickTextLumaFor(bgLuminance: number): 0 | 1 {
  const white = contrastRatio(1, bgLuminance);
  const black = contrastRatio(0, bgLuminance);
  return white >= black ? 1 : 0;
}
