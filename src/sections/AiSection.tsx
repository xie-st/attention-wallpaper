import { useEffect, useState } from "react";
import { ApiClient, type Quota } from "@ai-client";
import { type MonitorInfo, type Settings } from "../lib/tauri";

interface Props {
  monitors: MonitorInfo[];
  settings: Settings;
  onToast: (msg: string, good?: boolean) => void;
}

export function AiSection({ monitors, settings, onToast }: Props) {
  const [prompt, setPrompt] = useState("");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const monitor = monitors[0];

  const refreshQuota = async () => {
    try {
      const client = new ApiClient(settings.aiBaseUrl);
      const q = await client.getQuota();
      setQuota(q);
    } catch {
      setQuota(null);
    }
  };

  useEffect(() => { refreshQuota(); }, [settings.aiBaseUrl]);

  const handleGenerate = async () => {
    if (!monitor || !prompt.trim()) return;
    setBusy(true);
    setStatus("正在激活...");
    try {
      const client = new ApiClient(settings.aiBaseUrl);
      await client.activate({ deviceToken: "local-dev" });
      setStatus("正在生成...");
      const { jobId } = await client.generate({
        monitor: { id: monitor.id, width: monitor.width, height: monitor.height },
        negativeMaskPng: btoa("mask"),
        negativeRegion: { x: 0, y: 0, w: monitor.width, h: monitor.height },
        prompt
      });
      const job = await client.waitForJob(jobId, { timeoutMs: 30_000, intervalMs: 500 });
      if (job.status === "succeeded" && job.imageUrl) {
        setResultUrl(client.resolve(job.imageUrl));
        setStatus("完成");
        onToast("生成完成", true);
      } else {
        setStatus(`失败: ${job.error ?? "未知"}`);
        onToast(`生成失败: ${job.error ?? "未知"}`, false);
      }
      refreshQuota();
    } catch (e) {
      setStatus(`错误: ${e}`);
      onToast(`请求失败: ${e}`, false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="section-head">
        <h1>AI 生成</h1>
        <p>用户主动触发的壁纸生成。注意：生成会发送提示词到 AI 服务，但导入的壁纸和注意力分析始终留在本地。</p>
      </div>

      <div className="card">
        <h2>服务配额</h2>
        {quota ? (
          <div className="kv">
            <span className="k">今日用量</span><span>{quota.dailyUsed} / {quota.dailyLimit}</span>
            <span className="k">本月用量</span><span>{quota.monthlyUsed} / {quota.monthlyLimit}</span>
            <span className="k">并发</span><span>{quota.concurrent} / {quota.concurrentLimit}</span>
            <span className="k">重置时间</span><span>{new Date(quota.resetAt).toLocaleString("zh-CN")}</span>
          </div>
        ) : (
          <div className="muted">未连接到 AI 服务。请启动 Mock 服务器：<code>pnpm mock:server</code></div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={refreshQuota}>刷新配额</button>
        </div>
      </div>

      <div className="card">
        <h2>生成壁纸</h2>
        <div style={{ padding: "10px 14px", background: "rgba(210,153,34,0.08)", border: "1px solid rgba(210,153,34,0.2)", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "var(--warn)" }}>
          ⚠ AI 生成会上传提示词。导入的壁纸和注意力分析不会被上传。
        </div>
        <label className="field">
          提示词（描述你想要的壁纸）
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：清晨的薄雾笼罩山间，上方留白..." />
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={handleGenerate} disabled={busy || !prompt.trim()}>
            {busy ? "生成中..." : "生成"}
          </button>
          {status && <span className="pill">{status}</span>}
        </div>
        {resultUrl && (
          <div className="preview-wrap" style={{ marginTop: 14, maxWidth: 720 }}>
            <img src={resultUrl} alt="generated" style={{ width: "100%", display: "block" }} />
          </div>
        )}
      </div>
    </div>
  );
}
