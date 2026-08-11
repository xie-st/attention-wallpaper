import { describe, it, expect } from "vitest";
import {
  canvasFont,
  contrastRatio,
  layoutText,
  pickTextLumaFor,
  relativeLuminance,
  srgbToLinear,
  type FontSpec,
  type MeasuredLine,
  type TextMeasurer
} from "./index";

/** Stub measurer: each CJK/emoji grapheme counts 1 unit, ASCII 0.5 unit. */
function stubMeasurer(scale = 20): TextMeasurer {
  const width = (text: string) => {
    let w = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      w += code > 0x2e7f ? scale : scale * 0.5;
    }
    return w;
  };
  return {
    measureNaturalWidth: width,
    layoutLines: (text, _font, maxWidth, lineHeight) => {
      const lines: MeasuredLine[] = [];
      let cur = "";
      let curW = 0;
      const push = () => {
        lines.push({ text: cur, width: curW });
        cur = "";
        curW = 0;
      };
      for (const ch of text) {
        const cw = width(ch);
        if (curW + cw > maxWidth && cur.length > 0) push();
        cur += ch;
        curW += cw;
      }
      if (cur.length > 0 || lines.length === 0) push();
      void lineHeight;
      return lines;
    }
  };
}

const font: FontSpec = { family: "Noto Sans CJK SC", size: 20, weight: 500 };

describe("canvasFont", () => {
  it("quotes families with spaces", () => {
    expect(canvasFont(font)).toBe('500 20px "Noto Sans CJK SC"');
  });
  it("does not quote single-word families", () => {
    expect(canvasFont({ family: "Inter", size: 12 })).toBe("500 12px Inter");
  });
});

describe("luminance + contrast", () => {
  it("srgb->linear near 0 is linear", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 5);
  });
  it("white on black is 21:1", () => {
    expect(contrastRatio(relativeLuminance(1, 1, 1), relativeLuminance(0, 0, 0))).toBeCloseTo(21, 0);
  });
  it("picks white for dark bg and black for light bg", () => {
    expect(pickTextLumaFor(relativeLuminance(0.05, 0.05, 0.05))).toBe(1);
    expect(pickTextLumaFor(relativeLuminance(0.95, 0.95, 0.95))).toBe(0);
  });
});

describe("layoutText", () => {
  it("fits a short line", () => {
    const m = stubMeasurer();
    const out = layoutText("短句", font, 400, 26, m);
    expect(out.fits).toBe(true);
    expect(out.lines.length).toBe(1);
    expect(out.totalHeight).toBe(26);
  });

  it("wraps and truncates with ellipsis when exceeding maxLines", () => {
    const m = stubMeasurer();
    const long = "一二三四五六七八九十十一十二十三十四";// 15 CJK chars, width 300
    const out = layoutText(long, font, 40, 24, m, 2); // 2 chars per line, cap 2 lines
    expect(out.fits).toBe(false);
    expect(out.lines.length).toBe(2);
    expect(out.lines[1].text.endsWith("…")).toBe(true);
  });
});
