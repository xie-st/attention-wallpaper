import { describe, it, expect } from "vitest";
import {
  ApiClient,
  checkQuota,
  DEFAULT_QUOTA,
  validateGeneratedPng,
  type GenerateRequest,
  type Job,
  type Quota
} from "./index";

function quota(over: Partial<Quota> = {}): Quota {
  return {
    dailyUsed: 0,
    dailyLimit: DEFAULT_QUOTA.dailyLimit,
    monthlyUsed: 0,
    monthlyLimit: DEFAULT_QUOTA.monthlyLimit,
    concurrent: 0,
    concurrentLimit: DEFAULT_QUOTA.concurrentLimit,
    resetAt: "2026-08-12T00:00:00.000Z",
    ...over
  };
}

describe("quota", () => {
  it("allows within limits", () => {
    expect(checkQuota(quota(), true).allowed).toBe(true);
  });
  it("blocks when inactive", () => {
    expect(checkQuota(quota(), false).allowed).toBe(false);
  });
  it("blocks at daily limit (default 3)", () => {
    expect(checkQuota(quota({ dailyUsed: 3 }), true).reason).toBe("daily_exceeded");
  });
  it("blocks at monthly limit (default 20)", () => {
    expect(checkQuota(quota({ monthlyUsed: 20 }), true).reason).toBe("monthly_exceeded");
  });
  it("blocks concurrency > limit", () => {
    expect(checkQuota(quota({ concurrent: 1 }), true).reason).toBe("concurrency_exceeded");
  });
});

describe("validateGeneratedPng", () => {
  function makePng(w: number, h: number): Uint8Array {
    // Minimal valid PNG signature + IHDR
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const ihdrLen = [0, 0, 0, 13];
    const ihdrType = [73, 72, 68, 82];
    const width = [(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255];
    const height = [(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
    const rest = [8, 6, 0, 0, 0];
    const crc = [0, 0, 0, 0];
    return Uint8Array.from([...sig, ...ihdrLen, ...ihdrType, ...width, ...height, ...rest, ...crc]);
  }

  it("accepts a PNG of the requested size", () => {
    const png = makePng(1920, 1080);
    const v = validateGeneratedPng(png, { width: 1920, height: 1080 });
    expect(v.ok).toBe(true);
    expect(v.width).toBe(1920);
    expect(v.height).toBe(1080);
  });

  it("rejects non-PNG bytes", () => {
    const v = validateGeneratedPng(new Uint8Array([1, 2, 3, 4]), { width: 10, height: 10 });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("too_short");
  });

  it("rejects size mismatch", () => {
    const png = makePng(800, 600);
    const v = validateGeneratedPng(png, { width: 1920, height: 1080 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("size_mismatch");
  });
});

describe("ApiClient contracts (mock fetch)", () => {
  function mockFetch(routes: Record<string, (url: string, init?: RequestInit) => { status: number; body: unknown }>) {
    return async (url: string, init?: RequestInit) => {
      const u = new URL(url, "http://mock");
      const key = `${init?.method ?? "GET"} ${u.pathname}`;
      const handler = routes[key];
      if (!handler) throw new Error(`no route for ${key}`);
      const { status, body } = handler(u.pathname + u.search, init);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    };
  }

  it("POST /v1/activate", async () => {
    const fetchImpl = mockFetch({
      "POST /v1/activate": () => ({ status: 200, body: { ok: true, expiresAt: "2026-09-01T00:00:00.000Z" } })
    });
    const client = new ApiClient("http://mock", fetchImpl as unknown as typeof fetch);
    const r = await client.activate({ deviceToken: "tok" });
    expect(r.ok).toBe(true);
  });

  it("POST /v1/wallpapers:generate enforces request shape", async () => {
    let captured: GenerateRequest | null = null;
    const fetchImpl = mockFetch({
      "POST /v1/wallpapers:generate": (_u, init) => {
        captured = JSON.parse(init!.body as string) as GenerateRequest;
        return { status: 200, body: { jobId: "job-1" } };
      }
    });
    const client = new ApiClient("http://mock", fetchImpl as unknown as typeof fetch);
    const r = await client.generate({
      monitor: { id: "m1", width: 1920, height: 1080 },
      negativeMaskPng: "aGVsbG8=",
      negativeRegion: { x: 0, y: 0, w: 200, h: 200 },
      prompt: "雾中的远山"
    });
    expect(r.jobId).toBe("job-1");
    expect(captured!.prompt).toBe("雾中的远山");
    expect(captured!.negativeMaskPng.length).toBeGreaterThan(0);
  });

  it("GET /v1/jobs/{id}", async () => {
    const fetchImpl = mockFetch({
      "GET /v1/jobs/job-1": () => ({ status: 200, body: { id: "job-1", status: "succeeded", createdAt: "now", imageUrl: "http://mock/img" } })
    });
    const client = new ApiClient("http://mock", fetchImpl as unknown as typeof fetch);
    const job = await client.getJob("job-1");
    expect(job.status).toBe("succeeded");
  });

  it("GET /v1/quota", async () => {
    const fetchImpl = mockFetch({
      "GET /v1/quota": () => ({ status: 200, body: quota({ dailyUsed: 1 }) })
    });
    const client = new ApiClient("http://mock", fetchImpl as unknown as typeof fetch);
    const q = await client.getQuota();
    expect(q.dailyUsed).toBe(1);
  });

  it("waitForJob polls until terminal", async () => {
    let n = 0;
    const fetchImpl = mockFetch({
      "GET /v1/jobs/job-2": () => {
        n++;
        const status = n < 2 ? "running" : "succeeded";
        const body: Job = { id: "job-2", status: status as Job["status"], createdAt: "now" };
        return { status: 200, body };
      }
    });
    const client = new ApiClient("http://mock", fetchImpl as unknown as typeof fetch);
    const job = await client.waitForJob("job-2", { intervalMs: 1 });
    expect(job.status).toBe("succeeded");
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
