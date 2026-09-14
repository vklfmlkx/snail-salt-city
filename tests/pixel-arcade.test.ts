import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendFrame,
  decision,
  frame,
  initialPixel,
  MAX_FRAMES,
  mountain,
  opponentMove,
  playPixel,
  skyway,
} from "../src/domain/pixel-arcade";
import { solvePixel } from "./helpers/pixel";
import { playArcade } from "../src/domain/arcade";
import { solveArcade } from "./helpers/arcade";

test("平台和飞行：全部65536个剧情种子及32位边界种子均有真实物理通关路线", () => {
  for (const seed of [
    ...Array.from({ length: 65536 }, (_, i) => i),
    99999,
    0x7fffffff,
    0xffffffff,
  ])
    for (const game of ["summit", "flight"] as const) {
      const moves = solvePixel(game, seed),
        result = playPixel(game, seed, moves);
      assert.ok(result.valid && result.success, `${game}:${seed}`);
      assert.ok(moves.length < 512);
      assert.equal(result.hits, 0);
    }
  assert.notDeepEqual(mountain(1), mountain(2));
  assert.notDeepEqual(skyway(1), skyway(2));
});
test("回放拒绝帧数溢出、非法按键和结束后的操作；闲置有有限结束", () => {
  for (const input of [
    [-1],
    [NaN],
    [1.5],
    [64 + 63],
    [1020],
    Array(513).fill(0),
  ])
    assert.equal(playPixel("summit", 2, input).valid, false);
  assert.equal(playPixel("flight", 2, [128]).valid, false);
  const idle = playPixel("summit", 2, Array(MAX_FRAMES / 60).fill(59));
  assert.ok(idle.finished && !idle.success && idle.valid);
  assert.equal(
    playPixel("summit", 2, [...Array(MAX_FRAMES / 60).fill(59), 0]).valid,
    false,
  );
  const moves = solvePixel("flight", 2);
  assert.equal(playPixel("flight", 2, [...moves, 0]).valid, false);
});
test("压缩输入与逐帧模拟相同，断点继续不改变轨迹", () => {
  const s = initialPixel("summit", 42),
    moves: number[] = [];
  for (let i = 0; i < 200 && !s.finished; i++) {
    const input = i === 20 ? 6 : i > 25 && i < 30 ? 10 : 2;
    frame(s, input);
    appendFrame(moves, input);
  }
  assert.deepEqual(playPixel("summit", 42, moves), s);
  const saved = structuredClone(playPixel("summit", 42, moves));
  for (let i = 0; i < 10 && !s.finished; i++) {
    frame(s, 0);
    frame(saved, 0);
  }
  assert.deepEqual(saved, s);
});
test("跳跃、空中冲刺、落地充能和四次跌落限制", () => {
  const s = initialPixel("summit", 4);
  frame(s, 6);
  assert.ok(s.vy < 0 && !s.grounded);
  frame(s, 10);
  assert.equal(s.dash, false);
  assert.ok(s.vx > 2.6);
  frame(s, 0);
  const ticks = s.dashTicks;
  frame(s, 10);
  assert.ok(s.dashTicks < ticks);
  s.x = 30;
  s.y = 214;
  s.vy = 2;
  s.dashTicks = 0;
  frame(s, 0);
  frame(s, 0);
  assert.equal(s.dash, true);
  for (let i = 0; i < 4; i++) {
    s.y = 301;
    frame(s, 0);
    assert.equal(s.hits, i + 1);
  }
  assert.ok(s.finished && !s.success);
});
test("每轮3—5枚、实空弹都有、双方3生命和两个随机道具", () => {
  const lengths = new Set<number>(),
    items = new Set<string>();
  for (let seed = 0; seed < 1000; seed++) {
    const d = initialPixel("roulette", seed).duel;
    assert.ok(d.shells.length >= 3 && d.shells.length <= 5);
    lengths.add(d.shells.length);
    assert.ok(d.shells.includes(0) && d.shells.includes(1));
    assert.deepEqual(d.hp, [3, 3]);
    d.items.forEach((hand) => {
      assert.equal(hand.length, 2);
      hand.forEach((i) => items.add(i));
    });
  }
  assert.equal(lengths.size, 3);
  assert.equal(items.size, 3);
});
test("自己的空弹留回合；实弹扣生命；弹药打完开新轮而生命保留", () => {
  const s = initialPixel("roulette", 2);
  s.duel.shells = [0, 1, 0];
  decision(s, 1);
  assert.equal(s.duel.turn, 0);
  assert.deepEqual(s.duel.hp, [3, 3]);
  assert.equal(s.duel.shells.length, 2);
  s.duel.locked[1] = true;
  decision(s, 0);
  assert.equal(s.duel.hp[1], 2);
  assert.equal(s.duel.turn, 0);
  const round = s.duel.round;
  decision(s, 1);
  assert.equal(s.duel.round, round + 1);
  assert.equal(s.duel.hp[1], 2);
  assert.deepEqual(
    s.duel.items.map((h) => h.length),
    [2, 2],
  );
});
test("急救包不溢出、窥弹只看下一枚、手铐只跳过一次而不能叠加", () => {
  const s = initialPixel("roulette", 7);
  s.duel.items[0] = ["heal", "peek"];
  s.duel.hp[0] = 2;
  s.duel.shells = [1, 0, 1];
  decision(s, 2);
  assert.equal(s.duel.hp[0], 3);
  assert.equal(s.duel.items[0].length, 1);
  decision(s, 2);
  assert.equal(s.duel.known[0], 1);
  assert.equal(s.duel.turn, 0);
  s.duel.items[0] = ["cuff", "cuff"];
  decision(s, 2);
  assert.equal(s.duel.locked[1], true);
  const invalid = structuredClone(s);
  decision(invalid, 2);
  assert.equal(invalid.valid, false);
  decision(s, 0);
  assert.equal(s.duel.turn, 0);
  assert.equal(s.duel.locked[1], false);
  assert.equal(s.duel.known[0], null);
  const full = initialPixel("roulette", 0);
  full.duel.items[0] = ["heal"];
  decision(full, 2);
  assert.equal(full.valid, false);
  assert.equal(full.duel.hp[0], 3);
});
test("AI在相同公开信息下选择相同动作，不偷看隐藏顺序", () => {
  const a = initialPixel("roulette", 1);
  a.duel.turn = 1;
  a.duel.items[1] = [];
  a.duel.shells = [0, 1, 1];
  const b = structuredClone(a);
  b.duel.shells = [1, 0, 1];
  opponentMove(a);
  opponentMove(b);
  assert.match(a.duel.log.at(-1)!, /对手选择朝对面/);
  assert.match(b.duel.log.at(-1)!, /对手选择朝对面/);
  const known = initialPixel("roulette", 1);
  known.duel.turn = 1;
  known.duel.items[1] = ["peek"];
  known.duel.shells = [0, 1];
  opponentMove(known);
  assert.equal(known.duel.known[1], 0);
  opponentMove(known);
  assert.match(known.duel.log.at(-1)!, /朝自己/);
});
test("决斗胜负都能结束、失败不当作成功；拒绝无效道具和无限操作", () => {
  const win = initialPixel("roulette", 1);
  win.duel.hp[1] = 1;
  win.duel.shells = [1, 0, 0];
  decision(win, 0);
  assert.ok(win.finished && win.success);
  const lose = initialPixel("roulette", 1);
  lose.duel.hp[0] = 1;
  lose.duel.shells = [1, 0, 0];
  decision(lose, 1);
  assert.ok(lose.finished && !lose.success);
  const illegal = initialPixel("roulette", 1);
  decision(illegal, 4);
  assert.equal(illegal.valid, false);
  const bounded = initialPixel("roulette", 1);
  bounded.tick = 239;
  bounded.duel.shells = [0, 1, 0];
  decision(bounded, 1);
  assert.ok(bounded.finished && !bounded.success);
});
test("集结街区连通且伙伴位置随机；呼哨有限、碰撞会失败", () => {
  for (let seed = 0; seed < 100; seed++) {
    const s = initialPixel("rally", seed),
      seen = new Set([17]),
      q = [17];
    for (let i = 0; i < q.length; i++)
      for (const delta of [-16, 1, 16, -1]) {
        const p = q[i] + delta;
        if (p >= 0 && p < 160 && !s.walls.includes(p) && !seen.has(p)) {
          seen.add(p);
          q.push(p);
        }
      }
    assert.ok(s.friends.every((i) => seen.has(i)));
    assert.ok(seen.has(142));
  }
  const s = initialPixel("rally", 1);
  s.friends = [18, 19, 33, 34, 35, 36];
  decision(s, 4);
  assert.ok(s.score >= 3);
  assert.equal(s.whistles, 2);
  for (let n = 0; n < 3; n++) {
    s.guards = [17];
    s.x = s.y = 1;
    s.stunned = 2;
    decision(s, 0);
  }
  assert.ok(s.finished && !s.success);
});
test("已有旧小游戏挑战仍能按原规则回放", () => {
  for (const game of [
    "sokoban",
    "hanoi",
    "dodge",
    "catch",
    "pipes",
    "slide",
    "memory",
    "groups",
    "rhythm",
  ] as const)
    assert.ok(
      playArcade({ game, seed: 19 }, solveArcade({ game, seed: 19 })).success,
    );
});
