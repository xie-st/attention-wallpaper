import type { AdapterResult, AttentionAdapter, Diagnostic, ImageInput, Rect } from "./types";

/**
 * Manifest describing an installable ONNX model. The file format is plain JSON
 * stored next to the weights; checksums are sha256 of the raw weight file.
 */
export interface ModelManifest {
  id: "u2netp" | "facedetlite" | "ppocrv6tiny";
  kind: "subject_saliency" | "face_detection" | "text_detection";
  onnxPath: string;
  sha256: string;
  bytes: number;
  inputSize: [number, number];
  license: string;
  homepage: string;
}

export interface ModelRegistry {
  list(): ModelManifest[];
  /** Returns the raw bytes of the model file (Node fs) or null if unloadable. */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Verify sha256 of the bytes matches the manifest. */
  sha256(bytes: Uint8Array): string;
}

/** Validate structure + checksum of a manifest against the registry. */
export async function validateManifest(
  manifest: ModelManifest,
  registry: ModelRegistry
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const bytes = await registry.readBytes(manifest.onnxPath);
  if (!bytes) return { ok: false, reason: "weight_file_not_found" };
  if (bytes.length !== manifest.bytes) {
    return { ok: false, reason: `size_mismatch:expected=${manifest.bytes},actual=${bytes.length}` };
  }
  const digest = registry.sha256(bytes);
  if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
    return { ok: false, reason: `checksum_mismatch:expected=${manifest.sha256},actual=${digest}` };
  }
  return { ok: true };
}

/**
 * Abstract subject-saliency adapter. The baseline returns unavailable so the
 * pipeline falls back to the sharpened spectral heuristic and reports lower
 * confidence. Real ONNX inference is wired only when a validated manifest and
 * a working native bridge are present; we never fake detections.
 */
export class U2NetpSubjectAdapter implements AttentionAdapter {
  readonly name = "subject_saliency";
  private active = false;
  private reason = "no_valid_manifest";

  constructor(
    private readonly native: U2NetpInference | null,
    private readonly manifest: ModelManifest | null,
    private readonly registry: ModelRegistry | null
  ) {}

  async tryActivate(): Promise<Diagnostic> {
    if (!this.native) {
      this.active = false;
      this.reason = "native_bridge_disabled";
      return { level: "warn", code: "u2netp.no_bridge", message: "U2-NetP native bridge disabled; using heuristic subject saliency." };
    }
    if (!this.manifest || !this.registry) {
      this.active = false;
      this.reason = "no_manifest";
      return { level: "warn", code: "u2netp.no_manifest", message: "U2-NetP manifest not installed; using heuristic subject saliency." };
    }
    const v = await validateManifest(this.manifest, this.registry);
    if (!v.ok) {
      this.active = false;
      this.reason = v.reason;
      return { level: "warn", code: "u2netp.invalid", message: `U2-NetP weight invalid: ${v.reason}` };
    }
    this.active = true;
    this.reason = "ready";
    return { level: "ok", code: "u2netp.ready", message: "U2-NetP ready." };
  }

  available(): boolean {
    return this.active;
  }

  run(input: ImageInput, gridW: number, gridH: number): AdapterResult {
    if (!this.active || !this.native) {
      return { kind: "unavailable", reason: this.reason };
    }
    const map = this.native.run(input, gridW, gridH, this.manifest as ModelManifest);
    return { kind: "ready", map, confidence: 0.9 };
  }
}

export interface U2NetpInference {
  run(input: ImageInput, gridW: number, gridH: number, manifest: ModelManifest): Float32Array;
}

/**
 * Face detector adapter. When unavailable, the pipeline simply cannot exclude
 * faces automatically; the hard-mask will be empty for faces and the layout
 * becomes more conservative (see scoring.ts).
 */
export class FaceDetLiteAdapter {
  readonly name = "face_detection";
  private active = false;
  private reason = "no_valid_manifest";

  constructor(
    private readonly native: FaceDetInference | null,
    private readonly manifest: ModelManifest | null,
    private readonly registry: ModelRegistry | null
  ) {}

  async tryActivate(): Promise<Diagnostic> {
    if (!this.native || !this.manifest || !this.registry) {
      this.active = false;
      this.reason = "no_manifest";
      return { level: "warn", code: "facedet.no_manifest", message: "FaceDetLite manifest not installed; faces will not be auto-excluded." };
    }
    const v = await validateManifest(this.manifest, this.registry);
    if (!v.ok) {
      this.active = false;
      this.reason = v.reason;
      return { level: "warn", code: "facedet.invalid", message: `FaceDetLite weight invalid: ${v.reason}` };
    }
    this.active = true;
    this.reason = "ready";
    return { level: "ok", code: "facedet.ready", message: "FaceDetLite ready." };
  }

  available(): boolean {
    return this.active;
  }

  detect(input: ImageInput): { boxes: Rect[] } {
    if (!this.active || !this.native) return { boxes: [] };
    return { boxes: this.native.detect(input) };
  }

  reasonUnavailable(): string {
    return this.reason;
  }
}

export interface FaceDetInference {
  detect(input: ImageInput): Rect[];
}

/** PP-OCRv6-tiny-style text DETECTION boxes only (no recognition). */
export class PpOcrTextAdapter {
  readonly name = "text_detection";
  private active = false;
  private reason = "no_valid_manifest";

  constructor(
    private readonly native: TextDetInference | null,
    private readonly manifest: ModelManifest | null,
    private readonly registry: ModelRegistry | null
  ) {}

  async tryActivate(): Promise<Diagnostic> {
    if (!this.native || !this.manifest || !this.registry) {
      this.active = false;
      this.reason = "no_manifest";
      return { level: "warn", code: "textdet.no_manifest", message: "PP-OCRv6-tiny manifest not installed; existing text will not be auto-excluded." };
    }
    const v = await validateManifest(this.manifest, this.registry);
    if (!v.ok) {
      this.active = false;
      this.reason = v.reason;
      return { level: "warn", code: "textdet.invalid", message: `PP-OCRv6-tiny weight invalid: ${v.reason}` };
    }
    this.active = true;
    this.reason = "ready";
    return { level: "ok", code: "textdet.ready", message: "PP-OCRv6-tiny ready." };
  }

  available(): boolean {
    return this.active;
  }

  detect(input: ImageInput): { boxes: Rect[] } {
    if (!this.active || !this.native) return { boxes: [] };
    return { boxes: this.native.detect(input) };
  }

  reasonUnavailable(): string {
    return this.reason;
  }
}

export interface TextDetInference {
  detect(input: ImageInput): Rect[];
}

/**
 * Node-side sha256 helper using the built-in crypto module. Guarded so the
 * package still imports in browsers (the function is only called via a
 * Node-backed registry).
 */
export function nodeSha256(bytes: Uint8Array): string {
  // Lazy require so this module is importable in non-node environments.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}
