"use client";
import { useState } from "react";
import { Manuscript } from "./Manuscript";
import type { ScriptBook } from "@/content/script-book";
import type { ScriptLine } from "@/content/script-book";
export type LibraryStory = {
  version: string;
  category?: "curated" | "personal" | "community";
  mine?: boolean;
  canRead?: boolean;
  slot?: number;
  title: string;
  description: string;
  stages: number;
  dialogueLines: number;
  source: { title: string; author: string; url: string; tags: string[] };
  references?: { title: string; author: string; url: string; tags: string[] }[];
  endingCategories: { id: string; category: string; label: string }[];
};
export type CollectedEnding = {
  scenarioVersion: string;
  endingId: string;
  title: string;
  label: string;
  recap: ScriptLine[];
  achievedAt: number;
  roleNames?: Record<string, string>;
};
const sameStory = (a: string, b: string) => a === b;
export function StoryLibrary({
  stories,
  collection,
  onChoose,
  onBack,
  onGenerate,
  request,
  onRefresh,
}: {
  stories: LibraryStory[];
  collection: CollectedEnding[];
  onChoose: (s: LibraryStory) => void;
  onBack: () => void;
  onGenerate: (story?: LibraryStory) => void;
  request: (path: string, body?: unknown) => Promise<any>;
  onRefresh: () => Promise<void>;
}) {
  const [category, setCategory] = useState<
      "curated" | "personal" | "community"
    >("curated"),
    [manuscript, setManuscript] = useState<ScriptBook | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<"delete" | "publish" | "unpublish" | null>(
      null,
    );
  const [tags, setTags] = useState<string[]>([]),
    [filterOpen, setFilterOpen] = useState(false),
    [uploadOpen, setUploadOpen] = useState(false),
    [selected, setSelected] = useState<LibraryStory | null>(null),
    [recap, setRecap] = useState<CollectedEnding | null>(null);
  const allTags = [
    ...new Set(
      stories
        .filter((s) => (s.category ?? "curated") === category)
        .flatMap((s) => s.source.tags),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const filtered = stories.filter(
    (s) =>
      (s.category ?? "curated") === category &&
      tags.every((t) => s.source.tags.includes(t)),
  );
  const personal = stories.filter((s) => s.category === "personal");
  const published = stories.find((s) => s.category === "community" && s.mine);
  async function manage(action: "delete" | "publish" | "unpublish") {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`books/${selected.version}/${action}`, {});
      await onRefresh();
      if (action === "publish") {
        setCategory("community");
        setTags([]);
      }
      setSelected(null);
      setConfirm(null);
      setManuscript(null);
      setUploadOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="story-library">
      <header>
        <div>
          <h1>{selected ? selected.title : "今天想进入哪个故事？"}</h1>
        </div>
        <button
          className="secondary"
          onClick={() => {
            if (selected) {
              setSelected(null);
              setRecap(null);
              setManuscript(null);
              setConfirm(null);
              setError("");
            } else onBack();
          }}
        >
          {selected ? "返回书架" : "返回封面"}
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!selected ? (
        <>
          <nav className="book-tabs" aria-label="剧本分类">
            {(
              [
                ["curated", "精选剧本"],
                ["personal", "自生成剧本"],
                ["community", "社区剧本"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={category === id}
                onClick={() => {
                  setCategory(id);
                  setTags([]);
                  setFilterOpen(false);
                  setUploadOpen(false);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="library-tools">
            {category === "personal" ? (
              <button className="primary" onClick={() => onGenerate()}>
                生成新故事 →
              </button>
            ) : category === "community" ? (
              <button
                className="primary"
                aria-expanded={uploadOpen}
                aria-controls="community-upload"
                onClick={() => setUploadOpen(!uploadOpen)}
              >
                上传剧本
              </button>
            ) : null}
            <button
              aria-expanded={filterOpen}
              aria-controls="library-tags"
              onClick={() => setFilterOpen(!filterOpen)}
            >
              筛选题材{tags.length ? `（已选${tags.length}）` : ""}
            </button>
          </div>
          {category === "community" && uploadOpen ? (
            <section
              id="community-upload"
              className="community-upload"
              aria-label="上传剧本"
            >
              {published ? (
                <>
                  <p>你已经上架《{published.title}》，请先下架再上传另一篇。</p>
                  <button
                    onClick={() => {
                      setSelected(published);
                      setConfirm("unpublish");
                    }}
                  >
                    管理已上传剧本
                  </button>
                </>
              ) : personal.length ? (
                <>
                  <h2>选择一篇你的故事</h2>
                  <p>上传后，其他玩家就能在社区游玩它。私人原稿会保留。</p>
                  <div className="upload-choices">
                    {personal.map((s) => (
                      <button
                        key={s.version}
                        onClick={() => {
                          setSelected(s);
                          setConfirm("publish");
                        }}
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p>
                    还没有可以上传的剧本。请先到自生成剧本处生成一个新故事。
                  </p>
                  <button
                    onClick={() => {
                      setCategory("personal");
                      setTags([]);
                      setFilterOpen(false);
                      setUploadOpen(false);
                    }}
                  >
                    前往自生成剧本
                  </button>
                </>
              )}
            </section>
          ) : null}
          {category === "personal" ? (
            <p>
              仅你可见 ·{" "}
              {stories.filter((s) => s.category === "personal").length}/3 个栏位
            </p>
          ) : category === "community" ? (
            <p>这里的故事由玩家分享，每人可以上传一篇。</p>
          ) : null}
          {filterOpen ? (
            <fieldset className="tag-filter" id="library-tags">
              <legend>找一个题材 · 可多选，同时包含全部所选标签</legend>
              {allTags.map((t) => (
                <button
                  key={t}
                  aria-pressed={tags.includes(t)}
                  onClick={() =>
                    setTags((old) =>
                      old.includes(t)
                        ? old.filter((x) => x !== t)
                        : [...old, t],
                    )
                  }
                >
                  {t}
                </button>
              ))}
              {tags.length ? (
                <button onClick={() => setTags([])}>清除筛选</button>
              ) : null}
            </fieldset>
          ) : null}
          <div className="library-grid">
            {filtered.map((s, i) => {
              const unlocked = s.endingCategories.filter((e) =>
                collection.some(
                  (c) =>
                    sameStory(c.scenarioVersion, s.version) &&
                    c.endingId === e.id,
                ),
              ).length;
              return (
                <button
                  key={s.version}
                  className="story-card"
                  onClick={() => setSelected(s)}
                >
                  <small>
                    {String(stories.indexOf(s) + 1).padStart(2, "0")} /{" "}
                    {s.source.tags.slice(0, 2).join(" · ")}
                  </small>
                  <h2>{s.title}</h2>
                  <p>{s.description}</p>
                  <span>
                    {s.stages}幕 · {s.endingCategories.length}个结局 · 已达成{" "}
                    {unlocked}/{s.endingCategories.length}
                  </span>
                </button>
              );
            })}
          </div>
          {!filtered.length ? <p>没有匹配的故事，换个标签试试。</p> : null}
        </>
      ) : (
        <>
          <p className="story-description">{selected.description}</p>
          <p>
            {selected.stages}幕 · {selected.endingCategories.length}个结局
          </p>
          <p className="source-credit">
            改编素材：
            <a href={selected.source.url} target="_blank" rel="noreferrer">
              《{selected.source.title}》
            </a>{" "}
            / {selected.source.author} · 知乎故事改编
          </p>
          {selected.references && selected.references.length > 1 ? (
            <p className="source-credit">
              其他参考：
              {selected.references.slice(1).map((s) => (
                <span key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    《{s.title}》
                  </a>{" "}
                  / {s.author}　
                </span>
              ))}
            </p>
          ) : null}
          <button className="primary" onClick={() => onChoose(selected)}>
            选择这篇，创建角色 →
          </button>
          <div className="book-management">
            {selected.category === "personal" ? (
              <>
                <button onClick={() => onGenerate(selected)}>重新生成</button>
                <button onClick={() => setConfirm("delete")}>删除剧本</button>
                <button onClick={() => setConfirm("publish")}>
                  分享到社区
                </button>
              </>
            ) : null}
            {selected.category === "community" && selected.mine ? (
              <button onClick={() => setConfirm("unpublish")}>
                下架社区剧本
              </button>
            ) : null}
            <button
              disabled={busy || !selected.canRead}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setManuscript(
                    (await request(`books/${selected.version}/manuscript`))
                      .book,
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : "暂时无法读取");
                } finally {
                  setBusy(false);
                }
              }}
            >
              查看完整剧本
            </button>
          </div>
          {!selected.canRead ? (
            <p>
              {(selected.category ?? "curated") === "curated"
                ? "达成所有结局后解锁完整剧本。"
                : "达成一个结局后解锁完整剧本。"}
            </p>
          ) : null}
          {confirm ? (
            <div className="book-confirm" role="region" aria-label="确认操作">
              <p>
                {confirm === "delete"
                  ? "删除后释放私人栏位。已开始的游戏仍可继续，已分享的社区副本保留。"
                  : confirm === "publish"
                    ? "分享后，所有玩家都能游玩这篇故事；每人仅能上架一篇。私人原稿仍只对你可见。"
                    : "下架后不再出现在社区书架，已经开始的游戏仍可继续。"}
              </p>
              <button disabled={busy} onClick={() => void manage(confirm)}>
                确认
                {confirm === "delete"
                  ? "删除"
                  : confirm === "publish"
                    ? "分享"
                    : "下架"}
              </button>
              <button disabled={busy} onClick={() => setConfirm(null)}>
                取消
              </button>
            </div>
          ) : null}
          {manuscript ? <Manuscript book={manuscript} /> : null}
          <h2>我的结局收藏</h2>
          <p>
            解锁后可以查看结局名称和回顾。登录后收藏跟随账号；访客收藏保存在当前浏览器对应的存档中。
          </p>
          <div className="ending-shelf">
            {selected.endingCategories.map((e) => {
              const found = collection.find(
                (c) =>
                  sameStory(c.scenarioVersion, selected.version) &&
                  c.endingId === e.id,
              );
              return (
                <button
                  key={e.id}
                  disabled={!found}
                  className={found ? "unlocked" : "locked"}
                  onClick={() => setRecap(found!)}
                >
                  <strong>{e.label}</strong>
                  <span>{found ? `✓ ${found.title}` : "尚未达成"}</span>
                </button>
              );
            })}
          </div>
          {recap ? (
            <article className="ending-recap">
              <h3>
                {recap.label} · {recap.title}
              </h3>
              <p>最后一幕回顾</p>
              {recap.recap.map((l, i) => (
                <p key={i}>
                  <b>
                    {recap.roleNames?.[l.speaker] ??
                      (l.speaker === "gm"
                        ? "猫咪城主"
                        : l.speaker === "player"
                          ? "你"
                          : "同伴")}
                    ：
                  </b>
                  {l.text}
                </p>
              ))}
            </article>
          ) : null}
          {collection.some(
            (c) =>
              !sameStory(c.scenarioVersion, selected.version) &&
              c.scenarioVersion.replace(/-1\.[012]$/, "") ===
                selected.version.replace(/-1\.[012]$/, ""),
          ) ? (
            <div className="ending-shelf">
              <h3>旧版收藏仍在这里</h3>
              {collection
                .filter(
                  (c) =>
                    !sameStory(c.scenarioVersion, selected.version) &&
                    c.scenarioVersion.replace(/-1\.[012]$/, "") ===
                      selected.version.replace(/-1\.[012]$/, ""),
                )
                .map((c) => (
                  <button
                    key={c.scenarioVersion + c.endingId}
                    onClick={() => setRecap(c)}
                  >
                    {c.label} · {c.title}（旧版）
                  </button>
                ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
