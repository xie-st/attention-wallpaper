import { useState, useRef, useCallback } from "react";
import { bridge, IN_TAURI, type MonitorInfo, type Settings } from "../lib/tauri";
import { decodeImage, composite, type CompositeOutput } from "../lib/compositor";
import type { ContentItem } from "@content-model";

interface Props {
  monitors: MonitorInfo[];
  content: ContentItem[];
  settings: Settings;
  onToast: (msg: string, good?: boolean) => void;
  onRefresh: () => void;
}

export function WallpaperSection({ monitors, content, settings, onToast, onRefresh }: Props) {
  const [selectedMonitor, setSelectedMonitor] = useState(0);
  const [wallpaperBytes, setWallpaperBytes] = useState<Uint8Array | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compositeResult, setCompositeResult] = useState<CompositeOutput | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const monitor = monitors[selectedMonitor] ?? monitors[0];

  const onImport = useCallback(async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setWallpaperBytes(bytes);
    const blob = new Blob([bytes], { type: file.type });
    setPreviewUrl(URL.createObjectURL(blob));
    setCompositeResult(null);
    setDiagnostics([]);
  }, []);

  const onAnalyze = useCallback(async () => {
    if (!wallpaperBytes || !monitor) return;
    setAnalyzing(true);
    try {
      const decoded = await decodeImage(wallpaperBytes);
      const iconResult = await bridge.getDesktopIconRects(monitor.id);
      const hard = {
        icons: iconResult.rects,
        taskbar: null as import("@attention").Rect | null,
        faces: [],
        texts: []
      };
      const result = await composite({
        wallpaper: decoded.imageData,
        monitor,
        hard,
        content: content.filter((c) => c.enabled),
        settings,
        previewMaxWidth: 800
      });
      setCompositeResult(result);
      setDiagnostics([
        iconResult.diagnostic,
        ...result.diagnostics.map((d) => d.message),
        ...result.layout.diagnostics.map((d) => d.message)
      ]);
      onToast("分析完成", true);
    } catch (e) {
      onToast(`分析失败: ${e}`, false);
    } finally {
      setAnalyzing(false);
    }
  }, [wallpaperBytes, monitor, content, settings, onToast]);

  const onApply = useCallback(async () => {
    if (!compositeResult || !monitor) return;
    const result = await bridge.applyWallpaper(monitor.id, compositeResult.png);
    if (result.ok) {
      onToast("壁纸已应用", true);
      onRefresh();
    } else {
      onToast(`应用失败: ${result.error ?? "未知错误"}`, false);
    }
  }, [compositeResult, monitor, onToast, onRefresh]);

  const onRestore = useCallback(async () => {
    const result = await bridge.restoreWallpaper(monitor.id);
    if (result.ok) {
      onToast("已恢复原壁纸", true);
      onRefresh();
    } else {
      onToast(`恢复失败: ${result.error ?? "未知错误"}`, false);
    }
  }, [monitor, onToast, onRefresh]);

  if (!monitor) {
    return <div className="card"><div className="empty">未检测到显示器</div></div>;
  }

  return (
    <div>
      <div className="section-head">
        <h1>壁纸</h1>
        <p>导入壁纸 → 分析注意力 → 预览合成 → 应用到桌面。所有分析在本地完成，不会上传。</p>
      </div>

      <div className="card">
        <div className="row between">
          <h2>选择显示器</h2>
          <div className="row">
            {monitors.map((m, i) => (
              <button
                key={m.id}
                className={i === selectedMonitor ? "primary" : ""}
                onClick={() => setSelectedMonitor(i)}
              >
                {m.name} ({m.width}×{m.height}){m.isPrimary ? " ★" : ""}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>导入壁纸</h2>
        <div className="row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/bmp"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); }}
          />
          <button className="primary" onClick={() => fileInputRef.current?.click()}>选择图片</button>
          {wallpaperBytes && (
            <span className="pill good">已导入 {(wallpaperBytes.length / 1024).toFixed(0)} KB</span>
          )}
        </div>
      </div>

      {previewUrl && (
        <div className="card">
          <h2>预览与合成</h2>
          <div className="row">
            <button className="primary" onClick={onAnalyze} disabled={analyzing}>
              {analyzing ? "分析中..." : "分析并合成"}
            </button>
            {compositeResult && (
              <>
                <button className="primary" onClick={onApply} disabled={!IN_TAURI}>
                  应用到桌面
                </button>
                <button onClick={onRestore}>恢复原壁纸</button>
              </>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            {compositeResult ? (
              <WallpaperPreview result={compositeResult} monitor={monitor} />
            ) : (
              <div className="preview-wrap" style={{ maxWidth: 720 }}>
                <img src={previewUrl} alt="wallpaper" style={{ width: "100%", display: "block" }} />
              </div>
            )}
          </div>

          {diagnostics.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-dim)" }}>
              <div style={{ marginBottom: 6, color: "var(--text)" }}>诊断信息：</div>
              {diagnostics.map((d, i) => (
                <div key={i} style={{ marginBottom: 3 }}>· {d}</div>
              ))}
            </div>
          )}

          {compositeResult && (
            <div className="legend" style={{ marginTop: 10 }}>
              <span>
                <span className="swatch" style={{ background: "#4f8cff" }} />
                文本位置
              </span>
              <span>
                <span className={`pill ${compositeResult.layout.usedFallback ? "warn" : "good"}`}>
                  {compositeResult.layout.usedFallback ? "使用了降级布局" : "正常布局"}
                </span>
              </span>
              <span>
                <span className={`pill ${compositeResult.map.onnxActive ? "good" : "warn"}`}>
                  {compositeResult.map.onnxActive ? "ONNX" : "启发式"}
                </span>
              </span>
              <span>
                已放置 {compositeResult.placed.length} 条内容
              </span>
            </div>
          )}
        </div>
      )}

      {!IN_TAURI && (
        <div className="card">
          <div className="muted">
            浏览器预览模式：壁纸应用功能需要桌面版。请在 Tauri 环境中运行 <code>pnpm tauri:dev</code>。
          </div>
        </div>
      )}
    </div>
  );
}

function WallpaperPreview({ result, monitor }: { result: CompositeOutput; monitor: MonitorInfo }) {
  const ab = new ArrayBuffer(result.previewPng.byteLength);
  new Uint8Array(ab).set(result.previewPng);
  const blob = new Blob([ab], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const scale = monitor ? 720 / monitor.width : 1;
  return (
    <div className="preview-wrap" style={{ maxWidth: 720, position: "relative" }}>
      <img src={url} alt="composite" style={{ width: "100%", display: "block" }} />
      {result.layout.placements.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.rect.x * scale,
            top: p.rect.y * scale,
            width: p.rect.w * scale,
            height: p.rect.h * scale,
            border: `2px solid ${p.fallback === "none" ? "#4f8cff" : "#d29922"}`,
            borderRadius: 4,
            pointerEvents: "none",
            boxSizing: "border-box"
          }}
        />
      ))}
    </div>
  );
}
