/**
 * Provider-neutral AI wallpaper service contracts. Attention analysis is
 * always local; only AI generation leaves the device, and only when the user
 * triggers it. The client never hard-codes keys — the device token is read
 * from a secure store by the host app and passed in.
 */

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MonitorSpec {
  id: string;
  width: number;
  height: number;
}

export interface ActivationRequest {
  deviceToken: string;
  deviceName?: string;
}

export interface ActivationResponse {
  ok: boolean;
  /** ISO8601 expiry of the activation. */
  expiresAt: string;
}

export interface GenerateRequest {
  monitor: MonitorSpec;
  /** Explicit negative-space mask as a lossless PNG (base64, no data URL). The   * server must NOT store or re-upload the source wallpaper; only this mask. */
  negativeMaskPng: string;
  /** The negative-space region in monitor pixel coordinates. */
  negativeRegion: Region;
  prompt: string;
  style?: string;
}

export interface GenerateResponse {
  jobId: string;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  /** URL to fetch the generated PNG. Expires after 15 minutes per spec. */
  imageUrl?: string;
  expiresAt?: string;
  error?: string;
  createdAt: string;
}

export interface Quota {
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  concurrent: number;
  concurrentLimit: number;
  /** ISO8601 when the daily counter resets. */
  resetAt: string;
}

export interface QuotaDecision {
  allowed: boolean;
  reason?: "daily_exceeded" | "monthly_exceeded" | "concurrency_exceeded" | "inactive";
}

export const DEFAULT_QUOTA = {
  dailyLimit: 3,
  monthlyLimit: 20,
  concurrentLimit: 1
} as const;

export const INTERMEDIATE_TTL_MS = 15 * 60_000;

/** Pure quota check used by both the client (pre-flight) and server. */
export function checkQuota(q: Quota, active: boolean): QuotaDecision {
  if (!active) return { allowed: false, reason: "inactive" };
  if (q.dailyUsed >= q.dailyLimit) return { allowed: false, reason: "daily_exceeded" };
  if (q.monthlyUsed >= q.monthlyLimit) return { allowed: false, reason: "monthly_exceeded" };
  if (q.concurrent >= q.concurrentLimit) return { allowed: false, reason: "concurrency_exceeded" };
  return { allowed: true };
}

export interface GeneratedImageValidation {
  ok: boolean;
  reason?: string;
  width: number;
  height: number;
}

/**
 * Validate a generated image's bytes before allowing Apply. Decodes the PNG
 * IHDR only (no full decode) to keep it dependency-free, and checks that the
 * dimensions match the requested monitor size.
 */
export function validateGeneratedPng(
  bytes: Uint8Array,
  expected: { width: number; height: number }
): GeneratedImageValidation {
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24) return { ok: false, reason: "too_short", width: 0, height: 0 };
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) return { ok: false, reason: "not_png", width: 0, height: 0 };
  }
  // IHDR chunk: bytes 16..19 width, 20..23 height (big-endian).
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width !== expected.width || height !== expected.height) {
    return { ok: false, reason: `size_mismatch:expected=${expected.width}x${expected.height},actual=${width}x${height}`, width, height };
  }
  return { ok: true, width, height };
}

/** HTTP client for the four service endpoints. */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** Resolve a possibly-relative service URL against the API base. */
  resolve(url: string): string {
    return url.startsWith("http") ? url : `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  async activate(req: ActivationRequest): Promise<ActivationResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req)
    });
    if (!res.ok) throw new Error(`activate failed: ${res.status}`);
    return (await res.json()) as ActivationResponse;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/wallpapers:generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req)
    });
    if (!res.ok) throw new Error(`generate failed: ${res.status}`);
    return (await res.json()) as GenerateResponse;
  }

  async getJob(id: string): Promise<Job> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/jobs/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`getJob failed: ${res.status}`);
    return (await res.json()) as Job;
  }

  async getQuota(): Promise<Quota> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/quota`);
    if (!res.ok) throw new Error(`getQuota failed: ${res.status}`);
    return (await res.json()) as Quota;
  }

  /** Poll a job until terminal or timeout. */
  async waitForJob(jobId: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<Job> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.getJob(jobId);
      if (job.status === "succeeded" || job.status === "failed") return job;
      if (Date.now() > deadline) {
        return { ...job, status: "failed", error: "client_timeout" };
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/**
 * Provider-neutral server-side generator interface. The mock server provides
 * a deterministic local implementation; a Gemini adapter realises this only
 * when configured by environment variables. No image is ever fabricated as a
 * real provider response — the mock generator flags its output explicitly.
 */
export interface ImageGenerator {
  readonly id: string;
  generate(req: GenerateRequest): Promise<{ png: Uint8Array; note: string }>;
}

export interface PromptDirector {
  /** Refine / translate a user prompt into the provider's prompt format. */
  refine(prompt: string, monitor: MonitorSpec, region: Region): string;
}
