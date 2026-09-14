"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendFrame,
  decision,
  frame,
  FRAME_MS,
  playPixel,
  type PixelGame,
  type Item,
  type DuelEvent,
  type PixelState,
} from "@/domain/pixel-arcade";
import { arcadeDifficultyNames } from "@/domain/arcade-difficulty";
import { gameNames } from "@/domain/arcade";
import type { ArcadeBoardProps } from "./ArcadeBoard";
import { paintPixel, duelEventLabel } from "./pixel-painter";
const instructions: Record<PixelGame, string[]> = {
  summit: [
    "跳过浮岛，抵达金色旗帜。落地恢复冲刺，跌落从最近的落脚点重来。",
    "← → / A D 移动，空格或 Z 跳跃，Shift 或 X 冲刺。你有两条生命。",
  ],
  flight: [
    "拍动翅膀穿过十道石门，碰到障碍或上下边界就会结束。",
    "轻点画面、拍翅按钮或空格；松手下落。别急着连点，找准节奏。",
  ],
  roulette: [
    "你和对手各有三格生命。每轮随机装入三至五枚弹药，实弹与空弹的数量公开，顺序未知。",
    "朝自己打出空弹，可以继续行动；其余试射交给对手。急救包回一血，放大镜看下一枚，手铐跳过对方一次行动。每轮双方补给两件道具，未使用的可留到下轮，每人最多八件。",
  ],
  rally: [
    "召集六位伙伴后，前往右下角的金色集合点。巡逻员每两步随机移动一次，第三次碰撞结束。",
    "方向键 / WASD 移动，空格呼哨：招呼两格内的伙伴，并让巡逻员停三步。你有三次呼哨，240步内完成集合。",
  ],
};
const itemNames: Record<Item, string> = {
  heal: "急救包",
  peek: "放大镜",
  cuff: "手铐",
};
const itemIcons: Record<Item, string> = { heal: "✚", peek: "⌕", cuff: "∞" };
const EVENT_MS = 1200;
type Reveal = { index: number; elapsed: number; events: DuelEvent[] };
export function PixelArcadeBoard({
  game,
  spec,
  challengeId,
  onFinish,
  disabled,
  practice = false,
}: ArcadeBoardProps & { game: PixelGame }) {
  const key = `snail:arcade:${challengeId}`;
  const [initial] = useState(() => {
    let moves: number[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      if (Array.isArray(saved) && saved.length <= 512) moves = saved;
    } catch {}
    let state = playPixel(
      game,
      spec.seed,
      moves,
      spec.difficulty,
      spec.rulesVersion ?? (spec.difficulty ? 2 : 1),
    );
    if (!state.valid) {
      moves = [];
      state = playPixel(
        game,
        spec.seed,
        [],
        spec.difficulty,
        spec.rulesVersion ?? (spec.difficulty ? 2 : 1),
      );
    }
    let reveal: Reveal | null = null;
    const view = structuredClone(state);
    try {
      const stored = sessionStorage.getItem(`${key}:reveal`),
        index = stored === null ? -1 : Number(stored);
      if (
        game === "roulette" &&
        moves.length &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < state.events.length
      ) {
        reveal = { index, elapsed: 0, events: state.events };
        view.duel = structuredClone(
          index
            ? state.events[index - 1].after
            : playPixel(
                game,
                spec.seed,
                moves.slice(0, -1),
                spec.difficulty,
                spec.rulesVersion ?? (spec.difficulty ? 2 : 1),
              ).duel,
        );
        view.finished = false;
      }
    } catch {}
    return { state, moves, view, reveal };
  });
  const state = useRef(initial.state),
    view = useRef(initial.view),
    moves = useRef(initial.moves),
    reveal = useRef(initial.reveal);
  const input = useRef(0),
    pulse = useRef(0),
    canvas = useRef<HTMLCanvasElement>(null),
    reported = useRef(false);
  const [snapshot, setSnapshot] = useState(initial.view),
    [running, setRunning] = useState(false),
    [entered, setEntered] = useState(false),
    [help, setHelp] = useState(false),
    [animating, setAnimating] = useState(!!initial.reveal),
    [eventLabel, setEventLabel] = useState(() =>
      initial.reveal
        ? duelEventLabel(initial.reveal.events[initial.reveal.index])
        : "",
    );
  const [inventory, setInventory] = useState(false);
  const realtime = game === "summit" || game === "flight";
  const persist = useCallback(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(moves.current));
      if (reveal.current)
        sessionStorage.setItem(`${key}:reveal`, String(reveal.current.index));
      else sessionStorage.removeItem(`${key}:reveal`);
    } catch {}
  }, [key]);
  const redraw = useCallback(() => {
    const ctx = canvas.current?.getContext("2d"),
      r = reveal.current;
    const reduce =
      !!canvas.current?.closest(".reduced-motion") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const progress = r ? r.elapsed / EVENT_MS : 0;
    if (ctx)
      paintPixel(
        ctx,
        view.current,
        r
          ? {
              event: r.events[r.index],
              progress: reduce ? (progress < 0.5 ? 0.35 : 0.85) : progress,
            }
          : undefined,
      );
  }, []);
  const refresh = useCallback(() => {
    setSnapshot(structuredClone(view.current));
    redraw();
    persist();
  }, [redraw, persist]);
  const act = useCallback(
    (move: number) => {
      if (
        disabled ||
        !running ||
        state.current.finished ||
        reported.current ||
        realtime ||
        reveal.current
      )
        return;
      setInventory(false);
      const before = structuredClone(state.current),
        next = structuredClone(before);
      decision(next, move);
      if (!next.valid) return;
      state.current = next;
      moves.current.push(move);
      if (game === "roulette" && next.events.length) {
        reveal.current = { index: 0, elapsed: 0, events: next.events };
        view.current = before;
        setAnimating(true);
        setEventLabel(duelEventLabel(next.events[0]));
      } else view.current = next;
      refresh();
    },
    [disabled, running, realtime, game, refresh],
  );
  useEffect(() => {
    redraw();
    return () => {
      if (practice) {
        try {
          sessionStorage.removeItem(key);
          sessionStorage.removeItem(`${key}:reveal`);
        } catch {}
      } else persist();
    };
  }, [redraw, persist, key, practice]);
  useEffect(() => {
    const pause = () => {
      input.current = pulse.current = 0;
      setRunning(false);
      persist();
    };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", pause);
    return () => {
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", pause);
    };
  }, [persist]);
  useEffect(() => {
    if (!running || disabled) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const r = reveal.current;
      if (r) {
        r.elapsed += FRAME_MS;
        redraw();
        if (r.elapsed >= EVENT_MS) {
          view.current.duel = structuredClone(r.events[r.index].after);
          r.index++;
          r.elapsed = 0;
          if (r.index >= r.events.length) {
            reveal.current = null;
            view.current = structuredClone(state.current);
            setAnimating(false);
            setEventLabel("");
          } else setEventLabel(duelEventLabel(r.events[r.index]));
          refresh();
        }
        return;
      }
      if (!realtime || state.current.finished) return;
      const command =
        game === "flight"
          ? pulse.current
            ? 1
            : 0
          : input.current | pulse.current;
      pulse.current = 0;
      if (moves.current.length >= 511) {
        setRunning(false);
        return;
      }
      frame(state.current, command);
      appendFrame(moves.current, command);
      view.current = state.current;
      redraw();
      if (state.current.tick % 6 === 0 || state.current.finished) refresh();
    }, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [running, disabled, realtime, game, refresh, redraw]);
  useEffect(() => {
    const directions: Record<string, number> = {
      ArrowUp: 0,
      KeyW: 0,
      ArrowRight: 1,
      KeyD: 1,
      ArrowDown: 2,
      KeyS: 2,
      ArrowLeft: 3,
      KeyA: 3,
    };
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.code === "Tab") return;
      if (e.code === "Escape" && entered && running) {
        e.preventDefault();
        e.stopPropagation();
        setRunning(false);
        input.current = pulse.current = 0;
        persist();
        return;
      }
      if (!running) return;
      if (
        !(e.code in directions) &&
        !["Space", "KeyZ", "KeyX", "ShiftLeft", "ShiftRight"].includes(e.code)
      )
        return;
      if (game === "roulette") return;
      e.preventDefault();
      e.stopPropagation();
      if (disabled || state.current.finished) return;
      if (game === "rally") {
        if (!e.repeat) act(e.code in directions ? directions[e.code] : 4);
      } else if (game === "flight") {
        if (!e.repeat && ["Space", "KeyZ", "ArrowUp"].includes(e.code))
          pulse.current = 1;
      } else {
        if (["ArrowLeft", "KeyA"].includes(e.code)) input.current |= 1;
        if (["ArrowRight", "KeyD"].includes(e.code)) input.current |= 2;
        if (!e.repeat && ["Space", "KeyZ", "ArrowUp"].includes(e.code))
          pulse.current |= 4;
        if (!e.repeat && ["KeyX", "ShiftLeft", "ShiftRight"].includes(e.code))
          pulse.current |= 8;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (["ArrowLeft", "KeyA"].includes(e.code)) input.current &= ~1;
      if (["ArrowRight", "KeyD"].includes(e.code)) input.current &= ~2;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up);
      input.current = pulse.current = 0;
    };
  }, [game, disabled, running, entered, act, persist]);
  const end = () => {
    if (!moves.current.length || reported.current || reveal.current) return;
    reported.current = true;
    setRunning(false);
    persist();
    onFinish([...moves.current]);
  };
  const begin = () => {
    input.current = pulse.current = 0;
    setEntered(true);
    setHelp(false);
    setRunning(true);
    canvas.current?.focus({ preventScroll: true });
    if (window.innerWidth <= 650)
      canvas.current?.parentElement?.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
  };
  const inactive = disabled || !running || snapshot.finished || animating;
  const tap = (label: string, glyph: string, code: number) => (
    <button
      aria-label={label}
      title={label}
      disabled={inactive}
      onPointerDown={(e) => {
        e.preventDefault();
        pulse.current |= code;
      }}
      onClick={(e) => {
        if (e.detail === 0) pulse.current |= code;
      }}
    >
      {glyph}
    </button>
  );
  const hold = (label: string, glyph: string, code: number) => (
    <button
      aria-label={label}
      title={label}
      disabled={inactive}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        input.current |= code;
      }}
      onPointerUp={() => {
        input.current &= ~code;
      }}
      onPointerCancel={() => {
        input.current &= ~code;
      }}
      onLostPointerCapture={() => {
        input.current &= ~code;
      }}
    >
      {glyph}
    </button>
  );
  const d = snapshot.duel,
    live = d.shells.reduce((a, b) => a + b, 0);
  const complete = snapshot.finished && !animating;
  return (
    <div
      className={`arcade pixel-arcade arcade-${game}`}
      data-seed={spec.seed}
      data-difficulty={spec.difficulty ?? "legacy"}
      data-tick={snapshot.tick}
      data-animating={animating}
    >
      <div
        className={`pixel-screen pixel-screen-v2 ${game === "roulette" ? "duel-screen" : ""}`}
      >
        <canvas
          ref={canvas}
          width={480}
          height={288}
          tabIndex={0}
          aria-label={
            game === "summit"
              ? "像素跳跃地图"
              : game === "flight"
                ? "像素飞行地图"
                : game === "rally"
                  ? "像素街区地图"
                  : "像素对决桌面"
          }
          onPointerDown={(e) => {
            e.currentTarget.focus({ preventScroll: true });
            if (game === "flight" && running && !complete) pulse.current = 1;
          }}
        />
        {entered ? (
          <div className="pixel-topbar">
            <div className="pixel-hud" aria-live="off">
              {game === "summit" ? (
                <span>
                  ♥ {Math.max(0, (spec.difficulty ? 2 : 4) - snapshot.hits)}　⚑{" "}
                  {snapshot.score + 1}/9　{snapshot.dash ? "◆" : "◇"}
                </span>
              ) : null}
              {game === "flight" ? <span>⚑ {snapshot.score}/10</span> : null}
              {game === "rally" ? (
                <span>
                  ♟ {snapshot.score}/6　♥ {3 - snapshot.hits}　余{" "}
                  {240 - snapshot.tick} 步
                </span>
              ) : null}
              {game === "roulette" ? (
                <span>
                  实弹 {live} · 空弹 {d.shells.length - live}　/　第{d.round}轮
                </span>
              ) : null}
            </div>
            <button
              className="pixel-pause-button"
              aria-label="暂停"
              onClick={() => {
                setRunning(false);
                input.current = pulse.current = 0;
                refresh();
              }}
            >
              Ⅱ
            </button>
          </div>
        ) : null}
        {entered && !complete ? (
          <>
            {game === "summit" ? (
              <div className="pixel-controls pixel-bottom-controls">
                <div>
                  {hold("← 左移", "←", 1)}
                  {hold("右移 →", "→", 2)}
                </div>
                <div>
                  {tap("跳跃 Z", "↥", 4)}
                  {tap("冲刺 Shift / X", "⇢", 8)}
                </div>
              </div>
            ) : null}
            {game === "flight" ? (
              <div className="pixel-controls pixel-bottom-controls flight-controls">
                {tap("拍动翅膀", "↥", 1)}
              </div>
            ) : null}
            {game === "rally" ? (
              <div className="pixel-controls pixel-bottom-controls">
                <div>
                  {["↑", "→", "↓", "←"].map((glyph, i) => (
                    <button
                      key={i}
                      aria-label={["↑ 上移", "右移 →", "↓ 下移", "← 左移"][i]}
                      disabled={inactive}
                      onClick={() => act(i)}
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
                <button
                  aria-label={`呼哨 (${snapshot.whistles})`}
                  disabled={inactive || !snapshot.whistles}
                  onClick={() => act(4)}
                >
                  ◉ {snapshot.whistles}
                </button>
              </div>
            ) : null}
            {game === "roulette" ? (
              <div className="duel-controls">
                <div className="duel-turn" aria-live="polite">
                  {animating ? eventLabel : "轮到你"}
                </div>
                <div className="duel-targets pixel-controls">
                  <button disabled={inactive} onClick={() => act(0)}>
                    朝对手试射
                  </button>
                  <button disabled={inactive} onClick={() => act(1)}>
                    朝自己试射
                  </button>
                </div>
                <button
                  className="duel-inventory-toggle"
                  disabled={inactive}
                  onClick={() => setInventory((v) => !v)}
                >
                  道具 {d.items[0].length}/8
                </button>
                {inventory ? (
                  <div
                    className="duel-items pixel-controls"
                    aria-label="道具栏"
                  >
                    {d.items[0].map((item, i) => (
                      <button
                        key={`${snapshot.tick}-${i}`}
                        aria-label={itemNames[item]}
                        title={itemNames[item]}
                        disabled={
                          inactive ||
                          (item === "heal" && d.hp[0] === 3) ||
                          (item === "peek" && d.known[0] !== null) ||
                          (item === "cuff" && (d.cuffUsed[0] || d.locked[1]))
                        }
                        onClick={() => act(i + 2)}
                      >
                        {itemIcons[item]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        {!entered || (!running && !complete) ? (
          <div
            className="pixel-start"
            role="region"
            aria-label={entered ? "暂停菜单" : "小游戏说明"}
          >
            <span className="pixel-kicker">
              {arcadeDifficultyNames[spec.difficulty ?? "normal"]}
            </span>
            <h2>{entered ? "稍歇片刻" : gameNames[game]}</h2>
            {!entered || help ? (
              <div className="arcade-instruction">
                {instructions[game].map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
            <button className="primary" onClick={begin} disabled={disabled}>
              {moves.current.length || entered ? "继续挑战" : "开始挑战"}
            </button>
            {entered ? (
              <button className="pixel-link" onClick={() => setHelp(!help)}>
                {help ? "收起说明" : "玩法说明"}
              </button>
            ) : null}
            {entered && moves.current.length && !animating ? (
              <button className="pixel-link" disabled={disabled} onClick={end}>
                {practice ? "结束这局" : "认输并继续故事"}
              </button>
            ) : null}
          </div>
        ) : null}
        {complete && entered ? (
          <div className="pixel-result-panel">
            <p className="pixel-result" role="status">
              {snapshot.success ? "挑战成功" : "下次再来"}
            </p>
            <button className="primary" disabled={disabled} onClick={end}>
              {practice ? "查看成绩" : "继续故事"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
