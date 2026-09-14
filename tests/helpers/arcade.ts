import {
  initialArcade,
  playArcade,
  fallingLane,
  type ArcadeSpec,
} from "../../src/domain/arcade";
import { isPixelGame } from "../../src/domain/pixel-arcade";
import { solvePixel } from "./pixel";
export function solveArcade(c: ArcadeSpec): number[] {
  if (isPixelGame(c.game))
    return solvePixel(
      c.game,
      c.seed,
      c.difficulty,
      c.rulesVersion ?? (c.difficulty ? 2 : 1),
    );
  if (c.game === "memory") {
    const b = initialArcade(c).board;
    return Array.from({ length: 6 }, (_, v) =>
      b.flatMap((x, i) => (x === v ? [i] : [])),
    ).flat();
  }
  if (c.game === "sokoban") return [0, 1, 2, 1, 0];
  if (c.game === "hanoi") {
    const moves: number[] = [];
    function move(n: number, from: number, to: number, spare: number) {
      if (!n) return;
      move(n - 1, from, spare, to);
      moves.push(from, to);
      move(n - 1, spare, to, from);
    }
    move(3, 0, 2, 1);
    return moves;
  }
  if (c.game === "pipes") {
    const target = [2, 12, 0, 0, 3, 12, 0, 0, 1],
      moves: number[] = [];
    for (let i = 0; i < 9; i++) {
      while (playArcade(c, moves).board[i] !== target[i]) moves.push(i);
      if (playArcade(c, moves).finished) break;
    }
    return moves;
  }
  if (c.game === "slide") {
    const board = [1, 2, 3, 4, 5, 6, 7, 8, 0],
      reverse: number[] = [];
    let previous = -1;
    for (let n = 0; n < 22; n++) {
      const empty = board.indexOf(0),
        choices = [empty - 3, empty + 1, empty + 3, empty - 1].filter(
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
      reverse.push(empty);
      previous = empty;
    }
    const result: number[] = [];
    for (const i of reverse.reverse()) {
      result.push(i);
      if (playArcade(c, result).finished) break;
    }
    return result;
  }
  if (c.game === "groups") {
    const queue: number[][] = [[]],
      seen = new Set<string>();
    for (let k = 0; k < queue.length; k++) {
      const moves = queue[k],
        s = playArcade(c, moves);
      if (s.success) return moves;
      if (s.finished) continue;
      const key = s.board.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      for (let i = 0; i < 16; i++)
        if (s.board[i] >= 0) {
          const m = [...moves, i];
          if (playArcade(c, m).score > s.score) queue.push(m);
        }
    }
    throw Error("unsolvable_groups");
  }
  const result: number[] = [];
  let lane = 1;
  for (let tick = 1; tick <= 72; tick++) {
    if (c.game === "rhythm") result.push(tick % 6 === 0 ? 1 : 0);
    else {
      const target = fallingLane(c, Math.ceil(tick / 6) * 6),
        wanted = c.game === "catch" ? target : (target + 1) % 3;
      lane = Math.max(lane - 1, Math.min(lane + 1, wanted));
      result.push(lane);
    }
  }
  return result;
}
