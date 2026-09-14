"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicState, PublicTurn } from "@/domain/types";
import {
  actors,
  expressions,
  expressionLabels,
  makeBeats,
  portrait,
  rooms,
  type ActorId,
  type Expression,
  type Room,
} from "./presentation";
import { Scene } from "./Scene";
import { Portrait } from "./Portrait";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

export function VisualNovel({
  state,
  latest,
  live,
  busy,
  actions,
  journal,
  history,
  result,
  settings,
  onHome,
  hasPending,
  onPractice,
}: {
  state: PublicState;
  latest?: PublicTurn;
  live: boolean;
  busy: boolean;
  actions: ReactNode;
  journal: ReactNode;
  history: ReactNode;
  result: ReactNode;
  settings: ReactNode;
  onHome: () => void;
  hasPending: boolean;
  onPractice?: () => void;
}) {
  const [beats, setBeats] = useState(() => makeBeats(state, latest, live));
  const [cursor, setCursor] = useState(0),
    [restored, setRestored] = useState(false);
  const [panel, setPanel] = useState<
    "actions" | "journal" | "history" | "settings" | "cast" | "result" | null
  >(hasPending ? "actions" : null);
  const [room, setRoom] = useState<Room>(state.ending ? "lounge" : "table");
  const [clean, setClean] = useState(false),
    [auto, setAuto] = useState(false);
  const [castActor, setCastActor] = useState<ActorId>("gm"),
    [face, setFace] = useState<Expression>("neutral");
  const awaitingStory =
    live && !!latest && ["pending", "running"].includes(latest.narrationStatus);
  useEffect(() => {
    if (
      latest?.narrationStatus === "ready" ||
      latest?.narrationStatus === "fallback"
    ) {
      setBeats(makeBeats(state, latest, live));
      if (live) setCursor(0);
    }
  }, [latest?.narrationStatus]);
  const [readThrough, setReadThrough] = useState(-1);
  const readKey = `snail:reading:${state.id}:${state.version}`;
  const wasPending = useRef(hasPending);
  useEffect(() => {
    if (wasPending.current && !hasPending) setPanel(null);
    wasPending.current = hasPending;
  }, [hasPending]);
  useEffect(() => {
    const n = Number(sessionStorage.getItem(readKey) ?? 0);
    setCursor(
      Number.isInteger(n) ? Math.max(0, Math.min(n, beats.length - 1)) : 0,
    );
    const furthest = Number(sessionStorage.getItem(`${readKey}:furthest`) ?? n);
    setReadThrough(
      Number.isInteger(furthest)
        ? Math.min(beats.length - 1, Math.max(n, furthest))
        : -1,
    );
    setRestored(true);
  }, [readKey, beats.length]);
  useEffect(() => {
    if (restored) {
      sessionStorage.setItem(readKey, String(cursor));
      setReadThrough((n) => Math.max(n, cursor));
      const previous = Number(
        sessionStorage.getItem(`${readKey}:furthest`) ?? -1,
      );
      sessionStorage.setItem(
        `${readKey}:furthest`,
        String(Math.max(previous, cursor)),
      );
    }
  }, [cursor, readKey, restored]);
  const beat = beats[cursor] ?? beats[0];
  const last = cursor === beats.length - 1;
  const readComplete =
    restored &&
    readThrough >= beats.length - 1 &&
    !awaitingStory &&
    !(
      state.script?.activity?.game &&
      state.script.activity.status === 0 &&
      state.status === "playing"
    );
  const activityReady =
    !!state.script?.activity &&
    state.script.activity.status === 0 &&
    state.status === "playing" &&
    restored &&
    (state.script?.activity?.game ? cursor : readThrough) >=
      Math.max(0, beats.length - state.script.opening.length) +
        state.script.activity.afterLine -
        1;
  function next() {
    if (awaitingStory) return;
    if (state.script?.activity?.game && activityReady) {
      setAuto(false);
      if (!busy && !hasPending) onPractice?.();
      return;
    }
    if (!last) setCursor((n) => n + 1);
    else {
      setAuto(false);
      if (state.status === "playing") setPanel("actions");
      else setPanel("result");
    }
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        document.querySelector("dialog[open]") ||
        (e.target instanceof HTMLElement &&
          e.target.closest("button,input,textarea,select,a,summary"))
      )
        return;
      if (e.key === "Escape") {
        setClean(false);
        setAuto(false);
      }
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        if (!clean) next();
      }
      if (e.key === "ArrowLeft" && !clean) {
        e.preventDefault();
        setCursor((n) => Math.max(0, n - 1));
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (!auto || panel || clean || last || awaitingStory) return;
    const timer = setTimeout(
      () => next(),
      Math.max(2500, Array.from(beat.text).length * 150),
    );
    return () => clearTimeout(timer);
  }, [
    auto,
    panel,
    clean,
    cursor,
    last,
    beat.text,
    beats.length,
    awaitingStory,
  ]);
  const names = {
    actions: "接下来，你想怎么做？",
    journal: "角色与随身手记",
    history: "这一路的记录",
    settings: "阅读设置",
    cast: "同桌的伙伴",
    result: state.ending ? "这一局的答案" : "本回合结果",
  };
  return (
    <section
      className={`vn-screen ${clean ? "ui-hidden" : ""}`}
      aria-label="跑团游戏"
    >
      <Scene room={room} clean={clean} />
      <header className="vn-header">
        <div className="chapter-plaque">
          <Icon name="dice" />
          <div>
            <span>
              {state.script?.branching
                ? `第 ${state.turn + 1} 段 · 分支故事`
                : `第 ${state.stage.number} 阶段 / ${state.script?.stageCount ?? 6}`}
            </span>
            <h1>{state.stage.title}</h1>
            {state.scenarioVersion?.startsWith("curated-") &&
            /-1\.[01]$/.test(state.scenarioVersion) ? (
              <small>旧版存档 · 书架新开故事可读修订版</small>
            ) : null}
          </div>
        </div>
        <nav className="vn-nav" aria-label="游戏菜单">
          <button onClick={() => setPanel("history")}>
            <Icon name="book" />
            <span>记录</span>
          </button>
          <button onClick={() => setPanel("journal")}>
            <Icon name="user" />
            <span>角色</span>
          </button>
          <button onClick={() => setPanel("settings")}>
            <Icon name="settings" />
            <span>设置</span>
          </button>
        </nav>
      </header>
      <div className="world-caption">
        <span>{rooms[room]}</span>
        <span>剧中 · {state.render.sceneLabel}</span>
      </div>
      <div className="vn-bottom">
        <div className="table-status">
          {state.progress ? (
            <span className="story-progress">
              伙伴协作 {state.progress.community}/4 · 远行筹备{" "}
              {state.progress.readiness}/4
            </span>
          ) : null}
          <div className="progress">
            第{state.turn}回合 · {busy ? "处理中" : "已保存"}
            <span>
              {state.status === "playing"
                ? state.script
                  ? state.script.branching
                    ? "一个关键选择 · 决定故事去向"
                    : `支线 ${state.script.sideRemaining}次 · 关键行动 1次`
                  : `行动 ${state.remaining}/${state.stage.budget}`
                : "本局结束"}
            </span>
          </div>
          <button onClick={() => setPanel("journal")}>
            {state.script
              ? "查看角色属性"
              : `生命 ${state.hp}/10 · 物资 ${state.supplies}`}
          </button>
        </div>
        <section
          className={`dialogue-box ${!awaitingStory && (beat.speaker === "hero_f" || beat.speaker === "hero_m") ? "player-speaking" : ""}`}
          aria-label="剧情对话"
        >
          <Portrait
            actor={awaitingStory ? "gm" : beat.speaker}
            expression={awaitingStory ? "neutral" : beat.expression}
            className="portrait active-speaker speaking"
            label={`${beat.label} · 正在发言`}
          />
          <div className="speaker-tag">
            {awaitingStory ? "猫咪城主" : beat.label}
          </div>
          <div
            className="dialogue-prose"
            aria-live="polite"
            key={`${cursor}:${beat.text}`}
          >
            <p>
              {awaitingStory ? "行动已保存，正在翻开下一段故事…" : beat.text}
            </p>
          </div>
          <button
            className="advance"
            disabled={awaitingStory}
            onClick={next}
            aria-label={
              last ? (state.ending ? "查看结局" : "选择行动") : "继续对话"
            }
          >
            <Icon name="next" />
          </button>
          <div className="dialogue-foot">
            <span>
              {awaitingStory ? "正在演出…" : `${cursor + 1} / ${beats.length}`}
            </span>
            <span>
              {awaitingStory
                ? "请稍候"
                : latest?.narrationStatus === "fallback"
                  ? "已显示保存的行动结果"
                  : last
                    ? "本段读完了"
                    : "点击箭头 / 空格继续"}
            </span>
          </div>
        </section>
        <nav className="reading-controls" aria-label="阅读控制">
          <button
            disabled={cursor === 0 || awaitingStory}
            onClick={() => setCursor((n) => n - 1)}
          >
            上一段
          </button>
          <button aria-pressed={auto} onClick={() => setAuto((v) => !v)}>
            {auto ? "暂停自动" : "自动阅读"}
          </button>
          <button
            onClick={() => {
              setClean(true);
              setAuto(false);
            }}
          >
            欣赏画面
          </button>
          <button onClick={() => setPanel("cast")}>同桌伙伴</button>
          {activityReady && !state.script?.activity?.game ? (
            <button
              className="practice-shortcut"
              disabled={busy || hasPending}
              onClick={() => {
                setAuto(false);
                onPractice?.();
              }}
            >
              可选小练习 · {state.script!.activity!.title}
            </button>
          ) : null}
          {latest ? (
            <button onClick={() => setPanel("result")}>本回合骰点</button>
          ) : null}
          {!state.script &&
          (live || state.scenarioVersion?.startsWith("homecoming")) &&
          latest?.narrationStatus === "ready" ? (
            <button
              onClick={() => {
                setBeats(makeBeats(state, latest, true));
                setCursor(0);
              }}
            >
              重读这一段
            </button>
          ) : null}
          <button
            className="action-shortcut"
            disabled={awaitingStory || (!readComplete && !hasPending)}
            title={!readComplete ? "读完本段对白后才能决定行动" : undefined}
            onClick={() => {
              if (!readComplete && !hasPending) return;
              setAuto(false);
              setPanel(state.status === "playing" ? "actions" : "result");
            }}
          >
            {hasPending
              ? "查看上次行动"
              : !readComplete
                ? "先读完本段"
                : state.status === "playing"
                  ? "决定行动"
                  : "查看结局"}
            <Icon name="next" />
          </button>
        </nav>
      </div>
      {clean ? (
        <button className="restore-ui" onClick={() => setClean(false)}>
          返回对话
        </button>
      ) : null}
      {panel ? (
        <Modal
          title={names[panel]}
          onClose={() => setPanel(null)}
          className={panel === "actions" ? "action-modal" : ""}
        >
          {panel === "actions" ? actions : null}
          {panel === "journal" ? journal : null}
          {panel === "history" ? history : null}
          {panel === "result" ? (
            <>
              {result}
              {state.ending && readComplete ? (
                <article className="ending">
                  <span>{state.ending.label ?? "猫咪城主 · 散场讲述"}</span>
                  <h3>{state.ending.title}</h3>
                  {state.script ? (
                    <p>结局已在对话中完整播放，可打开“记录”回看。</p>
                  ) : (
                    state.ending.text
                      .split("\n\n")
                      .map((p, i) => <p key={i}>{p}</p>)
                  )}
                  <button className="primary" onClick={onHome}>
                    回到封面
                  </button>
                </article>
              ) : null}
            </>
          ) : null}
          {panel === "settings" ? (
            <>
              {settings}
              <h3>桌边视角</h3>
              <div className="room-buttons">
                {(Object.keys(rooms) as Room[]).map((id) => (
                  <button
                    key={id}
                    aria-pressed={room === id}
                    onClick={() => setRoom(id)}
                  >
                    {rooms[id]}
                  </button>
                ))}
              </div>
              <p className="muted">这里切换的是跑团房间，不会改变故事进度。</p>
              <button className="secondary" onClick={onHome}>
                <Icon name="home" />
                返回封面，保留存档
              </button>
            </>
          ) : null}
          {panel === "cast" ? (
            <div className="cast-gallery">
              <div className="cast-selector">
                {(Object.keys(actors) as ActorId[]).map((id) => (
                  <button
                    key={id}
                    aria-pressed={castActor === id}
                    onClick={() => setCastActor(id)}
                  >
                    {actors[id].name}
                  </button>
                ))}
              </div>
              <Portrait
                actor={castActor}
                expression={face}
                label={`${actors[castActor].name}表情立绘`}
              />
              <h3>
                {actors[castActor].name} <small>{actors[castActor].role}</small>
              </h3>
              <p>{actors[castActor].description}</p>
              <div className="cast-selector">
                {expressions.map((id, i) => (
                  <button
                    key={id}
                    aria-pressed={face === id}
                    onClick={() => setFace(id)}
                  >
                    {expressionLabels[i]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}
