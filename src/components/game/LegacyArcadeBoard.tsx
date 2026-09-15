"use client";
import { sessionCache } from "./browser-storage";
import { useEffect, useRef, useState } from "react";
import {
  fallingLane,
  playArcade,
  timedGames,
  type ArcadeSpec,
} from "@/domain/arcade";
const instructions: Partial<Record<ArcadeSpec["game"], string>> = {
  sokoban: "方向键或下方箭头移动，把木箱推到星形货位。箱子只能推，不能拉。",
  hanoi:
    "点一根柱子拿起最上面的货盘，再点另一根放下。大盘不能压小盘，把整塔搬到右边。",
  dodge: "左右移动小船，避开落石。坚持到航道尽头，碰撞不超过两次即成功。",
  catch: "左右移动篮子接星星。十二颗星星中接住八颗就能完成。",
  pipes: "点击管件旋转，让左上水源连到右下花园，连通全部五块管件。",
  slide: "点击空格旁的碎片移动，拼回完整星图。角标显示碎片原来的位置。",
  rhythm:
    "光球到达金色拍线时按空格或拍手按钮。十二拍命中八拍，抢拍不超过四次即成功。",
  memory:
    "每次翻开两张，找到六对相同的头像。记住刚才翻过的位置，十六次配对机会内全部找到就成功。",
  groups:
    "点击至少两枚相连的同色伙伴，让它们一起离场。剩下的会落下并靠左集合，目标全部离场。",
};
export function LegacyArcadeBoard({
  spec,
  challengeId,
  onFinish,
  disabled,
  practice = false,
}: {
  spec: ArcadeSpec;
  challengeId: string;
  onFinish: (moves: number[]) => void;
  disabled: boolean;
  practice?: boolean;
}) {
  const key = `snail:arcade:${challengeId}`;
  const [moves, setMoves] = useState<number[]>(() => {
    try {
      const n = JSON.parse(sessionCache.getItem(key) ?? "[]");
      return Array.isArray(n) &&
        n.length <= 512 &&
        n.every(Number.isSafeInteger)
        ? n
        : [];
    } catch {
      return [];
    }
  });
  const [running, setRunning] = useState(false);
  const state = playArcade(spec, moves),
    stateRef = useRef(state),
    lane = useRef(state.player),
    tap = useRef(0),
    reported = useRef(false);
  stateRef.current = state;
  const timed = timedGames.has(spec.game);
  function act(n: number) {
    if (disabled || stateRef.current.finished) return;
    setMoves((m) => (m.length < 512 ? [...m, n] : m));
  }
  function shift(d: number) {
    lane.current = Math.max(0, Math.min(2, lane.current + d));
  }
  useEffect(() => {
    sessionCache.setItem(key, JSON.stringify(moves));
    if ((state.finished || moves.length === 512) && !reported.current) {
      reported.current = true;
      setRunning(false);
      onFinish(moves);
    }
  }, [moves]);
  useEffect(() => {
    if (!running || disabled) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (spec.game === "rhythm") {
        act(tap.current);
        tap.current = 0;
      } else {
        const p = stateRef.current.player;
        act(Math.max(p - 1, Math.min(p + 1, lane.current)));
      }
    }, 160);
    return () => clearInterval(timer);
  }, [running, disabled, spec.game]);
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape") return;
      const n = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].indexOf(
        e.key,
      );
      if (n >= 0) {
        e.preventDefault();
        if (spec.game === "sokoban") act(n);
        else if (timed) {
          if (n === 1) shift(1);
          if (n === 3) shift(-1);
        } else if (spec.game === "slide") {
          const empty = stateRef.current.board.indexOf(0);
          const dest = empty + [-3, 1, 3, -1][n];
          if (dest >= 0 && dest < 9) act(dest);
        }
      }
      if (e.key === " " && spec.game === "rhythm") {
        e.preventDefault();
        if (!e.repeat && running) tap.current = 1;
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [spec.game, running, disabled]);
  const arrow = (d: number, label: string) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled || state.finished}
      onClick={() => act(d)}
    >
      {["↑", "→", "↓", "←"][d]}
    </button>
  );
  return (
    <div className={`arcade arcade-${spec.game}`} data-seed={spec.seed}>
      <p className="arcade-instruction">{instructions[spec.game]}</p>
      {spec.game === "memory" ? (
        <>
          <p>
            已认识 {state.score}/6 对 · 剩余 {16 - state.tick} 次
          </p>
          <div className="arcade-grid four memory-board" aria-label="记忆翻牌">
            {state.board.map((v, i) => (
              <button
                key={i}
                aria-label={`翻开第${i + 1}张`}
                disabled={
                  disabled ||
                  state.matched.includes(i) ||
                  (state.revealed.includes(i) && state.revealed.length < 2)
                }
                className={state.matched.includes(i) ? "matched" : ""}
                onClick={() => act(i)}
              >
                {state.matched.includes(i) || state.revealed.includes(i)
                  ? ["🐱", "🐸", "🐼", "🐰", "🦊", "🐻"][v]
                  : "?"}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {spec.game === "sokoban" ? (
        <>
          <div className="arcade-grid five" aria-label="推箱子棋盘">
            {state.board.map((v, i) => (
              <div key={i} className={v === 1 ? "wall" : v === 2 ? "goal" : ""}>
                {state.player === i
                  ? "●"
                  : state.crates.includes(i)
                    ? "▣"
                    : v === 2
                      ? "★"
                      : ""}
              </div>
            ))}
          </div>
          <div className="arcade-pad">
            {arrow(3, "向左")}
            {arrow(0, "向上")}
            {arrow(2, "向下")}
            {arrow(1, "向右")}
          </div>
        </>
      ) : null}
      {spec.game === "hanoi" ? (
        <div className="tower-board">
          {state.towers.map((t, i) => (
            <button
              key={i}
              aria-label={`货柱${i + 1}`}
              aria-pressed={state.selected === i}
              onClick={() => act(i)}
              disabled={disabled}
            >
              <span className="pole" />
              {[...t].reverse().map((n) => (
                <span key={n} className={`disk disk-${n}`}>
                  {n === 1 ? "小" : n === 2 ? "中" : "大"}
                </span>
              ))}
              <small>{i === 2 ? "目标货位" : `货位 ${i + 1}`}</small>
            </button>
          ))}
        </div>
      ) : null}
      {spec.game === "pipes" ? (
        <div className="arcade-grid three pipe-board" aria-label="水路棋盘">
          {state.board.map((v, i) => (
            <button
              key={i}
              aria-label={`旋转管件${i + 1}`}
              disabled={!v || disabled}
              onClick={() => act(i)}
            >
              <svg viewBox="0 0 100 100" aria-hidden="true">
                {[1, 2, 4, 8].map((bit, d) =>
                  v & bit ? (
                    <path
                      key={bit}
                      d={
                        ["M50 50V0", "M50 50H100", "M50 50V100", "M50 50H0"][d]
                      }
                      stroke="#277985"
                      strokeWidth="18"
                    />
                  ) : null,
                )}
                {v ? <circle cx="50" cy="50" r="11" fill="#277985" /> : null}
              </svg>
              {i === 0 ? (
                <small>水源</small>
              ) : i === 8 ? (
                <small>花园</small>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {spec.game === "slide" ? (
        <div className="arcade-grid three slide-board" aria-label="星图拼图">
          {state.board.map((v, i) => (
            <button
              key={i}
              disabled={!v || disabled}
              aria-label={v ? `移动碎片${v}` : "空格"}
              className={!v ? "empty" : ""}
              onClick={() => act(i)}
              style={
                v
                  ? {
                      backgroundPosition: `${((v - 1) % 3) * 50}% ${Math.floor((v - 1) / 3) * 50}%`,
                    }
                  : undefined
              }
            >
              {v ? <span>{v}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {spec.game === "groups" ? (
        <div className="arcade-grid four group-board" aria-label="伙伴连消">
          {state.board.map((v, i) => (
            <button
              key={i}
              className={`group-${v}`}
              disabled={v < 0 || disabled}
              aria-label={`伙伴${i + 1}${v < 0 ? "空位" : ["橙色圆", "青色菱", "紫色星"][v]}`}
              onClick={() => act(i)}
            >
              {v < 0 ? "" : ["●", "◆", "★"][v]}
            </button>
          ))}
        </div>
      ) : null}
      {timed ? (
        <>
          <div
            className={`arcade-lanes ${spec.game === "rhythm" ? "rhythm-lane" : ""}`}
            aria-label="小游戏动画场地"
          >
            {spec.game === "rhythm" ? (
              <>
                <span className="beat-line" />
                <span
                  className="beat-orb"
                  style={{ left: `${10 + (state.tick % 6) * 16}%` }}
                >
                  ●
                </span>
                <span className="beat-guide">● → 拍线</span>
              </>
            ) : (
              <>
                <div className="lane-dividers" />
                {[0, 1].map((n) => {
                  const next = (Math.floor(state.tick / 6) + 1 + n) * 6;
                  return next > 72 ? null : (
                    <span
                      key={n}
                      className="falling-item"
                      style={{
                        left: `${fallingLane(spec, next) * 33.33 + 16.66}%`,
                        top: `${(6 - (next - state.tick)) * 13 + 12}%`,
                      }}
                    >
                      {spec.game === "catch" ? "★" : "◆"}
                    </span>
                  );
                })}
                <span
                  className="lane-player"
                  style={{ left: `${state.player * 33.33 + 16.66}%` }}
                >
                  {spec.game === "catch" ? "▰" : "▲"}
                </span>
              </>
            )}
          </div>
          <progress max={72} value={state.tick} aria-label="本局进度" />
          <p aria-live="off">
            命中／避开 {state.score} ·{" "}
            {spec.game === "dodge"
              ? "碰撞"
              : spec.game === "catch"
                ? "漏接"
                : "抢拍"}{" "}
            {state.hits}
          </p>
          {!running && !state.finished ? (
            <button className="primary" onClick={() => setRunning(true)}>
              开始／继续
            </button>
          ) : null}
          <div className="arcade-pad">
            {spec.game === "rhythm" ? (
              <button
                disabled={!running || disabled}
                onClick={() => {
                  tap.current = 1;
                }}
              >
                拍手 · 空格
              </button>
            ) : (
              <>
                <button aria-label="向左移动" onClick={() => shift(-1)}>
                  ←
                </button>
                <button aria-label="向右移动" onClick={() => shift(1)}>
                  →
                </button>
              </>
            )}
          </div>
          {running ? (
            <button onClick={() => setRunning(false)}>暂停</button>
          ) : null}
        </>
      ) : null}
      {!state.finished ? (
        <div className="arcade-tools">
          {!timed ? (
            <>
              <button
                disabled={disabled || !moves.length}
                onClick={() => setMoves((m) => m.slice(0, -1))}
              >
                撤回一步
              </button>
              <button
                disabled={disabled || !moves.length}
                onClick={() => setMoves([])}
              >
                重新摆盘
              </button>
            </>
          ) : null}
          <button
            disabled={disabled || !moves.length}
            onClick={() => {
              reported.current = true;
              setRunning(false);
              onFinish(moves);
            }}
          >
            {practice ? "结束这局试玩" : "认输并继续故事"}
          </button>
        </div>
      ) : null}
      {!moves.length ? (
        <small>
          {practice
            ? "试着操作看看，也可以随时重新开一局。"
            : "先试着操作一次；失败不会扣属性。"}
        </small>
      ) : null}
    </div>
  );
}
