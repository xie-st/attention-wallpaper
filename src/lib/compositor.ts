import type { MonitorInfo, Rect, Settings } from "./tauri";

export interface DecodedImage {
  imageData: unknown;
  width: number;
  height: number;
  bitmap: ImageBitmap | null;
}

export interface CompositeOutput {
  png: Uint8Array;
  placedBounds: Rect;
  monitor: MonitorInfo;
}

export async function decodeImage(_bytes: Uint8Array): Promise<DecodedImage> {
  throw new Error("compositor voided per ADR-0019; overlay window (slice #9) replaces this");
}

export async function composite(
  _image: DecodedImage | null,
  _monitor: MonitorInfo,
  _settings: Settings,
  _content: unknown[],
): Promise<CompositeOutput> {
  throw new Error("compositor voided per ADR-0019; overlay window (slice #9) replaces this");
}
