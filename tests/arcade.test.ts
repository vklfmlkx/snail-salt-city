import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arcadeGames,
  gamesByAttribute,
  playArcade,
} from "../src/domain/arcade";
import { makeChallenge, gradeChallenge } from "../src/domain/minigames";
import { solveArcade } from "./helpers/arcade";
import { curatedBooks, originalCuratedBooks } from "../src/content/curated";
import { ScriptBookSchema } from "../src/content/script-book";
import { GameService } from "../src/server/service";
import { Store } from "../src/server/database";
import { readConfig } from "../src/server/config";
import { randomUUID } from "node:crypto";
import { initialState } from "../src/engine/rules";
import { getScenario } from "../src/content/registry";
for (const game of arcadeGames)
  test(`${game}：关卡可解，服务端回放拒绝伪造和超长记录`, () => {
    const attribute = Object.entries(gamesByAttribute).find(([, games]) =>
      games.includes(game),
    )![0] as keyof typeof gamesByAttribute;
    for (let seed = 0; seed < 30; seed++) {
      const c = makeChallenge(randomUUID(), attribute, seed, game),
        moves = solveArcade({ game, seed });
      if (game === "roulette")
        assert.equal(
          gradeChallenge(c, moves),
          playArcade({ game, seed }, moves).success,
        );
      else assert.ok(gradeChallenge(c, moves), `${game} seed ${seed}`);
      assert.equal(gradeChallenge(c, []), false);
      assert.equal(gradeChallenge(c, [-1]), false);
      assert.equal(gradeChallenge(c, Array(513).fill(0)), false);
      assert.equal(gradeChallenge(c, [...moves, 0]), false);
    }
  });
test("20篇新版有连续背景段、段中叙述、较完整人物发言；旧稿保持不变", () => {
  const scheduled = new Set<string>();
  for (const [i, b] of curatedBooks.entries()) {
    ScriptBookSchema.parse(b);
    assert.ok(b.version.endsWith("1.3"));
    assert.ok(originalCuratedBooks[i].version.endsWith("1.0"));
    assert.ok(
      b.stages[0].opening
        .slice(0, 3)
        .every((l) => l.speaker === "gm" && l.text.length >= 15),
    );
    for (const [n, s] of b.stages.entries()) {
      assert.ok(s.opening.filter((l) => l.speaker === "gm").length >= 2);
      assert.ok(
        s.opening.some((l) => l.speaker === "player" && l.text.length >= 5),
      );
      assert.ok(s.opening.filter((l) => l.speaker !== "gm").length >= 3);
      if (s.activity) {
        assert.ok(s.activity.game);
        scheduled.add(s.activity.game!);
        assert.deepEqual(
          s.opening.slice(
            s.activity.afterLine - s.activity.intro.length,
            s.activity.afterLine,
          ),
          s.activity.intro,
        );
      }
    }
  }
  assert.ok(scheduled.size > 0);
  assert.ok([...scheduled].every((g) => arcadeGames.includes(g as any)));
});
test("新小游戏不能跳过或伪造成功，未完成时关键行动不可提交；旧版存档不自动放弃", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, readConfig({}), () => 10),
    owner = svc.visitor().auth.owner;
  const character = {
    name: "新玩家",
    background: "离线验收",
    stats: { body: 5, agility: 5, mind: 5, presence: 5 },
  };
  const state = svc.create(owner, {
    ...character,
    scenarioVersion: curatedBooks.find((b) => b.stages[0].activity?.game)!
      .version,
  }).state;
  const p = (await svc.propose(owner, state.id, {
    expectedStateVersion: 0,
    actionOptionId: state.actions[0].id,
  })) as any;
  assert.throws(
    () =>
      svc.commit(owner, state.id, {
        expectedStateVersion: 0,
        proposalId: p.proposal.id,
        clientTurnId: randomUUID(),
      }),
    /小游戏/,
  );
  const q = svc.activity(owner, state.id, { expectedStateVersion: 0 }) as any;
  for (const extra of [{ skip: true }, { answers: [] }, { success: true }])
    assert.throws(() =>
      svc.activity(owner, state.id, {
        expectedStateVersion: 0,
        challengeId: q.challenge.id,
        ...extra,
      }),
    );
  const body = {
    expectedStateVersion: 0,
    challengeId: q.challenge.id,
    answers: solveArcade({
      game: q.challenge.game,
      seed: q.challenge.seed,
      difficulty: q.challenge.difficulty,
      rulesVersion: q.challenge.rulesVersion,
    }),
  };
  const done = svc.activity(owner, state.id, body) as any;
  assert.equal(done.result.reward, 1);
  assert.deepEqual(svc.activity(owner, state.id, body), done);
  const oldOwner = svc.visitor().auth.owner;
  const old = svc.create(oldOwner, {
    ...character,
    scenarioVersion: curatedBooks[0].version,
  }).state;
  const raw = initialState(
    character,
    getScenario(originalCuratedBooks[0].version),
  );
  db.db
    .prepare("UPDATE games SET scenario_version=?,state_json=? WHERE id=?")
    .run(raw.scenarioVersion, JSON.stringify(raw), old.id);
  assert.throws(
    () =>
      svc.create(oldOwner, {
        ...character,
        scenarioVersion: curatedBooks[0].version,
      }),
    /进行中/,
  );
  assert.equal(svc.read(oldOwner, old.id).state.status, "playing");
  db.close();
});

for (const difficulty of ["story", "normal", "hard"] as const) {
  test(`故事难度 ${difficulty} 固定到服务器挑战，不能提交覆盖`, () => {
    const db = new Store(":memory:"),
      svc = new GameService(db, readConfig({}), () => 10),
      owner = svc.visitor().auth.owner;
    const state = svc.create(owner, {
      name: "难度验收",
      background: "",
      stats: { body: 5, agility: 5, mind: 5, presence: 5 },
      difficulty,
      scenarioVersion: curatedBooks.find(
        (b) => b.stages[0].activity?.game === "summit",
      )!.version,
    }).state;
    const q = svc.activity(owner, state.id, { expectedStateVersion: 0 }) as any;
    assert.equal(q.challenge.difficulty, difficulty);
    assert.deepEqual(
      svc.activity(owner, state.id, { expectedStateVersion: 0 }),
      q,
    );
    assert.throws(() =>
      svc.activity(owner, state.id, {
        expectedStateVersion: 0,
        challengeId: q.challenge.id,
        difficulty: "story",
        answers: [0],
      }),
    );
    const answers = solveArcade(q.challenge);
    const body = {
      expectedStateVersion: 0,
      challengeId: q.challenge.id,
      answers,
    };
    const done = svc.activity(owner, state.id, body) as any;
    assert.equal(done.result.reward, 1);
    assert.deepEqual(svc.activity(owner, state.id, body), done);
    db.close();
  });
}
