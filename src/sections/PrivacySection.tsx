import { bridge, type Settings, type ModelStatus } from "../lib/tauri";

interface Props {
  settings: Settings;
  models: ModelStatus | null;
  onSettingsChange: () => void;
}

export function PrivacySection({ settings, models: _models, onSettingsChange }: Props) {
  const update = async (patch: Partial<Settings>) => {
    await bridge.setSettings(patch);
    onSettingsChange();
  };

  return (
    <div>
      <div className="section-head">
        <h1>隐私</h1>
        <p>所有注意力分析、布局计算和壁纸合成都在本地完成。以下透明地列出每一项数据流向。</p>
      </div>

      <div className="card">
        <h2>数据流向</h2>
        <ul className="bare privacy-list" style={{ marginTop: 12 }}>
          <li><span className="ok">✓</span> <strong>注意力分析</strong>（显著性、边缘、对比度、注意力图）— 纯本地计算，不上传任何图片或像素数据。</li>
          <li><span className="ok">✓</span> <strong>导入的壁纸</strong> — 仅在本地分析和合成。不会被上传到云端。</li>
          <li><span className="warn">⚠</span> <strong>桌面图标位置</strong> — 当前 Alpha 尚未接通 UI Automation，布局会启用保守边缘安全区；不会读取文件名。</li>
          <li><span className="ok">✓</span> <strong>内容数据</strong>（目标、问题、句子）— 存储在本地 SQLite 数据库。</li>
          <li><span className="ok">✓</span> <strong>ONNX 模型推理</strong> — 仅在本地运行，不自动下载权重。</li>
          <li><span className="warn">⚠</span> <strong>AI 壁纸生成</strong> — 用户主动触发时，会发送提示词到 AI 服务。负空间遮罩不包含原始像素。</li>
          <li><span className="warn">⚠</span> <strong>设备令牌</strong> — 当前 Alpha 的 Mock 服务仅使用临时开发令牌，不持久化真实设备令牌；正式邀请制接入前需补 Windows Credential Manager。</li>
        </ul>
      </div>

      <div className="card">
        <h2>设置</h2>
        <div className="col">
          <label className="field">
            轮换间隔 (分钟)
            <input
              type="number"
              value={settings.rotationIntervalMinutes}
              onChange={(e) => update({ rotationIntervalMinutes: Number(e.target.value) || 25 })}
              min={5}
              max={120}
            />
          </label>
          <label className="field">
            每显示器最多条数
            <input
              type="number"
              value={settings.perMonitorMax}
              onChange={(e) => update({ perMonitorMax: Number(e.target.value) || 3 })}
              min={1}
              max={5}
            />
          </label>
          <label className="field">
            正文字体
            <input
              type="text"
              value={settings.fontBody}
              onChange={(e) => update({ fontBody: e.target.value })}
            />
          </label>
          <label className="field">
            AI 服务地址
            <input
              type="text"
              value={settings.aiBaseUrl}
              onChange={(e) => update({ aiBaseUrl: e.target.value })}
            />
          </label>
          <label className="field">
            模型清单目录 (可选)
            <input
              type="text"
              value={settings.modelManifestDir ?? ""}
              onChange={(e) => update({ modelManifestDir: e.target.value || null })}
              placeholder="留空则使用纯启发式"
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>模型安装说明</h2>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.8 }}>
          <p>本项目使用纯本地启发式算法作为基线（始终可用，不下载任何模型）。</p>
          <p>要启用 ONNX 增强，请手动下载以下模型文件并放入模型清单目录：</p>
          <ul>
            <li><strong>U2-NetP</strong> — 主体显著性检测</li>
            <li><strong>FaceDetLite</strong> — 人脸检测（框扩充 15%）</li>
            <li><strong>PP-OCRv6-tiny</strong> — 文字检测（仅检测框，不识别；框扩充 12px）</li>
          </ul>
          <p>每个模型需附带 JSON 清单文件（含 sha256 校验和）。项目不自动下载权重。</p>
          <p>未安装模型时，启发性后备始终可用，不会伪造检测结果。</p>
        </div>
      </div>

      <div className="card">
        <h2>存储</h2>
        <div className="kv">
          <span className="k">数据库</span>
          <span>本地 SQLite (attention-wallpaper.sqlite)</span>
          <span className="k">壁纸快照</span>
          <span>临时目录 (原子写入 + 重命名)</span>
          <span className="k">遥测</span>
          <span>无</span>
          <span className="k">自动更新</span>
          <span>无</span>
        </div>
      </div>
    </div>
  );
}
