import type { Settings } from "../lib/tauri";

interface Props {
  settings: Settings;
  onRefresh: () => void;
  onToast: (msg: string, good?: boolean) => void;
}

export function ContentSection(_: Props) {
  return (
    <section className="content-section">
      <h2>内容</h2>
      <p style={{ color: "var(--text-faint)" }}>
        文章管理 UI 将在 slice #10 重写（ADR-0019）。
      </p>
    </section>
  );
}
