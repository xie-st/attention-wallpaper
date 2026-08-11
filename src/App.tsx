import { useState, useEffect, useCallback } from "react";
import { bridge, IN_TAURI, type MonitorInfo, type Settings, type RotationState, type ModelStatus } from "./lib/tauri";
import { ContentSection } from "./sections/ContentSection";
import { WallpaperSection } from "./sections/WallpaperSection";
import { DisplaySection } from "./sections/DisplaySection";
import { AiSection } from "./sections/AiSection";
import { PrivacySection } from "./sections/PrivacySection";

type SectionId = "content" | "wallpaper" | "display" | "ai" | "privacy";

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "content", label: "内容", icon: "✎" },
  { id: "wallpaper", label: "壁纸", icon: "▣" },
  { id: "display", label: "显示器", icon: "▤" },
  { id: "ai", label: "AI 生成", icon: "✦" },
  { id: "privacy", label: "隐私", icon: "🔒" }
];

export function App() {
  const [section, setSection] = useState<SectionId>("content");
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [content, setContent] = useState<import("@content-model").ContentItem[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rotation, setRotation] = useState<RotationState | null>(null);
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [toast, setToast] = useState<{ msg: string; good: boolean } | null>(null);

  const showToast = useCallback((msg: string, good = true) => {
    setToast({ msg, good });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    const [mons, cont, sett, rot, mds] = await Promise.all([
      bridge.listMonitors(),
      bridge.listContent(),
      bridge.getSettings(),
      bridge.getRotationState(),
      bridge.getModelsStatus()
    ]);
    setMonitors(mons);
    setContent(cont);
    setSettings(sett);
    setRotation(rot);
    setModels(mds);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!IN_TAURI) return;
    let cleanups: (() => void)[] = [];
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const events: [string, () => void][] = [
        ["tray://next-set", () => { bridge.nextSet().then(refresh); showToast("已切换到下一组"); }],
        ["tray://pause-one-hour", () => { bridge.pauseOneHour().then(refresh); showToast("已暂停一小时"); }],
        ["tray://restore", () => { bridge.restoreWallpaper(); showToast("正在恢复原壁纸"); }],
        ["tray://relayout", () => setSection("wallpaper")],
        ["nav://settings", () => setSection("privacy")]
      ];
      for (const [evt, fn] of events) {
        const u = await listen(evt, fn);
        cleanups.push(u);
      }
    })();
    return () => cleanups.forEach((f) => f());
  }, [refresh, showToast]);

  if (!settings) return null;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          注意力壁纸
          <small>{IN_TAURI ? "桌面版" : "浏览器预览"}</small>
        </div>
        {SECTIONS.map((s) => (
          <div key={s.id} className={`nav-item ${section === s.id ? "active" : ""}`} onClick={() => setSection(s.id)}>
            <span className="dot" />
            <span style={{ width: 20, textAlign: "center" }}>{s.icon}</span>
            {s.label}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        {models && (
          <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-faint)" }}>
            <span className={`pill ${models.onnxActive ? "good" : "warn"}`}>
              {models.onnxActive ? "ONNX" : "启发式"}
            </span>
            <div style={{ marginTop: 4 }}>{monitors.length} 台显示器</div>
          </div>
        )}
      </nav>

      <main className="main">
        {section === "content" && (
          <ContentSection settings={settings} onRefresh={refresh} onToast={showToast} />
        )}
        {section === "wallpaper" && (
          <WallpaperSection monitors={monitors} content={content} settings={settings} onToast={showToast} onRefresh={refresh} />
        )}
        {section === "display" && (
          <DisplaySection monitors={monitors} models={models} rotation={rotation} onToast={showToast} />
        )}
        {section === "ai" && (
          <AiSection monitors={monitors} settings={settings} onToast={showToast} />
        )}
        {section === "privacy" && (
          <PrivacySection settings={settings} models={models} onSettingsChange={refresh} />
        )}
      </main>

      {toast && <div className={`toast ${toast.good ? "good" : "bad"}`}>{toast.msg}</div>}
    </div>
  );
}
