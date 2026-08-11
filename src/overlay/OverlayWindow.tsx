import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { bridge, type MonitorInfo, type Rect, type Settings } from "@/lib/tauri";
import type { SourceArticle } from "@content-model";
import { computeTextRegions, type TextRegion, type GridRect, type ScreenSpec, DEFAULT_CONFIG } from "@layout-region";
import { pretextArticleLayout, ARTICLE_FONT_FAMILY, type LaidOutArticle, type RectLike } from "@pretext-layout";
import { step, DEFAULT_CONFIG as PET_DEFAULT_CONFIG, type PetState, type PetEvent } from "./pet-behavior";
import { stepVisibility } from "./visibility";

// =============================================================================
// Constants — MVP smoke-test tuning. Aesthetic directive in AGENTS.md is
// non-negotiable (#FAFBFC bg, Noto Serif SC text, no shadows). Pet sprite is
// a placeholder colored rect for slice #9 (issue acceptance: "bundle a small
// placeholder spritesheet; community pet drop-in is a stretch goal").
// =============================================================================

const PET_W = 64;
const PET_H = 72;
const PET_COLOR_BY_STATE: Record<PetState, string> = {
  idle: "#6B8F71",
  "drift-right": "#7AA6C2",
  "drift-left": "#7AA6C2",
  celebrate: "#D4A84B",
  hop: "#9CA8B3",
  "end-of-article": "#B87A7A",
  pause: "#9CA8B3",
  "walk-down": "#6B8F71",
  "walk-up": "#7AA6C2",
};
const TEXT_COLOR = "#2E3440";
const PLACEHOLDER_TEXT =
  "桌面空空如也。打开编辑器导入一篇文章试试。\n\n" +
  "在托盘菜单点「打开编辑器」 → 内容 → 导入 .docx/.txt/.md。";

const ICON_CELL_W = 80;
const ICON_CELL_H = 80;

// =============================================================================
// OverlayWindow — renders the article text + pet on a transparent topmost
// canvas. Visibility is driven by the foreground-window signal from the Rust
// WinEventHook (ADR-0025). Per-frame: visibility tween → PetBehavior step →
// pet rect publish (for WM_NCHITTEST) → Canvas repaint.
// =============================================================================

export function OverlayWindow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  // ----- Refs hold the live render-loop state (refs so RAF closure stays stable).
  const stateRef = useRef({
    articles: [] as SourceArticle[],
    articleIndex: 0,
    articleLayout: null as LaidOutArticle | null,
    settings: { backgroundColor: "#FAFBFC", petPackageId: null, petRate: 50, petPaused: false } as Settings,
    iconRects: [] as Rect[],
    textRegions: [] as TextRegion[],
    // PetBehavior state:
    petState: "walk-down" as PetState,
    petX: 0,
    petY: 0,
    articleProgress: 0,
    savedWalkingState: undefined as PetState | undefined,
    celebratedMs: undefined as number | undefined,
    events: [] as PetEvent[],
    // Visibility state:
    foregroundIsDesktop: true,
    alpha: 0,
    lastAlphaByte: 0,
    // Timing:
    lastFrameTs: 0,
    lastIconRectsFetch: 0,
    // Pet rect (screen coords) for WM_NCHITTEST publish:
    petRectScreen: { left: 0, top: 0, w: 0, h: 0 },
    // RNG:
    rng: Math.random,
  });

  // ----- On mount: install Rust hooks, listen to visibility event, load initial data.
  useEffect(() => {
    let unlistenVisibility: UnlistenFn | null = null;
    let disposed = false;

    (async () => {
      // Listen for foreground-window transitions from Rust.
      unlistenVisibility = await listen<{ visible: boolean }>(
        "overlay://visibility",
        (e) => {
          stateRef.current.foregroundIsDesktop = e.payload.visible;
        },
      );
      if (disposed) return;

      // Load initial data in parallel.
      const [articles, settings, iconResult, monitors] = await Promise.all([
        bridge.listSourceArticles(),
        bridge.getSettings(),
        bridge.getDesktopIconRects("primary"),
        bridge.listMonitors(),
      ]);
      if (disposed) return;

      const primary = monitors.find((m: MonitorInfo) => m.isPrimary) ?? monitors[0];
      const screenW = primary?.width ?? window.screen.width;
      const screenH = primary?.height ?? window.screen.height;

      const s = stateRef.current;
      s.articles = articles.length > 0 ? articles : [makePlaceholderArticle()];
      s.settings = settings;
      s.iconRects = iconResult.rects;
      s.textRegions = computeTextRegionsFor(screenW, screenH, iconResult.rects);
      s.articleLayout = layoutCurrentArticle(s);

      // Place pet at top-center of the work area.
      s.petX = screenW / 2 - PET_W / 2;
      s.petY = 40;

      // Apply Rust hooks (z-order styles + WinEventHook + WM_NCHITTEST subclass).
      try {
        await invoke("install_overlay_hooks");
      } catch (e) {
        console.error("[overlay] install_overlay_hooks failed:", e);
      }

      setReady(true);
      requestAnimationFrame(frameLoop);
    });

    return () => {
      disposed = true;
      unlistenVisibility?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameLoop = (ts: number) => {
    requestAnimationFrame(frameLoop);
    onFrame(ts);
  };

  // Per-frame tick. Lives outside useEffect to keep ref stable.
  function onFrame(ts: number) {
    const s = stateRef.current;
    if (s.lastFrameTs === 0) s.lastFrameTs = ts;
    const dt = Math.min(64, ts - s.lastFrameTs); // clamp huge gaps (tab switch)
    s.lastFrameTs = ts;

    // --- Visibility tween (ADR-0025).
    const vis = stepVisibility({
      foregroundIsDesktop: s.foregroundIsDesktop,
      currentAlpha: s.alpha,
      dt,
    });
    s.alpha = vis.nextAlpha;
    const alphaByte = Math.round(s.alpha * 255);
    if (alphaByte !== s.lastAlphaByte) {
      s.lastAlphaByte = alphaByte;
      invoke("set_overlay_alpha", { alpha: alphaByte }).catch(() => {});
    }

    // --- PetBehavior step (only when overlay visible — pause while hidden).
    if (vis.shouldStepPet && !s.settings.petPaused) {
      const petInput = {
        currentState: s.petState,
        dt,
        rng: s.rng,
        events: s.events,
        articleProgress: s.articleProgress,
        savedWalkingState: s.savedWalkingState,
        celebratedMs: s.celebratedMs,
      };
      const petCfg = { ...PET_DEFAULT_CONFIG, petRate: s.settings.petRate };
      const out = step(petInput, petCfg);
      s.petState = out.nextState;
      s.petX += out.positionDelta.dx;
      s.petY += out.positionDelta.dy;
      if (out.savedWalkingState !== undefined) s.savedWalkingState = out.savedWalkingState;
      if (out.celebratedMs !== undefined) s.celebratedMs = out.celebratedMs;

      // Article-switch signal: reset progress + advance to next article.
      if (out.articleSwitch) {
        s.celebratedMs = undefined;
        s.articleProgress = 0;
        s.articleIndex = (s.articleIndex + 1) % s.articles.length;
        s.articleLayout = layoutCurrentArticle(s);
      }

      // Update article progress from pet Y.
      const totalHeight = s.articleLayout?.totalHeight ?? 1;
      const viewportH = window.innerHeight;
      const scrollable = Math.max(0, totalHeight - viewportH);
      if (scrollable > 0) {
        s.articleProgress = Math.max(0, Math.min(1, s.petY / scrollable));
      } else {
        s.articleProgress = 0;
      }

      // Re-layout if pet is in walk-down to keep visibleStartY synced.
      if (s.petState === "walk-down" || s.petState === "walk-up" || s.petState === "end-of-article") {
        s.articleLayout = layoutCurrentArticle(s);
      }

      // Clamp pet Y within reasonable range (top margin to ~80% screen).
      s.petY = Math.max(20, Math.min(window.innerHeight * 0.8, s.petY));
    }
    s.events = []; // consumed

    // --- Publish pet rect (screen coords) to Rust for WM_NCHITTEST.
    const petRectScreen = { left: s.petX, top: s.petY, w: PET_W, h: PET_H };
    s.petRectScreen = petRectScreen;
    invoke("update_pet_rect", petRectScreen).catch(() => {});

    // --- Periodically refresh icon rects (every ~5s; ADR-0022 says recompute on movement).
    if (ts - s.lastIconRectsFetch > 5000) {
      s.lastIconRectsFetch = ts;
      bridge.getDesktopIconRects("primary").then((r: { rects: Rect[] }) => {
        s.iconRects = r.rects;
        // Re-compute regions in next frame (the next onFrame will pick them up
        // via layoutCurrentArticle reading s.textRegions — but we need to update
        // s.textRegions here too).
        bridgesRefreshRegions(s);
      }).catch(() => {});
    }

    draw();
  }

  // ----- Canvas paint. Solid bg (debug) + text columns + pet placeholder.
  function draw() {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Apply overlay alpha (fade tween).
    ctx.globalAlpha = s.alpha;

    // Debug: solid bg in settings.backgroundColor so devs can see the overlay bounds.
    // Comment out if it interferes with transparency. Low-saturation, per AGENTS.md.
    ctx.fillStyle = s.settings.backgroundColor + "20"; // 12% opacity
    ctx.fillRect(0, 0, W, H);

    // Text columns.
    if (s.articleLayout && s.articleLayout.columns.length > 0) {
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = `500 24px "${ARTICLE_FONT_FAMILY}", serif`;
      ctx.textBaseline = "top";
      for (const col of s.articleLayout.columns) {
        const fontSize = col.fontSize;
        const lineHeight = Math.round(fontSize * 1.4);
        ctx.font = `500 ${fontSize}px "${ARTICLE_FONT_FAMILY}", serif`;
        const startY = col.region.y * ICON_CELL_H;
        // We render only lines visible in the viewport [visibleStartY, visibleEndY].
        for (let i = 0; i < col.lines.length; i++) {
          const line = col.lines[i];
          const lineY = startY + i * lineHeight;
          if (lineY + lineHeight < 0 || lineY > H) continue;
          ctx.fillText(line.text, col.region.x * ICON_CELL_W, lineY);
        }
      }
    } else {
      // No article / no regions: render placeholder text top-left.
      ctx.fillStyle = TEXT_COLOR + "80";
      ctx.font = `500 18px "Noto Sans SC", sans-serif`;
      const lines = PLACEHOLDER_TEXT.split("\n");
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], 24, 24 + i * 26);
      }
    }

    // Pet placeholder (colored rect by state — verifies PetBehavior state visually).
    ctx.fillStyle = PET_COLOR_BY_STATE[s.petState];
    ctx.fillRect(s.petX, s.petY, PET_W, PET_H);
    // Outline so it's visible on any bg.
    ctx.strokeStyle = "#2E3440";
    ctx.lineWidth = 1;
    ctx.strokeRect(s.petX + 0.5, s.petY + 0.5, PET_W - 1, PET_H - 1);
    // State label.
    ctx.fillStyle = "#FAFBFC";
    ctx.font = `500 10px "Noto Sans SC", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(s.petState, s.petX + 4, s.petY + PET_H / 2);
    ctx.textBaseline = "top";

    ctx.globalAlpha = 1;
  }

  // ----- Double-click enqueues a PetBehavior event.
  function onDoubleClick(e: React.MouseEvent) {
    // Only count if click is on the pet rect (Rust already gates via WM_NCHITTEST,
    // but the Canvas-level check is a safety net for browser-dev mode).
    const s = stateRef.current;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= s.petX && x < s.petX + PET_W && y >= s.petY && y < s.petY + PET_H) {
      s.events = [...s.events, "double-click"];
    }
  }

  // Resize canvas to window on mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onDoubleClick={onDoubleClick}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        display: "block",
        cursor: "default",
      }}
      data-ready={ready}
    />
  );
}

// =============================================================================
// Helpers
// =============================================================================

/** Refresh text regions from icon rects in-place on the state object. */
function bridgesRefreshRegions(s: {
  iconRects: Rect[];
  textRegions: TextRegion[];
}) {
  s.textRegions = computeTextRegionsFor(window.innerWidth, window.innerHeight, s.iconRects);
}

function makePlaceholderArticle(): SourceArticle {
  return {
    id: "placeholder",
    title: "（演示文本）",
    plainText: PLACEHOLDER_TEXT,
    paragraphs: PLACEHOLDER_TEXT.split("\n\n"),
    importedAt: Date.now(),
  };
}

/** Convert pixel-rect icons to grid-cell rects and call computeTextRegions. */
function computeTextRegionsFor(screenW: number, screenH: number, iconRects: Rect[]): TextRegion[] {
  const colsM = Math.max(1, Math.floor(screenW / ICON_CELL_W));
  const rowsN = Math.max(1, Math.floor(screenH / ICON_CELL_H));
  const screen: ScreenSpec = { colsM, rowsN };
  const icons: GridRect[] = iconRects.map((r) => ({
    gx: Math.floor(r.x / ICON_CELL_W),
    gy: Math.floor(r.y / ICON_CELL_H),
    gw: Math.max(1, Math.ceil(r.w / ICON_CELL_W)),
    gh: Math.max(1, Math.ceil(r.h / ICON_CELL_H)),
  }));
  return computeTextRegions(screen, icons, DEFAULT_CONFIG);
}

/** Re-layout the current article using the shared text regions + pet progress. */
function layoutCurrentArticle(s: {
  articles: SourceArticle[];
  articleIndex: number;
  textRegions: TextRegion[];
  articleProgress: number;
}): LaidOutArticle | null {
  const article = s.articles[s.articleIndex];
  if (!article || s.textRegions.length === 0) return null;

  // TextRegion grid coords → pixel rects for pretextArticleLayout.
  const regions = s.textRegions.map((r) => ({
    x: r.x * ICON_CELL_W,
    y: r.y * ICON_CELL_H,
    w: r.w * ICON_CELL_W,
    h: r.h * ICON_CELL_H,
    columnRatio: r.columnRatio,
    strayCells: r.strayCells,
  })) as unknown as Parameters<typeof pretextArticleLayout>[1];

  const viewport: RectLike = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  return pretextArticleLayout(article, regions, { family: ARTICLE_FONT_FAMILY, size: 24, weight: 500 }, {
    visibleViewport: viewport,
    petScrollProgress: s.articleProgress,
  });
}
