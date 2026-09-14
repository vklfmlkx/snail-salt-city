import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arcadeDifficulties,
  arcadeTuning,
} from "../src/domain/arcade-difficulty";
import {
  initialPixel,
  playPixel,
  decision,
  opponentMove,
  mountain,
  frame,
} from "../src/domain/pixel-arcade";
import { solvePixel } from "./helpers/pixel";
import { jumpCapability, landingReach } from "../src/domain/jump-envelope";
for (const difficulty of arcadeDifficulties)
  test(`${difficulty} 随机平台和飞行地图有实际物理见证`, () => {
    for (const seed of [
      ...Array.from({ length: 65536 }, (_, i) => i),
      99999,
      0x7fffffff,
      0xffffffff,
    ])
      for (const game of ["summit", "flight"] as const) {
        const moves = solvePixel(game, seed, difficulty),
          s = playPixel(game, seed, moves, difficulty);
        assert.ok(s.success && s.valid, `${game}:${seed}`);
        assert.equal(s.hits, 0);
        assert.ok(moves.length < 512);
      }
  });
test("运动包络、宽落脚点、两条生命与逐级速度", () => {
  assert.ok(jumpCapability.dashRange > jumpCapability.normalRange);
  assert.ok(landingReach(0).distance > landingReach(60).distance);
  for (const d of arcadeDifficulties) {
    const s = initialPixel("summit", 3, d);
    assert.ok(
      mountain(3, d).every((p, i) =>
        d === "hard" && i > 0 && i < 8 ? p.w >= 64 && p.w <= 88 : p.w >= 120,
      ),
    );
    s.y = 301;
    frame(s, 0);
    assert.equal(s.hits, 1);
    assert.equal(s.finished, false);
    s.y = 301;
    frame(s, 0);
    assert.equal(s.finished, true);
  }
  assert.ok(
    arcadeTuning.story.flightSpeed < arcadeTuning.normal.flightSpeed &&
      arcadeTuning.normal.flightSpeed < arcadeTuning.hard.flightSpeed,
  );
});
test("巡逻员数量2/3/5，随机路线仍可重复回放", () => {
  for (const d of arcadeDifficulties) {
    const a = initialPixel("rally", 4, d),
      b = initialPixel("rally", 5, d);
    assert.equal(a.guards.length, arcadeTuning[d].guards);
    const old = [...a.guards];
    decision(a, 0);
    decision(a, 0);
    assert.notDeepEqual(a.guards, old);
    assert.notDeepEqual(a.guards, b.guards);
    assert.deepEqual(a, playPixel("rally", 4, [0, 0], d));
  }
});
test("对手已知实/空弹时的错误目标频率对应三档，并且动画记录完整", () => {
  for (const d of arcadeDifficulties)
    for (const shell of [0, 1]) {
      let errors = 0;
      for (let seed = 0; seed < 2000; seed++) {
        const s = initialPixel("roulette", seed, d);
        s.duel.turn = 1;
        s.duel.items[1] = [];
        s.duel.known[1] = shell;
        s.duel.shells = [shell, 1 - shell, 1];
        s.events = [];
        opponentMove(s);
        const event = s.events.find((e) => e.kind === "shot")!;
        assert.ok(event);
        assert.equal(event.actor, 1);
        if (event.target === (shell ? 1 : 0)) errors++;
      }
      assert.ok(
        Math.abs(errors / 20 - arcadeTuning[d].mistake) < 4,
        `${d}:${shell}:${errors}`,
      );
    }
  const s = initialPixel("roulette", 9, "normal");
  s.duel.shells = [1, 1, 0];
  s.duel.items[1] = ["peek", "cuff"];
  decision(s, 0);
  assert.equal(s.events[0].kind, "shot");
  assert.ok(s.events.some((e) => e.kind === "peek" && e.actor === 1));
  assert.ok(s.events.every((e) => e.after.hp.length === 2));
});

test("新版弹仓未用道具跨轮保留，最多8件，末尾道具也可操作", () => {
  const s = initialPixel("roulette", 5, "normal");
  s.duel.items[0] = ["peek", "heal", "cuff", "peek", "heal", "cuff", "heal"];
  s.duel.shells = [0];
  decision(s, 1);
  assert.equal(s.duel.round, 2);
  assert.equal(s.duel.items[0].length, 8);
  assert.deepEqual(s.duel.items[0].slice(0, 7), [
    "peek",
    "heal",
    "cuff",
    "peek",
    "heal",
    "cuff",
    "heal",
  ]);
  s.duel.items[0][7] = "heal";
  s.duel.hp[0] = 2;
  decision(s, 9);
  assert.equal(s.valid, true);
  assert.equal(s.duel.hp[0], 3);
  assert.equal(s.duel.items[0].length, 7);
  decision(s, 10);
  assert.equal(s.valid, false);
  const old = initialPixel("roulette", 5, "normal", 2);
  old.duel.items[0] = ["peek", "heal"];
  old.duel.shells = [0];
  decision(old, 1);
  assert.equal(old.duel.items[0].length, 2);
});
