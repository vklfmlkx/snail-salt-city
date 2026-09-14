"use client";
import { isFixedScriptAction } from "../../domain/script-action";
import { checkChances } from "@/domain/check-chances";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  attributeLabels,
  attributes,
  type Character,
  type PublicState,
  type PublicAction,
  type PublicTurn,
} from "@/domain/types";
import { VisualNovel } from "./VisualNovel";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { CharacterForm } from "./CharacterForm";
import { DiceReveal } from "./DiceReveal";
import { DialogueLog } from "./DialogueLog";
import {
  StoryLibrary,
  type LibraryStory,
  type CollectedEnding,
} from "./StoryLibrary";
import { MiniGame } from "./MiniGame";
import { ArcadePlayground } from "./ArcadePlayground";
import { StoryGenerator } from "./StoryGenerator";
import { useAssetUrl } from "./GameAssets";
type Me = {
  activeGameId: string | null;
  account?: { name: string } | null;
  oauthReady?: boolean;
  csrfToken: string;
  expiresAt: number;
  mode: "mock" | "live";
  summaries: { title: string; turns: number; createdAt: number }[];
  retention: string;
  collection: CollectedEnding[];
};
type Proposal = {
  id: string;
  stateVersion: number;
  expiresAt: number;
  intent: string;
  action: PublicAction;
};
type Pending = {
  gameId: string;
  clientTurnId: string;
  proposalId: string;
  expectedStateVersion: number;
};
const outcomeLabels = { success: "成功", partial: "部分成功", failure: "失败" };
function moneyCost(a: PublicAction) {
  return [
    a.stageCost === 0 ? "1次自由互动 · 留在当前场景" : "1行动 · 推进剧情",
    ...(a.cost.supplies ? [`${a.cost.supplies}物资`] : []),
    ...(a.cost.hp ? [`${a.cost.hp}生命`] : []),
  ].join(" · ");
}
export function GameApp() {
  const cover = useAssetUrl("/assets/brand/cover.v1.png");
  const [me, setMe] = useState<Me | null>(null),
    [state, setState] = useState<PublicState | null>(null),
    [turns, setTurns] = useState<PublicTurn[]>([]),
    [page, setPage] = useState<
      "home" | "library" | "create" | "game" | "playground" | "generate"
    >("home"),
    [busy, setBusy] = useState(false),
    [booting, setBooting] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [draft, setDraft] = useState(""),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [large, setLarge] = useState(false),
    [reduce, setReduce] = useState(false),
    [pending, setPending] = useState<Pending | null>(null),
    [abandon, setAbandon] = useState(false);
  const [homeSettings, setHomeSettings] = useState(false);
  const [replaceStory, setReplaceStory] = useState<LibraryStory | null>(null);
  const [stories, setStories] = useState<LibraryStory[]>([]),
    [selectedStory, setSelectedStory] = useState<LibraryStory | null>(null),
    [practice, setPractice] = useState(false);
  const [actionMode, setActionMode] = useState<"side" | "key">("side");
  useEffect(() => {
    if (state?.script && state.script.sideRemaining === 0) setActionMode("key");
  }, [state?.version]);
  const [roll, setRoll] = useState<PublicTurn | null>(null);
  const csrf = useRef(""),
    lock = useRef(false),
    narrations = useRef(new Set<string>()),
    boot = useRef(false);
  const request = useCallback(async (path: string, body?: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers:
          body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "X-Snail-Request": "1",
                "X-CSRF-Token": csrf.current,
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error?.message ?? "暂时无法完成，请稍后再试。");
      return data;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError")
        throw Error(
          "连接超时，行动可能已经保存。请点击“重试这次行动”找回结果。",
        );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }, []);
  const adopt = (data: {
    state: PublicState;
    turns?: PublicTurn[];
    turn?: PublicTurn;
  }) => {
    setState((old) =>
      old && old.id === data.state.id && old.version > data.state.version
        ? old
        : data.state,
    );
    if (data.turns) setTurns(data.turns);
    if (data.turn)
      setTurns((old) =>
        [...old.filter((t) => t.id !== data.turn!.id), data.turn!].sort(
          (a, b) => a.result.turnNumber - b.result.turnNumber,
        ),
      );
    localStorage.setItem("snail:last-game", data.state.id);
  };
  const perform = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    const login = new URLSearchParams(location.search).get("login");
    if (login) {
      setNotice(
        login === "success"
          ? "知乎登录成功。"
          : login === "guest_conflict"
            ? "当前访客有游戏进度，无法与已有账号自动合并。请在没有访客进度的浏览器登录已有账号。"
            : "登录未完成，请重新发起授权。",
      );
      history.replaceState(null, "", location.pathname);
    }

    Promise.all([request("visitor", {}), request("scenarios")])
      .then(async ([m, catalog]: [Me, { scenarios: LibraryStory[] }]) => {
        setStories(catalog.scenarios);
        csrf.current = m.csrfToken;
        setMe(m);
        const owned = await request("scenarios");
        setStories(owned.scenarios);
        const id = m.activeGameId ?? localStorage.getItem("snail:last-game");
        if (id) {
          try {
            adopt(await request(`sessions/${id}`));
          } catch {
            localStorage.removeItem("snail:last-game");
            // The user may have explicitly cleared the server-side history.
            // Do not restore an old pending turn or draft against a new game.
            for (const key of Object.keys(sessionStorage)) {
              if (key.startsWith("snail:")) sessionStorage.removeItem(key);
            }
          }
        }
        const saved = sessionStorage.getItem("snail:pending");
        if (saved) {
          try {
            setPending(JSON.parse(saved));
          } catch {
            sessionStorage.removeItem("snail:pending");
          }
        }
        setDraft(sessionStorage.getItem("snail:draft") ?? "");
        setActionMode(
          sessionStorage.getItem("snail:action-mode") === "key"
            ? "key"
            : "side",
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setBooting(false));
  }, [request]);
  useEffect(() => {
    if (!booting) sessionStorage.setItem("snail:draft", draft);
  }, [draft, booting]);
  useEffect(() => {
    if (!booting) sessionStorage.setItem("snail:action-mode", actionMode);
  }, [actionMode, booting]);
  useEffect(() => {
    if (page !== "game" || !state || !me) return;
    const waiting = turns.filter((t) => t.narrationStatus === "pending");
    for (const t of waiting) {
      if (narrations.current.has(t.id)) continue;
      narrations.current.add(t.id);
      request(`sessions/${state.id}/turns/${t.id}/narration`, {})
        .then((d) =>
          setTurns((old) => old.map((x) => (x.id === d.turn.id ? d.turn : x))),
        )
        .catch(() => {
          narrations.current.delete(t.id);
          setTurns((old) =>
            old.map((x) =>
              x.id === t.id
                ? { ...x, narrationStatus: "fallback", errorCode: "network" }
                : x,
            ),
          );
          setNotice("故事暂时加载不完整，已显示保存的行动结果。请刷新后继续。");
        });
    }
  }, [turns, state, me, page, request]);
  async function loadGame() {
    if (!state) return;
    await perform(async () => {
      adopt(await request(`sessions/${state.id}`));
      setPage("game");
    });
  }
  async function create(c: Character) {
    await perform(async () => {
      const data = await request("sessions", {
        ...c,
        scenarioVersion: selectedStory?.version ?? stories[0]?.version,
      });
      adopt(data);
      setDraft("");
      setActionMode("key");
      setProposal(null);
      setTurns([]);
      setPage("game");
      setMe((m) => (m ? { ...m, activeGameId: data.state.id } : m));
    });
  }
  async function propose(action?: PublicAction) {
    if (!state || pending) return;
    await perform(async () => {
      setNotice("");
      const data = await request(`sessions/${state.id}/proposals`, {
        expectedStateVersion: state.version,
        ...(action
          ? { actionOptionId: action.id }
          : {
              text: draft,
              ...(state.script
                ? { mode: state.script?.branching ? "key" : actionMode }
                : {}),
            }),
      });
      if (data.kind === "act") setProposal(data.proposal);
      else {
        setProposal(null);
        setNotice(data.message);
      }
    });
  }
  async function commit(retry?: Pending) {
    if (!state || (!proposal && !retry)) return;
    const send = retry ?? {
      gameId: state.id,
      clientTurnId: crypto.randomUUID(),
      proposalId: proposal!.id,
      expectedStateVersion: proposal!.stateVersion,
    };
    await perform(async () => {
      setPending(send);
      sessionStorage.setItem("snail:pending", JSON.stringify(send));
      const { gameId, ...payload } = send;
      const data = await request(`sessions/${gameId}/turns`, payload);
      adopt(data);
      if (
        data.turn.result.die !== null &&
        !sessionStorage.getItem(`snail:roll:${data.turn.id}`)
      ) {
        sessionStorage.setItem(`snail:roll:${data.turn.id}`, "seen");
        setRoll(data.turn);
      }
      setPending(null);
      sessionStorage.removeItem("snail:pending");
      setProposal(null);
      setDraft("");
      setNotice("");
    });
  }

  const latest = turns.at(-1);
  const retired =
    !!state &&
    state.scenarioVersion !== "homecoming-branch-3.0" &&
    !state.scenarioVersion?.startsWith("curated-") &&
    !state.scenarioVersion?.startsWith("generated-");
  useEffect(() => {
    if (proposal) {
      const preview = document.querySelector<HTMLElement>(".preview");
      preview?.focus();
      preview?.scrollIntoView({ block: "nearest" });
    }
  }, [proposal]);
  const recLimit = state?.script ? 4 : 3;
  const recommendations =
    state?.actions.filter((a) =>
      state.script
        ? isFixedScriptAction(a.id)
        : !a.id.includes(".opt.") &&
          !a.id.includes(".free.") &&
          !a.id.includes(".side."),
    ) ?? [];
  const extras = state?.script
    ? []
    : (state?.actions.filter(
        (a) =>
          !a.id.includes(".free.") &&
          !a.id.includes(".side.") &&
          !recommendations.slice(0, recLimit).some((x) => x.id === a.id),
      ) ?? []);
  const settings = (
    <div className="settings-content">
      {error ? <p role="alert">{error}</p> : null}
      <p>{me?.account ? `已登录：${me.account.name}` : "当前使用访客存档"}</p>
      {me?.account ? (
        <button
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await request("auth/logout", {});
              for (const k of Object.keys(localStorage))
                if (k.startsWith("snail:")) localStorage.removeItem(k);
              for (const k of Object.keys(sessionStorage))
                if (k.startsWith("snail:")) sessionStorage.removeItem(k);
              location.assign("/");
            })
          }
        >
          退出账号
        </button>
      ) : (
        <button
          disabled={busy || !me?.oauthReady}
          onClick={() =>
            void perform(async () => {
              const r = await request("auth/zhihu/start", {});
              location.assign(r.url);
            })
          }
        >
          {me?.oauthReady ? "使用知乎账号登录" : "知乎登录暂未开放"}
        </button>
      )}
      {!me?.account && me?.oauthReady ? (
        <p className="muted">
          登录后可在其他浏览器找回故事和进度。仅获取知乎昵称与账号标识。
        </p>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={large}
          onChange={(e) => setLarge(e.target.checked)}
        />
        加大正文字号
      </label>
      <label>
        <input
          type="checkbox"
          checked={reduce}
          onChange={(e) => setReduce(e.target.checked)}
        />
        减少动画
      </label>
      <p className="muted">每次确认行动后自动保存。</p>
      <p className="muted">{me?.retention}</p>
    </div>
  );
  return (
    <main
      className={`app page-${page} ${large ? "large-type" : ""} ${reduce ? "reduced-motion" : ""}`}
    >
      {roll ? (
        <DiceReveal turn={roll} reduce={reduce} onClose={() => setRoll(null)} />
      ) : null}
      {error ? (
        <div className="error-banner" role="alert">
          {error}
          <button
            onClick={() =>
              state
                ? perform(async () =>
                    adopt(await request(`sessions/${state.id}`)),
                  )
                : location.reload()
            }
          >
            刷新状态
          </button>
        </div>
      ) : null}
      {notice && page !== "game" ? (
        <aside className="notice-banner" role="status">
          <p>{notice}</p>
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            知道了
          </button>
        </aside>
      ) : null}
      {page === "home" ? (
        <section className="title-screen">
          <h1 className="sr-only">蜗牛与盐选城</h1>
          <div className="title-top">
            {me?.oauthReady || me?.account ? (
              <button onClick={() => setHomeSettings(true)}>
                {me.account ? me.account.name : "知乎登录"}
              </button>
            ) : null}
            <button onClick={() => setHomeSettings(true)}>
              <Icon name="settings" />
              设置与说明
            </button>
          </div>
          <div className="cover-frame">
            <img
              src={cover}
              width={1683}
              height={935}
              fetchPriority="high"
              alt="《蜗牛与盐选城》封面：巨型蜗牛与奔跑的人物，背景是一座荒诞城市"
            />
          </div>
          <div className="title-controls">
            <div className="title-story">
              <h2>这次，给故事一个答案。</h2>
            </div>
            <div className="start-panel">
              {state && !retired ? (
                <button
                  className="primary"
                  disabled={busy || booting}
                  onClick={loadGame}
                >
                  {state.status === "playing" ? "继续我的故事" : "查看本局结局"}
                  <Icon name="next" />
                </button>
              ) : null}
              <button
                className={state ? "secondary" : "primary"}
                disabled={busy || booting || !me}
                onClick={() => {
                  setPage("library");
                  request("me")
                    .then(setMe)
                    .catch(() => {});
                }}
              >
                {booting ? "正在准备存档…" : "选择故事"}
                <Icon name="next" />
              </button>
              <button
                className="secondary"
                onClick={() => setPage("playground")}
              >
                小游戏广场 <Icon name="next" />
              </button>
              {retired ? (
                <small>旧版剧本已归档。开始新版故事会保留旧记录。</small>
              ) : state ? (
                <small>
                  第 {state.stage.number} 幕 · 第 {state.turn} 回合 · 自动存档
                </small>
              ) : null}
            </div>
          </div>
          <div className="title-footer">
            <span>蜗牛与盐选城 · 跑团剧场</span>
          </div>
        </section>
      ) : null}
      {homeSettings ? (
        <Modal title="设置与说明" onClose={() => setHomeSettings(false)}>
          {settings}
          <p>故事改编素材的作者与来源见每篇书目。</p>
          <p>
            在“自生成剧本”中选择标签、写下想法，就能创作新故事。小游戏广场可单独游玩，不改变故事进度。
          </p>
          {me?.summaries.length ? (
            <>
              <h3>你留下的结局</h3>
              {me.summaries.map((s, i) => (
                <p key={i}>
                  {s.title} · {s.turns} 行动
                </p>
              ))}
            </>
          ) : null}
        </Modal>
      ) : null}
      {page === "create" ? (
        <section>
          <CharacterForm
            key={selectedStory?.version}
            story={selectedStory ?? undefined}
            busy={busy}
            onCreate={create}
            onCancel={() => setPage("library")}
          />
        </section>
      ) : null}
      {page === "library" ? (
        <StoryLibrary
          stories={stories}
          collection={me?.collection ?? []}
          onBack={() => setPage("home")}
          request={request}
          onRefresh={async () => {
            const c = await request("scenarios");
            setStories(c.scenarios);
          }}
          onGenerate={(story) => {
            setReplaceStory(story ?? null);
            setPage("generate");
          }}
          onChoose={(s) => {
            setSelectedStory(s);
            if (state?.status === "playing" && !retired) setAbandon(true);
            else setPage("create");
          }}
        />
      ) : null}
      {page === "playground" ? (
        <ArcadePlayground onBack={() => setPage("home")} />
      ) : null}
      {page === "generate" ? (
        <StoryGenerator
          replaceStory={replaceStory}
          request={request}
          onBack={() => {
            void request("scenarios")
              .then((d) => {
                setStories(d.scenarios);
                setPage("library");
              })
              .catch((e) => setError(e.message));
          }}
          onReady={() => {
            void request("scenarios")
              .then((d) => {
                setStories(d.scenarios);
                setPage("library");
              })
              .catch((e) => setError(e.message));
          }}
        />
      ) : null}
      {page === "game" && state ? (
        <VisualNovel
          key={`${state.id}:${state.version}`}
          state={state}
          latest={latest}
          live={me?.mode === "live"}
          busy={busy}
          hasPending={!!pending}
          onPractice={() => setPractice(true)}
          onHome={() => {
            setPage("home");
            request("me")
              .then(setMe)
              .catch(() => {});
          }}
          settings={settings}
          actions={
            <section className="choices">
              {error ? (
                <p className="notice" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="section-title">
                <h2>接下来，你想怎么做？</h2>
                <span>
                  {state.script ? "每幕一次关键行动" : "确认后才消耗行动"}
                </span>
              </div>
              {pending ? (
                <div className="pending" role="status">
                  <p>
                    上次行动的结果还没显示。重试会找回已保存的结果，不会重新掷骰。
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => commit(pending)}
                  >
                    重试这次行动
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        adopt(await request(`sessions/${state.id}`));
                        setPending(null);
                        sessionStorage.removeItem("snail:pending");
                        setProposal(null);
                      })
                    }
                  >
                    查看最新进度
                  </button>
                </div>
              ) : null}
              <p className="current-objective">
                此刻：
                {state.script?.branching
                  ? state.stage.intro
                  : (state.actions[0]?.target ?? state.stage.intro)}
              </p>
              <p className="action-hint">选择一种做法，预览检定后再决定。</p>
              {state.script ? (
                <h3>关键行动 · {recommendations.length}种做法</h3>
              ) : null}
              <div className="recommended">
                {recommendations.slice(0, recLimit).map((a, i) => (
                  <button
                    key={a.id}
                    disabled={busy || !!pending}
                    onClick={() => propose(a)}
                  >
                    <span className="choice-index">0{i + 1}</span>
                    <span>
                      {a.label}
                      <small>
                        {a.attribute
                          ? `${attributeLabels[a.attribute]} · ${a.requirement ? { low: "低", medium: "中", high: "高" }[a.requirement] + "要求 · " : ""}难度${a.difficulty}`
                          : "无需检定"}{" "}
                        · {moneyCost(a)}
                      </small>
                    </span>
                    <b>↗</b>
                  </button>
                ))}
              </div>
              {extras.length ? (
                <details className="more-actions">
                  <summary>
                    更多行动、调查与准备 <span>+ {extras.length}</span>
                  </summary>
                  <div>
                    {extras.map((a) => (
                      <button
                        className={
                          a.id.endsWith(".touch") ? "danger-option" : ""
                        }
                        disabled={busy || !!pending}
                        key={a.id}
                        onClick={() => propose(a)}
                      >
                        {a.label}
                        <small>
                          {moneyCost(a)} · {a.risk}
                        </small>
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}

              {notice ? (
                <p className="notice" role="status">
                  {notice}
                </p>
              ) : null}
              {proposal ? (
                <div
                  className="preview"
                  tabIndex={-1}
                  role="region"
                  aria-label="行动预览"
                >
                  <span className="chapter-number">还未发生 · 行动预览</span>
                  <h3>{proposal.intent}</h3>
                  <p>
                    {proposal.action.attribute
                      ? `${attributeLabels[proposal.action.attribute]}检定 · 难度${proposal.action.difficulty} · 修正${proposal.action.modifier >= 0 ? "+" : ""}${proposal.action.modifier}`
                      : "自动执行，不掷骰"}{" "}
                    · {moneyCost(proposal.action)}
                  </p>
                  <p className="risk">{proposal.action.risk}</p>
                  {proposal.action.attribute &&
                  proposal.action.difficulty !== null
                    ? (() => {
                        const a = proposal.action.attribute!,
                          value =
                            state.script?.effectiveStats[a] ??
                            state.character.stats[a];
                        const odds = checkChances(
                          value,
                          proposal.action.difficulty!,
                          proposal.action.modifier,
                        );
                        return (
                          <p className="check-odds">
                            {attributeLabels[a]} {value} · 成功 {odds.success}%
                            / 部分成功 {odds.partial}% / 失败 {odds.failure}%
                          </p>
                        );
                      })()
                    : null}
                  {state.script?.branching ? (
                    <p className="muted">
                      本次方向：{proposal.action.target}
                      。确认后才会投骰并决定路线。
                    </p>
                  ) : null}
                  <small>预览10分钟内有效。取消或更换选项不消耗行动。</small>
                  <div>
                    <button
                      className="primary"
                      disabled={busy || !!pending}
                      onClick={() => commit()}
                    >
                      确认并行动 →
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || !!pending}
                      onClick={() => setProposal(null)}
                    >
                      取消预览
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          }
          result={
            latest ? (
              <section
                className={`result-card ${latest.result.outcome}`}
                aria-label="本回合结果"
              >
                <div>
                  <b>{outcomeLabels[latest.result.outcome]}</b>
                  <span>{latest.result.actionLabel}</span>
                </div>
                <p>
                  {latest.result.die !== null
                    ? `d10 ${latest.result.die} + ${attributeLabels[latest.result.attribute!]} ${latest.result.attributeValue} + 修正 ${latest.result.modifier} − 难度 ${latest.result.difficulty} = ${latest.result.margin}`
                    : "自动执行 · 无需掷骰"}
                  <small>
                    第{latest.result.turnNumber}回合 · 这个结果已保存，不会重掷
                  </small>
                </p>
                <div className="event-list">
                  {latest.result.events
                    .filter(
                      (e) =>
                        e.type === "resource" ||
                        e.type === "fact" ||
                        e.type === "item" ||
                        e.type === "stage" ||
                        e.type === "attribute",
                    )
                    .map((e, i) => (
                      <span key={i}>
                        {e.type === "attribute"
                          ? `${attributeLabels[e.attribute]} ${e.before} → ${e.after}`
                          : e.type === "resource"
                            ? `${e.resource === "hp" ? "生命" : "物资"} ${e.before} → ${e.after}`
                            : e.type === "fact"
                              ? e.text
                              : e.type === "item"
                                ? `${e.label} ×${e.quantity}`
                                : e.type === "stage"
                                  ? `${e.timeout ? "仓促转场" : "进入下一阶段"}`
                                  : ""}
                      </span>
                    ))}
                </div>
              </section>
            ) : (
              <p>尚未行动，骰子还在桌上。</p>
            )
          }
          history={<DialogueLog state={state} request={request} />}
          journal={
            <section className="journal">
              <div>
                <div className="character-name">
                  {state.script?.roleNames?.player
                    ? `${state.script.roleNames.player.replace(/（你）|\(你\)/g, "")}（你）`
                    : state.character.name}
                  {!state.script && state.character.background ? (
                    <small>{state.character.background}</small>
                  ) : null}
                </div>
                {!state.script ? (
                  <div className="resources">
                    <div>
                      <span>生命</span>
                      <b>
                        {state.hp}
                        <small>/10</small>
                      </b>
                      <meter min={0} max={10} value={state.hp} />
                    </div>
                    <div>
                      <span>物资</span>
                      <b>
                        {state.supplies}
                        <small>/5</small>
                      </b>
                      <meter min={0} max={5} value={state.supplies} />
                    </div>
                  </div>
                ) : null}
                <div className="stats">
                  {attributes.map((a) => (
                    <div key={a}>
                      <span>{attributeLabels[a]}</span>
                      <b>
                        {state.script?.effectiveStats[a] ??
                          state.character.stats[a]}
                      </b>
                      {state.script ? (
                        <small>基础 {state.character.stats[a]}</small>
                      ) : null}
                    </div>
                  ))}
                </div>
                {state.prepared ? (
                  <p className="condition">已准备 · 下个有骰检定 +1</p>
                ) : null}
                {state.injured ? (
                  <p className="condition injured">受伤 · 体魄与身手 −1</p>
                ) : null}
                {!state.script ? (
                  <>
                    <h3>背包</h3>
                    {state.items.length ? (
                      state.items.map((i) => (
                        <p key={i.id} className="item">
                          {i.label}
                          <span>×{i.quantity}</span>
                        </p>
                      ))
                    ) : (
                      <p className="muted">暂时没有物品。</p>
                    )}
                  </>
                ) : null}
                <h3>已知线索</h3>
                {state.script?.branching ? (
                  <div className="milestones">
                    {state.script.milestones?.length ? (
                      state.script.milestones.map((m) => (
                        <p key={m.id}>✓ {m.label}</p>
                      ))
                    ) : (
                      <p className="muted">
                        做出关键选择后，相关线索会记在这里。
                      </p>
                    )}
                  </div>
                ) : null}
                <ol className="facts">
                  {state.facts.map((f) => (
                    <li key={f.id}>{f.text}</li>
                  ))}
                </ol>
                <p className="save-note">
                  进度自动保存
                  <br />
                  读线索不消耗行动
                </p>
              </div>
            </section>
          }
        />
      ) : null}
      {practice && state?.script?.activity ? (
        <MiniGame
          state={state}
          request={request}
          onClose={() => setPractice(false)}
          onState={(next) => {
            for (const suffix of ["", ":furthest"]) {
              const value = sessionStorage.getItem(
                `snail:reading:${state.id}:${state.version}${suffix}`,
              );
              if (value !== null)
                sessionStorage.setItem(
                  `snail:reading:${next.id}:${next.version}${suffix}`,
                  value,
                );
            }
            setState(next);
            setProposal(null);
            setNotice("小游戏结果已保存。");
          }}
        />
      ) : null}
      {abandon ? (
        <Modal title="放弃这次故事？" onClose={() => setAbandon(false)}>
          <p>当前进度将停止，不能继续这一局。新故事会重新分配属性和掷骰。</p>
          <div className="button-row">
            <button className="secondary" onClick={() => setAbandon(false)}>
              继续保留存档
            </button>
            <button
              className="danger-option"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  if (state)
                    await request(`sessions/${state.id}/abandon`, {
                      expectedStateVersion: state.version,
                      confirm: true,
                    });
                  setState(null);
                  setTurns([]);
                  setProposal(null);
                  setPending(null);
                  sessionStorage.removeItem("snail:pending");
                  localStorage.removeItem("snail:last-game");
                  setAbandon(false);
                  setPage("create");
                })
              }
            >
              确认放弃并新开局
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
