import { useEffect, useState } from "react";
import { bridge, type MonitorInfo, type ModelStatus, type RotationState } from "../lib/tauri";

interface Props {
  monitors: MonitorInfo[];
  models: ModelStatus | null;
  rotation: RotationState | null;
  onToast: (msg: string, good?: boolean) => void;
}

export function DisplaySection({ monitors, models, rotation }: Props) {
  const [iconSources, setIconSources] = useState<Record<string, string>>({});

  useEffect(() => {
    monitors.forEach(async (m) => {
      const result = await bridge.getDesktopIconRects(m.id);
      setIconSources((prev) => ({ ...prev, [m.id]: result.diagnostic }));
    });
  }, [monitors]);

  const isPaused = rotation?.pausedUntil && new Date(rotation.pausedUntil) > new Date();

  return (
    <div>
      <div className="section-head">
        <h1>显示器</h1>
        <p>每台显示器的布局状态、模型可用性和诊断信息。</p>
      </div>

      <div className="card">
        <h2>轮换状态</h2>
        <div className="kv">
          <span className="k">上次轮换</span>
          <span>{rotation?.lastRotatedAt ? new Date(rotation.lastRotatedAt).toLocaleString("zh-CN") : "从未"}</span>
          <span className="k">下次轮换</span>
          <span>{rotation?.nextAt ? new Date(rotation.nextAt).toLocaleString("zh-CN") : "—"}</span>
          <span className="k">暂停状态</span>
          <span>
            {isPaused ? (
              <span className="pill warn">已暂停至 {new Date(rotation!.pausedUntil!).toLocaleTimeString("zh-CN")}</span>
            ) : (
              <span className="pill good">运行中</span>
            )}
          </span>
        </div>
      </div>

      {monitors.map((m) => (
        <div className="card" key={m.id}>
          <div className="row between">
            <h2>{m.name}</h2>
            {m.isPrimary && <span className="pill good">主显示器</span>}
          </div>
          <div className="kv">
            <span className="k">分辨率</span>
            <span>{m.width} × {m.height}</span>
            <span className="k">桌面图标</span>
            <span style={{ fontSize: 12 }}>{iconSources[m.id] ?? "查询中..."}</span>
          </div>
        </div>
      ))}

      {models && (
        <div className="card">
          <h2>模型状态</h2>
          <div className="kv">
            <span className="k">主体显著性</span>
            <span>
              <span className={`pill ${models.subject.available ? "good" : "warn"}`}>
                {models.subject.available ? `ONNX (${models.subject.source})` : `启发式 (${models.subject.reason ?? "—"})`}
              </span>
            </span>
            <span className="k">人脸检测</span>
            <span>
              <span className={`pill ${models.face.available ? "good" : "warn"}`}>
                {models.face.available ? "可用" : `不可用 (${models.face.reason ?? "—"})`}
              </span>
            </span>
            <span className="k">文字检测</span>
            <span>
              <span className={`pill ${models.text.available ? "good" : "warn"}`}>
                {models.text.available ? "可用" : `不可用 (${models.text.reason ?? "—"})`}
              </span>
            </span>
            <span className="k">ONNX 状态</span>
            <span>
              <span className={`pill ${models.onnxActive ? "good" : "warn"}`}>
                {models.onnxActive ? "已启用" : "未启用（使用本地启发式）"}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
