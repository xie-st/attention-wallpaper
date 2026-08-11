import type { MonitorInfo, Settings } from "../lib/tauri";
import type { SourceArticle } from "@content-model";

interface Props {
  monitors: MonitorInfo[];
  content: SourceArticle[];
  settings: Settings;
  onToast: (msg: string, good?: boolean) => void;
  onRefresh: () => void;
}

export function WallpaperSection(_: Props) {
  return (
    <section className="wallpaper-section">
      <h2>壁纸</h2>
      <p style={{ color: "var(--text-faint)" }}>
        壁纸合成 UI 已在 ADR-0019 pivot 后弃用；overlay window 的渲染逻辑将在 slice #9 实现。
      </p>
    </section>
  );
}
