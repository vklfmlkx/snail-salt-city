import type { Attribute } from "./types";
import type { ArcadeDifficulty } from "./arcade-difficulty";
import {
  pixelGames,
  isPixelGame,
  playPixel,
  type PixelState,
} from "./pixel-arcade";
export const arcadeGames = pixelGames;
const legacyGames = [
  "sokoban",
  "hanoi",
  "dodge",
  "catch",
  "pipes",
  "slide",
  "memory",
  "groups",
] as const;
// Existing challenges keep their original rules; only pixelGames are scheduled
// in the current catalog and offered in the playground.
export const storedArcadeGames = [
  ...arcadeGames,
  ...legacyGames,
  "rhythm",
] as const;
export type ArcadeGame = (typeof storedArcadeGames)[number];
export const gamesByAttribute: Record<Attribute, readonly ArcadeGame[]> = {
  body: ["summit", "sokoban", "hanoi"],
  agility: ["flight", "dodge", "catch"],
  mind: ["roulette", "pipes", "slide"],
  presence: ["rally", "memory", "groups", "rhythm"],
};
export const gameNames: Record<ArcadeGame, string> = {
  summit: "云巅小径",
  flight: "穿云信使",
  roulette: "弹仓对决",
  rally: "星夜领队",
  sokoban: "小小搬运工",
  hanoi: "货塔搬家",
  dodge: "穿过落石道",
  catch: "接住流星",
  pipes: "接通水路",
  slide: "拼回星图",
  rhythm: "节拍应援",
  memory: "记住新朋友",
  groups: "聚拢同色伙伴",
};
export type ArcadeSpec = {
  game: ArcadeGame;
  seed: number;
  difficulty?: ArcadeDifficulty;
  rulesVersion?: number;
};
export type ArcadeState = {
  pixel?: PixelState;
  board: number[];
  player: number;
  crates: number[];
  towers: number[][];
  selected: number;
  score: number;
  hits: number;
  tick: number;
  finished: boolean;
  success: boolean;
  valid: boolean;
  revealed: number[];
  matched: number[];
};
const delta = [-5, 1, 5, -1];
export const rotatePipe = (n: number) => ((n << 1) & 15) | (n >> 3);
export function initialArcade(c: ArcadeSpec): ArcadeState {
  let board: number[] = [];
  if (c.game === "memory") {
    board = Array.from({ length: 12 }, (_, i) => i % 6);
    let seed = c.seed >>> 0;
    for (let i = board.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [board[i], board[j]] = [board[j], board[i]];
    }
  }
  if (c.game === "sokoban")
    board = Array.from({ length: 25 }, (_, i) =>
      i < 5 || i > 19 || i % 5 === 0 || i % 5 === 4 ? 1 : i === 8 ? 2 : 0,
    );
  if (c.game === "pipes")
    board = [2, 12, 0, 0, 3, 12, 0, 0, 1].map((v, i) => {
      for (let k = 0; k < 1 + ((c.seed + i) % 3); k++) v = rotatePipe(v);
      return v;
    });
  if (c.game === "slide") {
    board = [1, 2, 3, 4, 5, 6, 7, 8, 0];
    let previous = -1;
    for (let n = 0; n < 22; n++) {
      const empty = board.indexOf(0);
      const choices = [empty - 3, empty + 1, empty + 3, empty - 1].filter(
        (i) =>
          i >= 0 &&
          i < 9 &&
          Math.abs((i % 3) - (empty % 3)) +
            Math.abs(Math.floor(i / 3) - Math.floor(empty / 3)) ===
            1 &&
          i !== previous,
      );
      const i = choices[(c.seed + n * 7) % choices.length];
      [board[empty], board[i]] = [board[i], board[empty]];
      previous = empty;
    }
  }
  if (c.game === "groups")
    board = [0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 2, 2, 0, 0, 2, 2].map(
      (n) => (n + c.seed) % 3,
    );
  return {
    board,
    player: c.game === "sokoban" ? 16 : 1,
    crates: [12],
    towers: [[3, 2, 1], [], []],
    selected: -1,
    score: 0,
    hits: 0,
    tick: 0,
    finished: false,
    success: false,
    valid: true,
    revealed: [],
    matched: [],
  };
}
export const timedGames = new Set<ArcadeGame>(["dodge", "catch", "rhythm"]);
export function fallingLane(c: ArcadeSpec, tick: number) {
  return (c.seed + Math.floor(tick / 6) * 2) % 3;
}
export function playArcade(c: ArcadeSpec, moves: number[]): ArcadeState {
  const s = initialArcade(c);
  if (isPixelGame(c.game)) {
    const pixel = playPixel(
      c.game,
      c.seed,
      moves,
      c.difficulty,
      c.rulesVersion ?? (c.difficulty ? 2 : 1),
    );
    return {
      ...s,
      pixel,
      tick: pixel.tick,
      score: pixel.score,
      hits: pixel.hits,
      finished: pixel.finished,
      success: pixel.success,
      valid: pixel.valid,
    };
  }
  if (moves.length > 512 || moves.some((n) => !Number.isSafeInteger(n))) {
    s.valid = false;
    return s;
  }
  for (const move of moves) {
    if (s.finished) {
      s.valid = false;
      return s;
    }
    if (c.game === "memory") {
      if (move < 0 || move > 11 || s.matched.includes(move)) {
        s.valid = false;
        return s;
      }
      if (s.revealed.length === 2) s.revealed = [];
      if (s.revealed.includes(move)) continue;
      s.revealed.push(move);
      if (s.revealed.length === 2) {
        s.tick++;
        if (s.board[s.revealed[0]] === s.board[s.revealed[1]]) {
          s.matched.push(...s.revealed);
          s.score++;
        } else s.hits++;
        s.success = s.score === 6;
        if (s.tick >= 16) s.finished = true;
      }
    } else if (c.game === "sokoban") {
      if (move < 0 || move > 3) {
        s.valid = false;
        return s;
      }
      const next = s.player + delta[move],
        box = s.crates.indexOf(next),
        beyond = next + delta[move];
      if (s.board[next] !== undefined && s.board[next] !== 1) {
        if (box < 0) s.player = next;
        else if (
          s.board[beyond] !== undefined &&
          s.board[beyond] !== 1 &&
          !s.crates.includes(beyond)
        ) {
          s.crates[box] = beyond;
          s.player = next;
        }
      }
      s.success = s.crates.every((i) => s.board[i] === 2);
    } else if (c.game === "hanoi") {
      if (move < 0 || move > 2) {
        s.valid = false;
        return s;
      }
      if (s.selected < 0) {
        if (s.towers[move].length) s.selected = move;
      } else {
        const a = s.towers[s.selected],
          b = s.towers[move];
        if (
          move !== s.selected &&
          (!b.length || b[b.length - 1]! > a[a.length - 1]!)
        )
          b.push(a.pop()!);
        s.selected = -1;
      }
      s.success = s.towers[2].length === 3;
    } else if (c.game === "pipes") {
      if (move < 0 || move > 8) {
        s.valid = false;
        return s;
      }
      s.board[move] = rotatePipe(s.board[move]);
      const seen = new Set([0]),
        pending = [0];
      while (pending.length) {
        const i = pending.pop()!;
        for (const [d, j] of [i - 3, i + 1, i + 3, i - 1].entries()) {
          if (
            j < 0 ||
            j > 8 ||
            Math.abs((i % 3) - (j % 3)) +
              Math.abs(Math.floor(i / 3) - Math.floor(j / 3)) !==
              1
          )
            continue;
          if (
            s.board[i] & (1 << d) &&
            s.board[j] & (1 << (d + 2) % 4) &&
            !seen.has(j)
          ) {
            seen.add(j);
            pending.push(j);
          }
        }
      }
      s.score = seen.size;
      s.success = seen.has(8) && seen.size === 5;
    } else if (c.game === "slide") {
      if (move < 0 || move > 8) {
        s.valid = false;
        return s;
      }
      const e = s.board.indexOf(0);
      if (
        Math.abs((e % 3) - (move % 3)) +
          Math.abs(Math.floor(e / 3) - Math.floor(move / 3)) ===
        1
      )
        [s.board[e], s.board[move]] = [s.board[move], s.board[e]];
      s.success = s.board.every((v, i) => v === (i + 1) % 9);
    } else if (c.game === "groups") {
      if (move < 0 || move > 15) {
        s.valid = false;
        return s;
      }
      const color = s.board[move],
        group = new Set<number>(),
        q = color >= 0 ? [move] : [];
      while (q.length) {
        const i = q.pop()!;
        if (group.has(i)) continue;
        group.add(i);
        for (const j of [i - 4, i + 1, i + 4, i - 1])
          if (
            j >= 0 &&
            j < 16 &&
            Math.abs((i % 4) - (j % 4)) +
              Math.abs(Math.floor(i / 4) - Math.floor(j / 4)) ===
              1 &&
            s.board[j] === color &&
            !group.has(j)
          )
            q.push(j);
      }
      if (group.size >= 2) {
        for (const i of group) s.board[i] = -1;
        s.score += group.size;
        const cols: number[][] = [];
        for (let x = 0; x < 4; x++) {
          const col = [0, 1, 2, 3]
            .map((y) => s.board[y * 4 + x])
            .filter((v) => v >= 0);
          if (col.length)
            cols.push([...Array(4 - col.length).fill(-1), ...col]);
        }
        s.board = Array.from(
          { length: 16 },
          (_, i) => cols[i % 4]?.[Math.floor(i / 4)] ?? -1,
        );
      }
      s.success = s.score === 16;
      if (
        !s.success &&
        !s.board.some(
          (v, i) =>
            v >= 0 &&
            [i + 1, i + 4].some(
              (j) =>
                j < 16 &&
                Math.abs((i % 4) - (j % 4)) +
                  Math.abs(Math.floor(i / 4) - Math.floor(j / 4)) ===
                  1 &&
                s.board[j] === v,
            ),
        )
      )
        s.finished = true;
    } else {
      if (move < 0 || move > (c.game === "rhythm" ? 1 : 2)) {
        s.valid = false;
        return s;
      }
      s.tick++;
      if (c.game === "rhythm") {
        if (move) {
          if (s.tick % 6 === 0) s.score++;
          else s.hits++;
        }
      } else {
        if (Math.abs(move - s.player) > 1) {
          s.valid = false;
          return s;
        }
        s.player = move;
        if (s.tick % 6 === 0) {
          const hit = move === fallingLane(c, s.tick);
          if (c.game === "catch") {
            if (hit) s.score++;
            else s.hits++;
          } else {
            if (hit) s.hits++;
            else s.score++;
          }
        }
      }
      if (s.tick === 72) {
        s.finished = true;
        s.success =
          c.game === "dodge"
            ? s.hits <= 2
            : c.game === "catch"
              ? s.score >= 8
              : s.score >= 8 && s.hits <= 4;
      }
    }
    if (s.success) s.finished = true;
  }
  return s;
}
