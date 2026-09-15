"use client";
import { clientId } from "./client-id";
import { useEffect, useRef, useState } from "react";
import { ModelLoading } from "./ModelLoading";
import type { LibraryStory } from "./StoryLibrary";
type Job = {
  id: string;
  tags: string[];
  status: string;
  phase: string;
  version: string | null;
  error: string | null;
  description?: string;
};
type Info = {
  tags: string[];
  enabled: boolean;
  count: number;
  jobs: Job[];
  dailyRemaining: number;
  dailyLimit: number;
  requiresLogin: boolean;
  oauthReady: boolean;
  slots: { slot: number; version: string; title: string }[];
};
export function StoryGenerator({
  request,
  onBack,
  onReady,
  replaceStory,
}: {
  request: (path: string, body?: unknown) => Promise<any>;
  onBack: () => void;
  onReady: () => void;
  replaceStory?: LibraryStory | null;
}) {
  const [info, setInfo] = useState<Info | null>(null),
    [tags, setTags] = useState<string[]>(
      replaceStory?.source.tags.slice(0, 5) ?? [],
    ),
    [description, setDescription] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{
    id: string;
    tags: string[];
    description: string;
    replaceVersion?: string;
  } | null>(null);
  const refreshing = useRef(false);
  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setInfo(await request("generation"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "暂时无法加载");
    } finally {
      refreshing.current = false;
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const running = info?.jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [running]);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = {
        tags: [...tags].sort(),
        description: description.trim(),
        ...(replaceStory ? { replaceVersion: replaceStory.version } : {}),
      };
      if (
        !pending.current ||
        JSON.stringify({ ...pending.current, id: undefined }) !==
          JSON.stringify(value)
      )
        pending.current = { id: clientId(), ...value };
      await request("generation", pending.current);
      pending.current = null;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  const full = !replaceStory && (info?.slots?.length ?? 0) >= 3;
  if (info?.requiresLogin)
    return (
      <section className="story-library generator-page">
        <header>
          <h1>登录后，写一个新故事</h1>
          <button onClick={onBack}>返回书架</button>
        </header>
        <p>
          知乎登录用户每天有6次生成机会，私人书架有3个栏位。访客可以继续游玩精选故事和社区故事。
        </p>
        <button
          className="primary"
          disabled={busy || !info.oauthReady}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              const result = await request("auth/zhihu/start", {});
              location.assign(result.url);
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录暂不可用");
            } finally {
              setBusy(false);
            }
          }}
        >
          {info.oauthReady ? "使用知乎账号登录" : "知乎登录暂未开放"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    );
  return (
    <section className="story-library generator-page">
      <header>
        <h1>
          {replaceStory ? `重新生成《${replaceStory.title}》` : "写一个新故事"}
        </h1>
        <button onClick={onBack}>返回书架</button>
      </header>
      <p>
        选择 2—5 个标签，再写下你的想法。每天有 6 次生成机会，私人书架有 3
        个栏位。
      </p>
      <p className="generation-balance">
        今日剩余 {info?.dailyRemaining ?? "…"}/{info?.dailyLimit ?? 6} 次 ·
        已用栏位 {info?.slots?.length ?? 0}/3
      </p>
      {replaceStory ? (
        <p>
          重新生成也消耗一次机会。新故事完成后才会替换原稿；未完成则保留原稿。已上传的社区故事不受影响。
        </p>
      ) : null}
      <fieldset className="tag-filter">
        <legend>已选 {tags.length}/5 个标签</legend>
        {info?.tags.map((t) => (
          <button
            key={t}
            aria-pressed={tags.includes(t)}
            disabled={
              busy || !!running || (!tags.includes(t) && tags.length >= 5)
            }
            onClick={() =>
              setTags((v) =>
                v.includes(t) ? v.filter((x) => x !== t) : [...v, t],
              )
            }
          >
            {t}
          </button>
        ))}
      </fieldset>
      <label className="generation-ideas">
        {replaceStory ? "这次想怎样改写？" : "你对故事有什么想法？"}
        <textarea
          maxLength={1000}
          rows={5}
          value={description}
          disabled={busy || !!running}
          placeholder="例如：主角是个怕鬼的侦探；气氛轻松一点，希望有几次意料之外的反转。"
          onChange={(e) =>
            setDescription(Array.from(e.target.value).slice(0, 500).join(""))
          }
        />
        <small>{Array.from(description).length}/500 字</small>
      </label>
      {!info?.enabled && info ? (
        <p>故事生成暂未开放，精选故事与小游戏仍可直接游玩。</p>
      ) : null}
      {full ? (
        <p role="alert">
          三个栏位已满，请返回书架删除一篇，或选择已有故事重新生成。
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        className="primary"
        disabled={
          !info?.enabled ||
          tags.length < 2 ||
          busy ||
          !!running ||
          full ||
          info.dailyRemaining === 0
        }
        onClick={submit}
      >
        {busy
          ? "正在提交…"
          : running
            ? "正在写作，请稍等…"
            : replaceStory
              ? "重新生成（消耗1次）"
              : "生成故事（消耗1次）"}
      </button>
      {busy && !running ? (
        <ModelLoading
          title="正在提交故事想法"
          detail="正在连接城主，请稍候。"
        />
      ) : null}
      <p className="muted">
        故事完成后会加入书架，离开本页也会继续生成。开始生成后消耗一次机会，失败也计入次数；每天北京时间零点恢复6次机会。
      </p>
      <div className="generation-jobs">
        {info?.jobs.map((j) => (
          <article key={j.id}>
            <strong>{j.tags.join(" · ")}</strong>
            {["queued", "running"].includes(j.status) ? (
              <ModelLoading
                title={j.phase || "正在编写故事"}
                detail="故事写好后会放入你的书架，离开本页也会继续生成。"
                slowMessage="完整故事需要一些时间。城主还在处理，当前步骤如上；你可以先返回书架。"
              />
            ) : (
              <p role="status">{j.phase}</p>
            )}
            {j.error ? <p role="alert">{j.error}</p> : null}
            {j.status === "ready" ? (
              <button onClick={onReady}>去书架看新故事 →</button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
