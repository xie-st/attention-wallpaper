import type { TextRegion } from "@layout-region";
import type { SourceArticle } from "@content-model";
import {
  layoutText,
  type FontSpec,
  type MeasuredLine,
  type TextMeasurer,
} from "./index";

export const ARTICLE_FONT_FAMILY = "Noto Serif SC";
export const MIN_FONT_SIZE = 18;
export const MAX_FONT_SIZE = 36;
export const WHITESPACE_MIN = 0.35;
export const WHITESPACE_MAX = 0.65;
export const MAX_ITERATIONS = 3;

export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidOutColumn {
  region: TextRegion;
  lines: MeasuredLine[];
  fontSize: number;
  startY: number;
}

export interface LaidOutArticle {
  columns: LaidOutColumn[];
  totalHeight: number;
  visibleStartY: number;
  visibleEndY: number;
}

export interface PretextArticleLayoutOptions {
  visibleViewport: RectLike;
  petScrollProgress: number;
  measurer?: TextMeasurer;
  fontFamily?: string;
}

/**
 * Lay out an article's text across Text Regions per ADR-0022 Pass 2.
 * Font size + column-ratio iteration drives whitespace ratio into the
 * target [0.35, 0.65] band. Font family is pinned to `Noto Serif SC`
 * per ADR-0006 regardless of `baseFontSpec.family`.
 */
export function pretextArticleLayout(
  article: SourceArticle,
  regions: TextRegion[],
  baseFontSpec: FontSpec,
  opts: PretextArticleLayoutOptions,
): LaidOutArticle {
  if (regions.length === 0) {
    return {
      columns: [],
      totalHeight: 0,
      visibleStartY: 0,
      visibleEndY: opts.visibleViewport.h,
    };
  }

  const family = opts.fontFamily ?? ARTICLE_FONT_FAMILY;
  const measurer =
    opts.measurer ?? failWithoutMeasurer("pretextArticleLayout requires a TextMeasurer");

  const text = article.plainText;
  let fontSize = clamp(baseFontSpec.size, MIN_FONT_SIZE, MAX_FONT_SIZE);
  let columns: LaidOutColumn[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    columns = layOutOnce(regions, text, family, fontSize, measurer);
    const ratio = whitespaceRatio(columns);
    if (ratio >= WHITESPACE_MIN && ratio <= WHITESPACE_MAX) break;
    if (ratio < WHITESPACE_MIN) {
      // too sparse → text too small relative to region; bump font up
      fontSize = clamp(fontSize + 1, MIN_FONT_SIZE, MAX_FONT_SIZE);
    } else {
      // too dense → text overflows; shrink font
      fontSize = clamp(fontSize - 1, MIN_FONT_SIZE, MAX_FONT_SIZE);
    }
  }

  const totalHeight = columns.reduce((acc, c) => acc + columnHeight(c, fontSize), 0);
  const viewportH = opts.visibleViewport.h;
  const scrollable = Math.max(0, totalHeight - viewportH);
  const visibleStartY = clamp(
    opts.petScrollProgress * scrollable,
    0,
    scrollable,
  );
  const visibleEndY = visibleStartY + viewportH;

  return {
    columns,
    totalHeight,
    visibleStartY,
    visibleEndY,
  };
}

function layOutOnce(
  regions: TextRegion[],
  text: string,
  family: string,
  fontSize: number,
  measurer: TextMeasurer,
  maxLines?: number,
): LaidOutColumn[] {
  const lineHeight = Math.round(fontSize * 1.4);
  const font: FontSpec = { family, size: fontSize, weight: baseFontWeight };
  const columns: LaidOutColumn[] = [];
  let consumed = 0;
  let startY = 0;
  for (const region of regions) {
    const colWidth = region.w;
    const maxSafeWidth = Math.max(fontSize * 12, colWidth);
    const remaining = text.slice(consumed);
    if (remaining.length === 0) {
      columns.push({ region, lines: [], fontSize, startY });
      startY += region.h;
      continue;
    }
    const perColMaxLines =
      maxLines ?? Math.max(1, Math.floor(region.h / lineHeight));
    const laid = layoutText(
      remaining,
      font,
      Math.min(colWidth, maxSafeWidth),
      lineHeight,
      measurer,
      perColMaxLines,
    );
    const safeLines = filterStrayIntersections(
      laid.lines,
      region.strayCells,
      lineHeight,
    );
    columns.push({ region, lines: safeLines, fontSize, startY });
    consumed += laid.lines.reduce((acc, l) => acc + l.text.length, 0);
    startY += columnHeight(columns[columns.length - 1], fontSize);
  }
  return columns;
}

function filterStrayIntersections(
  lines: MeasuredLine[],
  strayCells: ReadonlyArray<{ gx: number; gy: number; gw: number; gh: number }>,
  lineHeight: number,
): MeasuredLine[] {
  if (!strayCells || strayCells.length === 0) return lines;
  return lines.filter((line, i) => {
    const lineY = i * lineHeight;
    const lineRect = { x: 0, y: lineY, w: line.width, h: lineHeight };
    for (const s of strayCells) {
      const strayRect = { x: s.gx, y: s.gy, w: s.gw, h: s.gh };
      if (
        lineRect.x < strayRect.x + strayRect.w &&
        lineRect.x + lineRect.w > strayRect.x &&
        lineRect.y < strayRect.y + strayRect.h &&
        lineRect.y + lineRect.h > strayRect.y
      ) {
        return false;
      }
    }
    return true;
  });
}

function columnHeight(col: LaidOutColumn, fontSize: number): number {
  const lineH = Math.round(fontSize * 1.4);
  return Math.max(lineH, col.lines.length * lineH);
}

function whitespaceRatio(columns: LaidOutColumn[]): number {
  let textArea = 0;
  let regionArea = 0;
  for (const c of columns) {
    regionArea += c.region.w * c.region.h;
    const lineH = Math.round(c.fontSize * 1.4);
    for (const line of c.lines) {
      textArea += line.width * lineH;
    }
  }
  if (regionArea === 0) return 0;
  return textArea / regionArea;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const baseFontWeight = 500;

function failWithoutMeasurer(reason: string): TextMeasurer {
  throw new Error(reason);
}
