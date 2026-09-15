import { cloneGameData } from "./clone-game-data";
/** Deterministic, fixed-step games. The server replays input, never a client score.
 * Real-time records use input * 64 + (frames - 1); at most 60 frames per run.
 * All coordinates are logical pixels. No wall-clock time or Math.random here. */
import * as previous from "./pixel-arcade-v2";
import * as legacy from "./pixel-arcade-v1";
import { arcadeTuning, type ArcadeDifficulty } from "./arcade-difficulty";
import { jumpPhysics, landingReach } from "./jump-envelope";
export const pixelGames = ["summit", "flight", "roulette", "rally"] as const;
export type PixelGame = (typeof pixelGames)[number];
export const isPixelGame = (game: string): game is PixelGame =>
  (pixelGames as readonly string[]).includes(game);
export const FRAME_MS = 1000 / 30;
export const MAX_FRAMES = 3600;
export const inputBits = { left: 1, right: 2, jump: 4, dash: 8 };
export type Platform = { x: number; y: number; w: number };
export type Gate = { x: number; y: number; gap: number };
export type Item = "heal" | "peek" | "cuff";
export type DuelEvent = {
  kind: "shot" | Item | "reload" | "skip";
  actor: 0 | 1;
  target: 0 | 1;
  shell?: number;
  after: Duel;
};
export type Duel = {
  hp: [number, number];
  items: [Item[], Item[]];
  shells: number[];
  round: number;
  turn: 0 | 1;
  known: [number | null, number | null];
  locked: [boolean, boolean];
  cuffUsed: [boolean, boolean];
  log: string[];
};
export type PixelState = {
  difficulty?: ArcadeDifficulty;
  rulesVersion?: number;
  events: DuelEvent[];
  game: PixelGame;
  seed: number;
  random: number;
  tick: number;
  valid: boolean;
  finished: boolean;
  success: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  dash: boolean;
  dashTicks: number;
  previous: number;
  coyote: number;
  platforms: Platform[];
  gates: Gate[];
  score: number;
  hits: number;
  checkpoint: number;
  trail: number[];
  walls: number[];
  friends: number[];
  guards: number[];
  whistles: number;
  stunned: number;
  duel: Duel;
};
function random(s: { random: number }, n: number) {
  s.random = (Math.imul(s.random, 1664525) + 1013904223) >>> 0;
  return s.random % n;
}
export function mountain(
  seed: number,
  difficulty?: ArcadeDifficulty,
): Platform[] {
  if (!difficulty) return legacy.mountain(seed);
  const r = { random: seed >>> 0 };
  const result: Platform[] = [{ x: 0, y: 205, w: 144 }];
  for (let i = 1; i < 9; i++) {
    const p = result[i - 1];
    const limit = { story: 24, normal: 48, hard: 64 }[difficulty];
    const y = Math.max(
      88,
      Math.min(211, p.y + random(r, limit * 2 + 1) - limit),
    );
    const envelope = landingReach(p.y - y, difficulty !== "story");
    const [low, high] = arcadeTuning[difficulty].jumpRatio;
    const ratio = low + (random(r, 1001) / 1000) * (high - low);
    result.push({
      x: p.x + p.w + Math.floor(envelope.distance * ratio) - 10,
      y,
      w:
        difficulty === "hard" && i < 8
          ? 64 + random(r, 25)
          : 120 + random(r, 37),
    });
  }
  return result;
}
export function skyway(seed: number, difficulty?: ArcadeDifficulty): Gate[] {
  if (!difficulty) return legacy.skyway(seed);
  const r = { random: seed >>> 0 };
  let y = 145;
  return Array.from({ length: 10 }, (_, i) => {
    const tune = arcadeTuning[difficulty];
    y = Math.max(
      80,
      Math.min(206, y + random(r, tune.flightDrop * 2 + 1) - tune.flightDrop),
    );
    return { x: 260 + i * 174, y, gap: tune.flightGap + random(r, 9) - 4 };
  });
}
function loadRound(s: PixelState) {
  const d = s.duel,
    n = 3 + random(s, 3),
    live = 1 + random(s, n - 1);
  d.round++;
  d.shells = Array.from({ length: n }, (_, i) => (i < live ? 1 : 0));
  for (let i = n - 1; i > 0; i--) {
    const j = random(s, i + 1);
    [d.shells[i], d.shells[j]] = [d.shells[j], d.shells[i]];
  }
  // Fresh two-item hands each round; inventory cannot grow without bound.
  const kinds: Item[] = ["heal", "peek", "cuff"];
  d.items = [0, 1].map((who) =>
    [...d.items[who], kinds[random(s, 3)], kinds[random(s, 3)]].slice(0, 8),
  ) as Duel["items"];
  d.known = [null, null];
  d.locked = [false, false];
  d.cuffUsed = [false, false];
  d.log.push(
    `第 ${d.round} 轮装填：${live} 枚实弹、${n - live} 枚空弹。双方各拿到两件新道具。`,
  );
  emit(s, "reload", d.turn, d.turn);
}
function emit(
  s: PixelState,
  kind: DuelEvent["kind"],
  actor: 0 | 1,
  target: 0 | 1,
  shell?: number,
) {
  s.events.push({ kind, actor, target, shell, after: cloneGameData(s.duel) });
}
export function initialPixel(
  game: PixelGame,
  seed: number,
  difficulty?: ArcadeDifficulty,
  rulesVersion = 3,
): PixelState {
  if (difficulty && rulesVersion === 2)
    return {
      ...previous.initialPixel(game, seed, difficulty),
      rulesVersion: 2,
    };
  if (!difficulty) return { ...legacy.initialPixel(game, seed), events: [] };
  const s: PixelState = {
    difficulty,
    rulesVersion,
    events: [],
    game,
    seed,
    random: seed >>> 0,
    tick: 0,
    valid: true,
    finished: false,
    success: false,
    x: game === "flight" ? 60 : 25,
    y: game === "flight" ? 145 : 205,
    vx: 0,
    vy: 0,
    grounded: game === "summit",
    dash: true,
    dashTicks: 0,
    previous: 0,
    coyote: 3,
    platforms: [],
    gates: [],
    score: 0,
    hits: 0,
    checkpoint: 0,
    trail: [],
    walls: [],
    friends: [],
    guards: [],
    whistles: 3,
    stunned: 0,
    duel: {
      hp: [3, 3],
      items: [[], []],
      shells: [],
      round: 0,
      turn: 0,
      known: [null, null],
      locked: [false, false],
      cuffUsed: [false, false],
      log: [],
    },
  };
  if (game === "summit") s.platforms = mountain(seed, difficulty);
  if (game === "flight") s.gates = skyway(seed, difficulty);
  if (game === "roulette") loadRound(s);
  if (game === "rally") {
    s.x = 1;
    s.y = 1;
    s.trail = [17];
    // Leave intersecting streets open. All courtyards connect to a street.
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 16; x++)
        if (
          !x ||
          !y ||
          x === 15 ||
          y === 9 ||
          (x % 3 === 0 && y % 3 === 0 && random(s, 3) !== 0)
        )
          s.walls.push(y * 16 + x);
    const available = Array.from({ length: 160 }, (_, i) => i).filter(
      (i) => !s.walls.includes(i) && i !== 17 && i !== 142,
    );
    for (let i = 0; i < 6; i++)
      s.friends.push(available.splice(random(s, available.length), 1)[0]);
    const guardCells = available.filter(
      (i) => i % 16 >= 5 && Math.floor(i / 16) >= 3,
    );
    for (let i = 0; i < arcadeTuning[difficulty].guards; i++)
      s.guards.push(guardCells.splice(random(s, guardCells.length), 1)[0]);
  }
  return s;
}
function finish(s: PixelState, success: boolean) {
  s.finished = true;
  s.success = success;
}
/** Mutates just this local simulation state, used identically in browser/server. */
export function frame(s: PixelState, input: number) {
  if (s.rulesVersion === 2) {
    previous.frame(s, input);
    return;
  }
  if (!s.difficulty) {
    legacy.frame(s, input);
    return;
  }
  if (s.finished) {
    s.valid = false;
    return;
  }
  if (
    !Number.isInteger(input) ||
    input < 0 ||
    input > (s.game === "flight" ? 1 : 15)
  ) {
    s.valid = false;
    return;
  }
  s.tick++;
  if (s.game === "summit") {
    const direction = (input & 2 ? 1 : 0) - (input & 1 ? 1 : 0);
    const jump = !!(input & 4) && !(s.previous & 4);
    const dash = !!(input & 8) && !(s.previous & 8);
    if (s.grounded) {
      s.coyote = 3;
      s.dash = true;
    } else s.coyote = Math.max(0, s.coyote - 1);
    if (jump && s.coyote > 0) {
      s.vy = jumpPhysics.impulse;
      s.grounded = false;
      s.coyote = 0;
    }
    if (dash && s.dash) {
      s.dash = false;
      s.dashTicks = jumpPhysics.dashFrames;
      s.vx = (direction || 1) * jumpPhysics.dashSpeed;
      s.vy = jumpPhysics.dashVertical;
    }
    if (s.dashTicks > 0) s.dashTicks--;
    else {
      s.vx = direction * jumpPhysics.speed;
      s.vy = Math.min(jumpPhysics.fall, s.vy + jumpPhysics.gravity);
    }
    const oldY = s.y;
    s.x = Math.max(6, s.x + s.vx);
    s.y += s.vy;
    s.grounded = false;
    for (const [i, p] of s.platforms.entries()) {
      if (
        s.vy >= 0 &&
        oldY <= p.y &&
        s.y >= p.y &&
        s.x + 5 > p.x &&
        s.x - 5 < p.x + p.w
      ) {
        s.y = p.y;
        s.vy = 0;
        s.grounded = true;
        s.checkpoint = i;
        s.score = Math.max(s.score, i);
        break;
      }
    }
    const last = s.platforms[s.platforms.length - 1]!;
    if (s.grounded && s.x > last.x + last.w - 25) finish(s, true);
    if (s.y > 300) {
      s.hits++;
      if (s.hits === 2) finish(s, false);
      else {
        const p = s.platforms[s.checkpoint];
        s.x = p.x + 20;
        s.y = p.y;
        s.vx = s.vy = 0;
        s.dashTicks = 0;
        s.grounded = true;
        s.dash = true;
      }
    }
  } else if (s.game === "flight") {
    if (input && !s.previous) s.vy = -4.5;
    s.vy = Math.min(6, s.vy + 0.3);
    s.y += s.vy;
    s.x += arcadeTuning[s.difficulty].flightSpeed;
    for (const g of s.gates)
      if (
        s.x + 7 > g.x &&
        s.x - 7 < g.x + 30 &&
        (s.y - 6 < g.y - g.gap / 2 || s.y + 6 > g.y + g.gap / 2)
      )
        finish(s, false);
    if (s.y < 10 || s.y > 278) finish(s, false);
    s.score = s.gates.filter((g) => s.x - 7 > g.x + 30).length;
    if (!s.finished && s.score === s.gates.length) finish(s, true);
  }
  s.previous = input;
  if (!s.finished && s.tick >= MAX_FRAMES) finish(s, false);
}
function shot(s: PixelState, self: boolean) {
  const d = s.duel,
    who = d.turn,
    target = self ? who : 1 - who,
    shell = d.shells.shift()!;
  if (shell) d.hp[target]--;
  d.log.push(
    `${who === 0 ? "你" : "对手"}选择${self ? "朝自己" : "朝对面"}试射：${shell ? "实弹，损失一格生命" : "空弹"}${self && !shell ? "，保留行动权" : ""}。`,
  );
  d.known = [null, null];
  emit(s, "shot", who, target as 0 | 1, shell);
  if (d.hp[0] <= 0 || d.hp[1] <= 0) {
    finish(s, d.hp[1] <= 0);
    return;
  }
  if (!(self && !shell)) {
    if (d.locked[1 - who]) {
      d.locked[1 - who] = false;
      d.log.push("手铐生效：跳过对方一次行动。");
      emit(s, "skip", (1 - who) as 0 | 1, (1 - who) as 0 | 1);
    } else {
      d.turn = (1 - who) as 0 | 1;
      d.cuffUsed[d.turn] = false;
    }
  }
  if (!d.shells.length) loadRound(s);
}
function useItem(s: PixelState, index: number) {
  const d = s.duel,
    who = d.turn,
    item = d.items[who][index],
    name = who === 0 ? "你" : "对手";
  if (
    !item ||
    (item === "heal" && d.hp[who] === 3) ||
    (item === "cuff" && (d.cuffUsed[who] || d.locked[1 - who])) ||
    (item === "peek" && d.known[who] !== null)
  )
    return false;
  d.items[who].splice(index, 1);
  if (item === "heal") {
    d.hp[who]++;
    d.log.push(`${name}使用急救包，恢复一格生命。`);
  }
  if (item === "cuff") {
    d.locked[1 - who] = true;
    d.cuffUsed[who] = true;
    d.log.push(`${name}使用手铐，锁住对方下一次行动。`);
  }
  if (item === "peek") {
    d.known[who] = d.shells[0];
    d.log.push(
      who === 0
        ? `你查看了下一枚：${d.known[0] ? "实弹" : "空弹"}。`
        : "对手查看了下一枚弹药。",
    );
  }
  emit(
    s,
    item,
    who,
    item === "cuff" ? ((1 - who) as 0 | 1) : who,
    item === "peek" && who === 0 ? d.known[0]! : undefined,
  );
  return true;
}
/** Decisions use only public remaining counts and knowledge acquired by an item. */
export function opponentMove(s: PixelState) {
  if (!s.difficulty) {
    legacy.opponentMove(s);
    return;
  }
  const d = s.duel;
  if (d.hp[1] < 3 && d.items[1].includes("heal")) {
    useItem(s, d.items[1].indexOf("heal"));
    return;
  }
  if (d.known[1] === null && d.items[1].includes("peek")) {
    useItem(s, d.items[1].indexOf("peek"));
    return;
  }
  if (!d.cuffUsed[1] && !d.locked[0] && d.items[1].includes("cuff")) {
    useItem(s, d.items[1].indexOf("cuff"));
    return;
  }
  const live = d.shells.reduce((a, b) => a + b, 0);
  let self = d.known[1] === 0 || (d.known[1] === null && live === 0);
  if (random(s, 100) < arcadeTuning[s.difficulty].mistake) self = !self;
  shot(s, self);
}
export function decision(s: PixelState, move: number) {
  if (s.rulesVersion === 2) {
    previous.decision(s, move);
    return;
  }
  if (!s.difficulty) {
    legacy.decision(s, move);
    return;
  }
  s.events = [];
  if (
    s.finished ||
    !Number.isInteger(move) ||
    move < 0 ||
    move > (s.game === "roulette" ? 9 : 4)
  ) {
    s.valid = false;
    return;
  }
  s.tick++;
  if (s.game === "roulette") {
    const d = s.duel;
    if (d.turn === 1) {
      s.valid = false;
      return;
    }
    if (move < 2) shot(s, move === 1);
    else if (!useItem(s, move - 2)) {
      s.valid = false;
      return;
    }
    let steps = 0;
    while (!s.finished && (d.turn as number) === 1 && steps++ < 40)
      opponentMove(s);
    if (steps >= 40) s.valid = false;
    d.log = d.log.slice(-12);
  } else if (s.game === "rally") {
    const before = s.y * 16 + s.x;
    if (move === 4) {
      if (s.whistles) {
        s.whistles--;
        s.stunned = 4;
      }
    } else {
      const next = before + [-16, 1, 16, -1][move];
      if (!s.walls.includes(next)) {
        s.x = next % 16;
        s.y = Math.floor(next / 16);
        s.trail.unshift(next);
        s.trail = s.trail.slice(0, s.score + 1);
      }
    }
    const pos = s.y * 16 + s.x;
    const gathered = s.friends.filter(
      (i) =>
        i === pos ||
        (move === 4 &&
          s.stunned === 4 &&
          Math.abs((i % 16) - s.x) + Math.abs(Math.floor(i / 16) - s.y) <= 2),
    );
    s.friends = s.friends.filter((i) => !gathered.includes(i));
    s.score += gathered.length;
    if (s.stunned > 0) s.stunned--;
    else if (s.tick % 2 === 0)
      s.guards = s.guards.map((g) => {
        const choices = [-16, 1, 16, -1]
          .map((d) => g + d)
          .filter((p) => !s.walls.includes(p) && p > 16 && p < 143);
        return choices.length ? choices[random(s, choices.length)] : g;
      });
    if (s.guards.includes(pos)) {
      s.hits++;
      s.stunned = 2;
    }
    if (s.hits >= 3) finish(s, false);
    else if (s.score === 6 && pos === 142) finish(s, true);
  } else s.valid = false;
  if (!s.finished && s.tick >= 240) finish(s, false);
}
export function appendFrame(moves: number[], input: number) {
  const last = moves[moves.length - 1];
  if (last !== undefined && Math.floor(last / 64) === input && last % 64 < 59)
    moves[moves.length - 1]++;
  else moves.push(input * 64);
}
export function playPixel(
  game: PixelGame,
  seed: number,
  moves: number[],
  difficulty?: ArcadeDifficulty,
  rulesVersion = 3,
) {
  const s = initialPixel(game, seed, difficulty, rulesVersion);
  if (moves.length > 512) {
    s.valid = false;
    return s;
  }
  for (const code of moves) {
    if (!Number.isSafeInteger(code) || code < 0 || code > 1019 || s.finished) {
      s.valid = false;
      break;
    }
    if (game === "summit" || game === "flight") {
      const count = (code % 64) + 1,
        input = Math.floor(code / 64);
      if (count > 60 || s.tick + count > MAX_FRAMES) {
        s.valid = false;
        break;
      }
      for (let n = 0; n < count; n++) {
        frame(s, input);
        if (!s.valid) break;
      }
    } else decision(s, code);
    if (!s.valid) break;
  }
  return s;
}
