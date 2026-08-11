// Provider-neutral ImageGenerator implementations for the mock AI server.
// - MockImageGenerator: deterministic local placeholder, clearly labelled.
// - GeminiImageGenerator: real adapter, wired only when GEMINI_API_KEY is set.
//   Never fabricates a Gemini response — on any failure it throws.
import { encodePng } from "./png.mjs";

/**
 * @typedef {import("../packages/ai-client/src/index.ts").GenerateRequest} GenerateRequest
 * @typedef {import("../packages/ai-client/src/index.ts").ImageGenerator} ImageGenerator
 */

const MOCK_NOTE = "local-mock: this image was generated deterministically by the bundled mock server, not by a cloud模型.";

/** Deterministic mock generator. Renders a calm gradient honouring the
 *  requested negative region. The output is a real PNG so the client can
 *  validate dimensions end-to-end. */
export class MockImageGenerator {
  constructor() { this.id = "mock"; }
  /** @param {GenerateRequest} req */
  async generate(req) {
    const { width, height } = req.monitor;
    const region = req.negativeRegion;
    // Deterministic 2-stop gradient seeded by the prompt hash.
    let h = 0;
    for (const ch of req.prompt) h = (h * 131 + ch.codePointAt(0)) >>> 0;
    const hueA = h % 360;
    const hueB = (hueA + 40) % 360;
    const png = encodePng(width, height, (x, y) => {
      const t = y / height;
      const inRegion = x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h;
      if (inRegion) {
        // keep negative space muted so the local compositor can place text
        return [245, 245, 242, 255];
      }
      const hue = hueA + (hueB - hueA) * t;
      const [r, g, b] = hslToRgb(hue / 360, 0.35, 0.25 + 0.15 * t);
      return [r, g, b, 255];
    });
    return { png: new Uint8Array(png), note: MOCK_NOTE };
  }
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Real Gemini adapter. Activated only when GEMINI_API_KEY is set. Calls the
 * Gemini endpoint via fetch; on any error throws — never fabricates an image.
 */
export class GeminiImageGenerator {
  constructor({ apiKey, model, fetchImpl = fetch }) {
    this.id = "gemini";
    this.apiKey = apiKey;
    this.model = model || "gemini-3.1-flash-image";
    this.fetchImpl = fetchImpl;
  }
  /** @param {GenerateRequest} req */
  async generate(req) {
    if (!this.apiKey) throw new Error("GeminiImageGenerator: missing API key");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    let res;
    try {
      res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: req.prompt,
          monitor: req.monitor,
          negativeRegion: req.negativeRegion
          // negativeMaskPng is intentionally NOT forwarded unless the user
          // opted in; the contract keeps the mask local by default.
        })
      });
    } catch (e) {
      throw new Error(`GeminiImageGenerator: network error: ${e}`);
    }
    if (!res.ok) throw new Error(`GeminiImageGenerator: HTTP ${res.status}`);
    const json = await res.json();
    const b64 = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error("GeminiImageGenerator: no image in response");
    const png = Uint8Array.from(Buffer.from(b64, "base64"));
    return { png, note: "gemini:flash-image" };
  }
}

/** Pick the generator based on environment. No hard-coded keys. */
export function selectGenerator(env = process.env, fetchImpl = fetch) {
  if (env.GEMINI_API_KEY) {
    return new GeminiImageGenerator({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fetchImpl });
  }
  return new MockImageGenerator();
}
