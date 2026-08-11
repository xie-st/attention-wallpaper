// Local mock AI wallpaper service. Implements the four client-contract
// endpoints, in-memory quota (3/day, 20/month, 1 concurrent), and 15-minute
// intermediate-file expiry. No dependency beyond node built-ins.
import { createServer } from "node:http";
import { selectGenerator } from "./generator.mjs";

const PORT = Number(process.env.MOCK_PORT || process.env.PORT || 4319);
const HOST = process.env.MOCK_HOST || "127.0.0.1";

const DAILY_LIMIT = 3;
const MONTHLY_LIMIT = 20;
const CONCURRENT_LIMIT = 1;
const TTL_MS = 15 * 60_000;

const state = {
  active: false,
  expiresAt: null,
  dailyUsed: 0,
  monthlyUsed: 0,
  resetAt: startOfDay(new Date()),
  inFlight: 0,
  /** @type {Map<string, any>} */
  jobs: new Map()
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 1);
  return x.toISOString();
}

function nowIso() { return new Date().toISOString(); }

function quota() {
  return {
    dailyUsed: state.dailyUsed,
    dailyLimit: DAILY_LIMIT,
    monthlyUsed: state.monthlyUsed,
    monthlyLimit: MONTHLY_LIMIT,
    concurrent: state.inFlight,
    concurrentLimit: CONCURRENT_LIMIT,
    resetAt: state.resetAt
  };
}

function checkQuota() {
  if (!state.active) return { allowed: false, reason: "inactive" };
  if (Date.now() >= Date.parse(state.resetAt)) {
    state.dailyUsed = 0;
    state.resetAt = startOfDay(new Date());
  }
  if (state.dailyUsed >= DAILY_LIMIT) return { allowed: false, reason: "daily_exceeded" };
  if (state.monthlyUsed >= MONTHLY_LIMIT) return { allowed: false, reason: "monthly_exceeded" };
  if (state.inFlight >= CONCURRENT_LIMIT) return { allowed: false, reason: "concurrency_exceeded" };
  return { allowed: true };
}

const generator = selectGenerator();

/** @param {import("node:http").IncomingMessage} req */
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  res.writeHead(status, {
    "content-type": isBuffer ? "image/png" : "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    ...headers
  });
  res.end(isBuffer ? body : JSON.stringify(body));
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return send(res, 204, "");

  try {
    if (method === "POST" && path === "/v1/activate") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.deviceToken) return send(res, 400, { ok: false, error: "deviceToken_required" });
      state.active = true;
      state.expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      return send(res, 200, { ok: true, expiresAt: state.expiresAt });
    }

    if (method === "POST" && path === "/v1/wallpapers:generate") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!state.active) return send(res, 403, { error: "inactive" });
      if (!body.monitor || !body.negativeMaskPng || !body.negativeRegion || !body.prompt) {
        return send(res, 400, { error: "missing_fields" });
      }
      const q = checkQuota();
      if (!q.allowed) return send(res, 429, { error: q.reason });
      const jobId = "job-" + Math.random().toString(36).slice(2, 10);
      const job = {
        id: jobId,
        status: "queued",
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + TTL_MS).toISOString()
      };
      state.jobs.set(jobId, job);
      state.inFlight++;
      // Yield once so "queued" is observable by polls, then run.
      setImmediate(async () => {
        try {
          job.status = "running";
          const out = await generator.generate(body);
          job.image = Buffer.from(out.png);
          job.note = out.note;
          job.imageUrl = `/v1/jobs/${jobId}/image`;
          job.status = "succeeded";
        } catch (e) {
          job.status = "failed";
          job.error = String(e?.message || e);
        } finally {
          state.inFlight = Math.max(0, state.inFlight - 1);
          if (job.status === "succeeded") {
            state.dailyUsed++;
            state.monthlyUsed++;
          }
        }
      });
      return send(res, 202, { jobId });
    }

    if (method === "GET" && /\/v1\/jobs\/[^/]+\/image$/.test(path)) {
      const id = path.split("/")[3];
      const job = state.jobs.get(id);
      if (!job || !job.image) return send(res, 404, { error: "not_found" });
      if (job.expiresAt && Date.now() > Date.parse(job.expiresAt)) {
        return send(res, 410, { error: "expired" });
      }
      return send(res, 200, job.image, { "cache-control": "no-store" });
    }

    if (method === "GET" && path.startsWith("/v1/jobs/")) {
      const id = path.slice("/v1/jobs/".length);
      const job = state.jobs.get(id);
      if (!job) return send(res, 404, { error: "not_found" });
      const { image, note, ...rest } = job;
      if (job.expiresAt && Date.now() > Date.parse(job.expiresAt)) {
        return send(res, 410, { error: "expired" });
      }
      return send(res, 200, { ...rest, note });
    }

    if (method === "GET" && path === "/v1/quota") {
      return send(res, 200, quota());
    }

    return send(res, 404, { error: "not_found" });
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: String(e) }));
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => {
    console.log(`[mock-server] listening on http://${HOST}:${PORT} (generator: ${generator.id})`);
  });
}

export { server, handle };
