import {
  appendFrame,
  decision,
  frame,
  initialPixel,
  type PixelGame,
  type PixelState,
} from "../../src/domain/pixel-arcade";
import type { ArcadeDifficulty } from "../../src/domain/arcade-difficulty";
import { landingReach } from "../../src/domain/jump-envelope";
/** Offline witnesses, not shipped to browsers. Roulette search sees the seed only
 * to exercise terminal server paths; it is not the player's/AI's strategy. */
export function solvePixel(
  game: PixelGame,
  seed: number,
  difficulty?: ArcadeDifficulty,
  rulesVersion = 3,
): number[] {
  let s = initialPixel(game, seed, difficulty, rulesVersion);
  let airborne = 0,
    dashAt = -1;
  const moves: number[] = [];
  if (game === "summit" || game === "flight") {
    while (!s.finished) {
      let input = 0;
      if (game === "summit") {
        const platform = s.platforms[s.checkpoint];
        input = 2;
        if (difficulty) {
          if (s.grounded) {
            airborne = 0;
            dashAt = -1;
            if (s.checkpoint < 8 && platform.x + platform.w - s.x < 12) {
              input |= 4;
              dashAt = landingReach(
                platform.y - s.platforms[s.checkpoint + 1].y,
                difficulty !== "story",
              ).dashAt;
            }
          } else {
            airborne++;
            if (airborne === dashAt) input |= 8;
            const next = s.platforms[s.checkpoint + 1];
            if (next && s.x > next.x + 25) input &= ~2;
          }
        } else if (
          s.grounded &&
          s.checkpoint < 8 &&
          platform.x + platform.w - s.x < 18
        )
          input |= 4;
      } else {
        const gate = s.gates.find((g) => g.x + 37 > s.x) ?? s.gates.at(-1)!;
        input =
          (difficulty
            ? (s.y > gate.y + 25 && s.vy > -3) ||
              (s.y > gate.y + 8 && s.vy >= 0)
            : s.y > gate.y + 10 && s.vy >= 0) && !s.previous
            ? 1
            : 0;
      }
      frame(s, input);
      appendFrame(moves, input);
    }
  } else if (game === "roulette") {
    const seen = new Set<string>();
    function search(s: PixelState, depth: number): number[] | null {
      if (s.finished) return s.success ? [] : null;
      if (depth > 60) return null;
      const d = s.duel,
        key = JSON.stringify([
          s.random,
          d.hp,
          d.shells,
          d.items,
          d.locked,
          d.cuffUsed,
          d.known,
        ]);
      if (seen.has(key)) return null;
      seen.add(key);
      for (const move of [2, 3, d.shells[0] ? 0 : 1, d.shells[0] ? 1 : 0]) {
        const next = structuredClone(s);
        decision(next, move);
        if (!next.valid) continue;
        const tail = search(next, depth + 1);
        if (tail) return [move, ...tail];
      }
      return null;
    }
    const result = search(s, 0);
    if (result) return result;
    // Unlike a platform map, a random duel is allowed to be lost.
    while (!s.finished) {
      moves.push(0);
      decision(s, 0);
    }
    return moves;
  } else {
    while (!s.finished) {
      const queue: { s: PixelState; m: number[] }[] = [{ s, m: [] }];
      const seen = new Set<string>();
      let found: (typeof queue)[number] | undefined;
      for (let i = 0; i < queue.length && i < 20000; i++) {
        const node = queue[i];
        if (node.s.success || node.s.score > s.score) {
          found = node;
          break;
        }
        const key = JSON.stringify([
          node.s.x,
          node.s.y,
          node.s.tick % 8,
          node.s.guards,
          node.s.stunned,
          node.s.whistles,
          node.s.random,
        ]);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const move of [0, 1, 2, 3, 4]) {
          if (move === 4 && !node.s.whistles) continue;
          const next = structuredClone(node.s);
          decision(next, move);
          if (next.hits > s.hits || (next.finished && !next.success)) continue;
          queue.push({ s: next, m: [...node.m, move] });
        }
      }
      if (!found) throw Error(`no_rally_witness_${seed}`);
      moves.push(...found.m);
      s = found.s;
    }
  }
  if (!s.success)
    throw Error(
      `no_${game}_witness_${seed}: ${JSON.stringify({ x: s.x, y: s.y, tick: s.tick, hits: s.hits })}`,
    );
  return moves;
}
