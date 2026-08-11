import type { SourceArticle } from "@content-model";
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

export interface Rect { x: number; y: number; w: number; h: number; }

export interface MonitorInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

export interface IconRectsResult {
  rects: Rect[];
  source: "uiautomation" | "fallback";
  diagnostic: string;
}

export interface Settings {
  backgroundColor: string;
  petPackageId: string | null;
  petRate: number;
  petPaused: boolean;
}

export interface RotationState {
  lastRotatedAt: string | null;
  pausedUntil: string | null;
  nextAt: string | null;
  pendingSince: string | null;
}

export interface ApplyResult {
  ok: boolean;
  appliedPath: string | null;
  error?: string;
}

export interface ModelStatus {
  subject: { available: boolean; source: "heuristic" | "onnx"; reason?: string };
  face: { available: boolean; reason?: string };
  text: { available: boolean; reason?: string };
  onnxActive: boolean;
}

export interface WallpaperProfile {
  monitorId: string;
  originalPath: string | null;
  originalPosition: string | null;
  lastCompositedPath: string | null;
  savedAt: string;
}

export interface CreateArticleInput {
  id: string;
  title: string;
  plainText: string;
  paragraphs: string[];
  importedAt: number;
}

export interface DeleteArticleResult {
  removed: boolean;
}

export const IN_TAURI = isTauri();

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

// ---------- Browser-dev fallback (exercises the same local packages) ----------

const LS = {
  articles: "aw.articles",
  settings: "aw.settings",
  rotation: "aw.rotation",
  profiles: "aw.profiles"
};

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet<T>(key: string, val: T): void {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

const DEFAULT_SETTINGS: Settings = {
  backgroundColor: "#FAFBFC",
  petPackageId: null,
  petRate: 50,
  petPaused: false,
};

const DEFAULT_ROTATION: RotationState = {
  lastRotatedAt: null,
  pausedUntil: null,
  nextAt: null,
  pendingSince: null
};

/** Dev-mode monitor is a single 1920x1080 primary. */
const DEV_MONITORS: MonitorInfo[] = [
  { id: "dev-1", name: "Dev Display", width: 1920, height: 1080, isPrimary: true }
];

export const bridge = {
  async listMonitors(): Promise<MonitorInfo[]> {
    if (IN_TAURI) return invoke<MonitorInfo[]>("list_monitors");
    return DEV_MONITORS;
  },

  async getDesktopIconRects(_monitorId: string): Promise<IconRectsResult> {
    if (IN_TAURI) {
      return invoke<IconRectsResult>("get_desktop_icon_rects", { monitorId: _monitorId });
    }
    return {
      rects: [],
      source: "fallback",
      diagnostic: "browser-dev: desktop icon enumeration requires Windows UI Automation; using edge-safe conservative fallback."
    };
  },

  async applyWallpaper(monitorId: string, png: Uint8Array): Promise<ApplyResult> {
    if (IN_TAURI) {
      return invoke<ApplyResult>("apply_wallpaper", {
        monitorId,
        png: Array.from(png)
      });
    }
    return {
      ok: false,
      appliedPath: null,
      error: "browser-dev: wallpaper can only be applied by the Windows host (IDesktopWallpaper). Preview is available."
    };
  },

  async restoreWallpaper(monitorId?: string): Promise<ApplyResult> {
    if (IN_TAURI) {
      return invoke<ApplyResult>("restore_wallpaper", { monitorId: monitorId ?? null });
    }
    return { ok: false, appliedPath: null, error: "browser-dev: restore requires the Windows host." };
  },

  async listSourceArticles(): Promise<SourceArticle[]> {
    if (IN_TAURI) return invoke<SourceArticle[]>("list_source_articles");
    return lsGet<SourceArticle[]>(LS.articles, []);
  },

  async createArticle(input: CreateArticleInput): Promise<void> {
    if (IN_TAURI) return invoke<void>("create_source_article", { input });
    const items = lsGet<SourceArticle[]>(LS.articles, []);
    items.push(input);
    lsSet(LS.articles, items);
  },

  async deleteArticle(id: string): Promise<DeleteArticleResult> {
    if (IN_TAURI) return invoke<DeleteArticleResult>("delete_source_article", { id });
    const items = lsGet<SourceArticle[]>(LS.articles, []).filter((i) => i.id !== id);
    lsSet(LS.articles, items);
    return { removed: true };
  },

  async getSettings(): Promise<Settings> {
    if (IN_TAURI) return invoke<Settings>("get_settings");
    return lsGet<Settings>(LS.settings, DEFAULT_SETTINGS);
  },

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    if (IN_TAURI) return invoke<Settings>("set_settings", { patch });
    const next = { ...lsGet<Settings>(LS.settings, DEFAULT_SETTINGS), ...patch };
    lsSet(LS.settings, next);
    return next;
  },

  async getRotationState(): Promise<RotationState> {
    if (IN_TAURI) return invoke<RotationState>("get_rotation_state");
    return lsGet<RotationState>(LS.rotation, DEFAULT_ROTATION);
  },

  async setRotationState(patch: Partial<RotationState>): Promise<RotationState> {
    if (IN_TAURI) return invoke<RotationState>("set_rotation_state", { patch });
    const next = { ...lsGet<RotationState>(LS.rotation, DEFAULT_ROTATION), ...patch };
    lsSet(LS.rotation, next);
    return next;
  },

  async nextSet(): Promise<RotationState> {
    if (IN_TAURI) return invoke<RotationState>("next_set");
    const now = new Date().toISOString();
    return this.setRotationState({ lastRotatedAt: now });
  },

  async pauseOneHour(): Promise<RotationState> {
    if (IN_TAURI) return invoke<RotationState>("pause_one_hour");
    const pausedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return this.setRotationState({ pausedUntil });
  },

  async getModelsStatus(): Promise<ModelStatus> {
    if (IN_TAURI) return invoke<ModelStatus>("get_models_status");
    return {
      subject: { available: false, source: "heuristic", reason: "no_manifest" },
      face: { available: false, reason: "no_manifest" },
      text: { available: false, reason: "no_manifest" },
      onnxActive: false
    };
  },

  async getWallpaperProfile(monitorId: string): Promise<WallpaperProfile | null> {
    if (IN_TAURI) return invoke<WallpaperProfile | null>("get_wallpaper_profile", { monitorId });
    const profiles = lsGet<Record<string, WallpaperProfile>>(LS.profiles, {});
    return profiles[monitorId] ?? null;
  },

  async setWallpaperProfile(profile: WallpaperProfile): Promise<void> {
    if (IN_TAURI) {
      await invoke<void>("set_wallpaper_profile", { profile });
      return;
    }
    const profiles = lsGet<Record<string, WallpaperProfile>>(LS.profiles, {});
    profiles[profile.monitorId] = profile;
    lsSet(LS.profiles, profiles);
  }
};
