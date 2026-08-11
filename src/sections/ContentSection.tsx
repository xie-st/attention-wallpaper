import { useState, useEffect } from "react";
import { bridge, type Settings } from "../lib/tauri";
import { validateContentItem, SAMPLE_CONTENT, type ContentItem, type ContentKind, type Priority, type Frequency } from "@content-model";

interface Props {
  settings: Settings;
  onRefresh: () => void;
  onToast: (msg: string, good?: boolean) => void;
}

const KINDS: ContentKind[] = ["goal", "question", "sentence"];
const PRIORITIES: Priority[] = ["low", "normal", "high"];
const FREQUENCIES: Frequency[] = ["occasional", "normal", "frequent"];

const KIND_LABEL: Record<ContentKind, string> = { goal: "目标", question: "问题", sentence: "句子" };
const PRIORITY_LABEL: Record<Priority, string> = { low: "低", normal: "中", high: "高" };
const FREQ_LABEL: Record<Frequency, string> = { occasional: "偶尔", normal: "正常", frequent: "频繁" };

export function ContentSection({ settings, onRefresh, onToast }: Props) {
  const [content, setContent] = useState<ContentItem[]>([]);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    bridge.listContent().then(setContent);
  }, []);

  const onChange = () => {
    bridge.listContent().then(setContent);
    onRefresh();
  };

  const onSeed = async () => {
    for (const item of SAMPLE_CONTENT) await bridge.saveContent(item);
    onChange();
    onToast("已添加示例内容");
  };

  const startNew = () => {
    setEditing({
      id: "item-" + Date.now().toString(36),
      kind: "goal",
      body: "",
      priority: "normal",
      startsAt: null,
      endsAt: null,
      frequency: "normal",
      enabled: true
    });
    setErrors([]);
  };

  const save = async () => {
    if (!editing) return;
    const errs = validateContentItem(editing);
    if (errs.length > 0) {
      setErrors(errs.map((e) => e.message));
      return;
    }
    await bridge.saveContent(editing);
    setEditing(null);
    onChange();
    onToast("已保存");
  };

  const del = async (id: string) => {
    await bridge.deleteContent(id);
    onChange();
    onToast("已删除");
  };

  const toggle = async (item: ContentItem) => {
    await bridge.saveContent({ ...item, enabled: !item.enabled });
    onChange();
  };

  return (
    <div>
      <div className="section-head">
        <h1>内容</h1>
        <p>管理目标、问题和句子。每台显示器最多显示 1 条，每 {settings.rotationIntervalMinutes} 分钟轮换一次。</p>
      </div>

      {content.length === 0 && !editing && (
        <div className="card">
          <div className="empty">
            <div className="ico">✎</div>
            <div>还没有任何内容</div>
            <div className="hint">
              <button className="primary" onClick={onSeed}>添加示例内容</button>
              {" "}
              <button onClick={startNew}>新建内容</button>
            </div>
          </div>
        </div>
      )}

      {content.length > 0 && (
        <div className="card">
          <div className="row between">
            <h2>已 有 {content.length} 条</h2>
            <button className="primary" onClick={startNew}>+ 新建</button>
          </div>
          <ul className="bare">
            {content.map((item) => (
              <li className="content-item" key={item.id}>
                <div className="row between">
                  <div className="grow">
                    <div className="body">{item.body}</div>
                    <div className="meta">
                      <span className="pill">{KIND_LABEL[item.kind]}</span>
                      <span className="pill">优先级 {PRIORITY_LABEL[item.priority]}</span>
                      <span className="pill">{FREQ_LABEL[item.frequency]}</span>
                      <span className={`pill ${item.enabled ? "good" : "bad"}`}>
                        {item.enabled ? "已启用" : "已禁用"}
                      </span>
                      {item.startsAt && <span className="pill">起 {item.startsAt.slice(0, 10)}</span>}
                      {item.endsAt && <span className="pill">止 {item.endsAt.slice(0, 10)}</span>}
                    </div>
                  </div>
                  <div className="row">
                    <button onClick={() => { setEditing(item); setErrors([]); }}>编辑</button>
                    <button onClick={() => toggle(item)}>{item.enabled ? "禁用" : "启用"}</button>
                    <button className="danger" onClick={() => del(item.id)}>删除</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <div className="card">
          <h2>{content.find((c) => c.id === editing.id) ? "编辑内容" : "新建内容"}</h2>
          <div className="col">
            <label className="field">
              正文
              <textarea
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                placeholder="输入目标、问题或句子..."
                maxLength={280}
              />
            </label>
            <div className="grid-3">
              <label className="field">
                类型
                <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as ContentKind })}>
                  {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="field">
                优先级
                <select value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value as Priority })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select>
              </label>
              <label className="field">
                频率
                <select value={editing.frequency} onChange={(e) => setEditing({ ...editing, frequency: e.target.value as Frequency })}>
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
                </select>
              </label>
            </div>
            <div className="grid-2">
              <label className="field">
                开始时间（可选）
                <input type="text" value={editing.startsAt ?? ""} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value || null })} placeholder="2026-08-11T00:00:00.000Z" />
              </label>
              <label className="field">
                结束时间（可选）
                <input type="text" value={editing.endsAt ?? ""} onChange={(e) => setEditing({ ...editing, endsAt: e.target.value || null })} placeholder="2026-08-31T00:00:00.000Z" />
              </label>
            </div>
            <label className="field" style={{ flexDirection: "row", gap: 8 }}>
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              启用
            </label>
            {errors.length > 0 && (
              <div style={{ color: "var(--bad)", fontSize: 12 }}>
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <div className="row">
              <button className="primary" onClick={save}>保存</button>
              <button onClick={() => setEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
