import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { ApiClient, validateGeneratedPng } from "@ai-client";
import { handle } from "../mock-server/server.mjs";

function startServer(): Promise<{ server: Server; port: number; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      handle(req, res).catch((e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(e) }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port, base: `http://127.0.0.1:${port}` });
    });
  });
}

describe("mock server end-to-end", () => {
  let server: Server;
  let client: ApiClient;

  beforeAll(async () => {
    const s = await startServer();
    server = s.server;
    client = new ApiClient(s.base);
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("rejects generation before activation", async () => {
    await expect(
      client.generate({
        monitor: { id: "m1", width: 320, height: 180 },
        negativeMaskPng: "AAAA",
        negativeRegion: { x: 0, y: 0, w: 50, h: 50 },
        prompt: "山"
      })
    ).rejects.toThrow();
  });

  it("runs the full contract: activate -> generate -> poll -> quota -> validate", async () => {
    await client.activate({ deviceToken: "dev-token" });
    const { jobId } = await client.generate({
      monitor: { id: "m1", width: 320, height: 180 },
      negativeMaskPng: "AAAA",
      negativeRegion: { x: 0, y: 0, w: 50, h: 50 },
      prompt: "雾中的远山"
    });
    const job = await client.waitForJob(jobId, { timeoutMs: 5000, intervalMs: 50 });
    expect(job.status).toBe("succeeded");
    expect(job.imageUrl).toBeTruthy();

    const imgRes = await fetch(client.resolve(job.imageUrl!));
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    const v = validateGeneratedPng(buf, { width: 320, height: 180 });
    expect(v.ok).toBe(true);
    expect(v.width).toBe(320);
    expect(v.height).toBe(180);

    const q = await client.getQuota();
    expect(q.dailyUsed).toBe(1);
    expect(q.dailyLimit).toBe(3);
    expect(q.monthlyLimit).toBe(20);
    expect(q.concurrentLimit).toBe(1);
  });

  it("enforces the daily quota (3/day)", async () => {
    // We already used 1 today; use the remaining 2 then expect failure.
    for (let i = 0; i < 2; i++) {
      const { jobId } = await client.generate({
        monitor: { id: "m1", width: 64, height: 64 },
        negativeMaskPng: "AAAA",
        negativeRegion: { x: 0, y: 0, w: 10, h: 10 },
        prompt: "p"
      });
      const job = await client.waitForJob(jobId, { timeoutMs: 5000, intervalMs: 50 });
      expect(job.status).toBe("succeeded");
    }
    await expect(
      client.generate({
        monitor: { id: "m1", width: 64, height: 64 },
        negativeMaskPng: "AAAA",
        negativeRegion: { x: 0, y: 0, w: 10, h: 10 },
        prompt: "p"
      })
    ).rejects.toThrow();
  });
});
