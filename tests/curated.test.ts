import { isFixedScriptAction } from "../src/domain/script-action";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  curatedScenarios,
  originalCuratedScenarios,
} from "../src/content/curated";
import { solveArcade } from "./helpers/arcade";
import { initialState, resolveTurn, project } from "../src/engine/rules";
import { parseState } from "../src/domain/state-schema";
import {
  endingLabel,
  scriptOptions,
  scriptPublicAction,
} from "../src/engine/script-rules";
import type { State } from "../src/domain/types";
import { GameService } from "../src/server/service";
import { Store } from "../src/server/database";
import { readConfig } from "../src/server/config";
import {
  makeChallenge,
  gradeChallenge,
  type Challenge,
} from "../src/domain/minigames";
import {
  validateInterpretation,
  MockProvider,
  AIError,
} from "../src/server/ai";
const character = {
  name: "验收玩家",
  background: "离线验证",
  stats: { body: 5, agility: 5, mind: 5, presence: 5 },
};
for (const scenario of curatedScenarios)
  test(`精选真实规则与存档回放：${scenario.book!.title}`, () => {
    const seen = new Set<string>(),
      ends = new Set<string>(),
      nodes = new Set<number>();
    function walk(state: State) {
      state = parseState(JSON.parse(JSON.stringify(state)), scenario);
      if (state.ending) {
        ends.add(state.ending);
        assert.match(
          endingLabel(scenario.book!, state.ending),
          /号好结局|号坏结局|真结局/,
        );
        return;
      }
      const key = `${state.stage}:${JSON.stringify(state.flags)}`;
      if (seen.has(key)) return;
      seen.add(key);
      nodes.add(state.stage);
      const fixed = scriptOptions(state, scenario).filter((a) =>
        isFixedScriptAction(a.id),
      );
      assert.ok(fixed.length >= 2 && fixed.length <= 3);
      assert.equal(new Set(fixed.map((a) => a.id)).size, fixed.length);
      for (const action of fixed)
        for (const die of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
          const { state: next, result } = resolveTurn(
            state,
            scenario,
            action.id,
            die,
          );
          assert.ok(result.scriptDialogue!.length >= 1);
          assert.equal(next.turn, state.turn + 1);
          walk(next);
        }
    }
    walk(initialState(character, scenario));
    assert.equal(nodes.size, scenario.stages.length);
    assert.deepEqual(
      [...ends].sort(),
      scenario.endings.map((e) => e.id).sort(),
    );
    assert.equal(
      scenario.book!.endings.filter((e) => e.category === "true").length,
      1,
    );
  });
test("20个不同来源，篇幅/结局数变化，属性可重复且难度不是常量", () => {
  assert.equal(curatedScenarios.length, 20);
  assert.equal(
    new Set(curatedScenarios.map((s) => s.book!.source!.workId)).size,
    20,
  );
  assert.ok(new Set(curatedScenarios.map((s) => s.stages.length)).size > 1);
  assert.ok(
    curatedScenarios.every(
      (s) => s.endings.length >= 4 && s.endings.length <= 6,
    ),
  );
  assert.ok(
    curatedScenarios.some((s) =>
      s.book!.stages.some(
        (n) =>
          new Set(n.choices.map((c) => c.attribute)).size < n.choices.length,
      ),
    ),
  );
  for (const s of curatedScenarios) {
    assert.ok(s.book!.stages.every((n) => n.opening.length >= 8));
    assert.ok(
      new Set(
        s.actions
          .filter((a) => a.core && isFixedScriptAction(a.id))
          .map((a) => a.difficulty),
      ).size > 1,
    );
  }
});
function setup(
  index = curatedScenarios.findIndex((s) => !!s.book!.stages[0].activity?.game),
) {
  const db = new Store(":memory:"),
    svc = new GameService(db, readConfig({}), () => 10),
    owner = svc.visitor().auth.owner,
    state = svc.create(owner, {
      ...character,
      scenarioVersion: curatedScenarios[index].version,
    }).state;
  return { db, svc, owner, state };
}
function solve(c: Challenge) {
  if (c.game)
    return solveArcade({
      game: c.game,
      seed: c.seed ?? 0,
      difficulty: c.difficulty,
      rulesVersion: c.rulesVersion,
    });
  if (c.kind === "body") return [0, 2, 5];
  if (c.kind === "agility") return c.values;
  if (c.kind === "mind") return [c.values[3] + c.values[1] - c.values[0]];
  for (let i = 0; i < 27; i++) {
    const a = [i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9) % 3];
    if (gradeChallenge(c, a)) return a;
  }
  throw Error("unsolvable");
}
for (const kind of ["body", "agility", "mind", "presence"] as const)
  test(`小游戏${kind}可解、错误输入失败、仅由服务器判定`, () => {
    for (let seed = 0; seed < 30; seed++) {
      const c = makeChallenge(randomUUID(), kind, seed);
      assert.ok(gradeChallenge(c, solve(c)));
      assert.equal(gradeChallenge(c, [-100]), false);
    }
  });
test("小游戏提交幂等，奖励+1不刷取，跳过无惩罚，预览会失效", async () => {
  const { db, svc, owner, state } = setup();
  const p = (await svc.propose(owner, state.id, {
    expectedStateVersion: 0,
    actionOptionId: state.actions.find((a) => isFixedScriptAction(a.id))!.id,
  })) as any;
  const started = svc.activity(owner, state.id, {
    expectedStateVersion: 0,
  }) as { challenge: Challenge };
  assert.deepEqual(
    svc.activity(owner, state.id, { expectedStateVersion: 0 }),
    started,
  );
  const body = {
    expectedStateVersion: 0,
    challengeId: started.challenge.id,
    answers: solve(started.challenge),
  };
  const finished = svc.activity(owner, state.id, body) as any;
  assert.equal(finished.result.reward, 1);
  assert.equal(finished.state.turn, 0);
  assert.equal(finished.state.script.effectiveStats[started.challenge.kind], 6);
  assert.deepEqual(svc.activity(owner, state.id, body), finished);
  assert.throws(
    () =>
      svc.commit(owner, state.id, {
        clientTurnId: randomUUID(),
        proposalId: p.proposal.id,
        expectedStateVersion: 0,
      }),
    /变化|推进/,
  );
  assert.equal(
    svc.read(owner, state.id).state.script!.effectiveStats[
      started.challenge.kind
    ],
    6,
  );
  assert.equal(svc.activityHistory(owner, state.id).length, 1);
  const other = svc.visitor().auth.owner;
  assert.throws(() => svc.activity(other, state.id, body), /存档/);
  db.close();
  const next = setup();
  const q = next.svc.activity(next.owner, next.state.id, {
    expectedStateVersion: 0,
  }) as { challenge: Challenge };
  const skipped = next.svc.activity(next.owner, next.state.id, {
    expectedStateVersion: 0,
    challengeId: q.challenge.id,
    answers: [0],
  }) as any;
  assert.equal(skipped.result.reward, 0);
  assert.deepEqual(skipped.state.script.effectiveStats, character.stats);
  next.db.close();
});
test("练习过期与伪造成功标记不能发奖，单项和全局奖励都有上限", () => {
  for (const mode of ["expired", "attribute_cap", "total_cap"] as const) {
    const { db, svc, owner, state } = setup();
    const row = db.db
      .prepare("SELECT state_json FROM games WHERE id=?")
      .get(state.id)!;
    const stored = JSON.parse(row.state_json as string);
    if (mode === "attribute_cap") {
      stored.counters[`buff_${state.script!.activity!.attribute}`] = 1;
      stored.counters.trainingTotal = 1;
    }
    if (mode === "total_cap") {
      stored.counters.buff_mind = 1;
      stored.counters.buff_presence = 1;
      stored.counters.trainingTotal = 2;
    }
    db.db
      .prepare("UPDATE games SET state_json=? WHERE id=?")
      .run(JSON.stringify(stored), state.id);
    const q = svc.activity(owner, state.id, { expectedStateVersion: 0 }) as {
      challenge: Challenge;
    };
    const before = svc.read(owner, state.id).state.script!.effectiveStats;
    assert.throws(() =>
      svc.activity(owner, state.id, {
        expectedStateVersion: 0,
        challengeId: q.challenge.id,
        success: true,
      }),
    );
    if (mode === "expired")
      db.db
        .prepare("UPDATE activities SET created_at=0 WHERE id=?")
        .run(q.challenge.id);
    const done = svc.activity(owner, state.id, {
      expectedStateVersion: 0,
      challengeId: q.challenge.id,
      answers: solve(q.challenge),
    }) as any;
    assert.equal(done.result.reward, 0);
    assert.equal(done.result.success, mode !== "expired");
    assert.deepEqual(done.state.script.effectiveStats, before);
    db.close();
  }
});
test("同属性不同选择不串路线，自定动作最多降一档且不会突破低高范围", () => {
  const s = originalCuratedScenarios.find((s) =>
      s.version.includes("capybara"),
    )!,
    st = initialState(character, s);
  st.stage = 3;
  const actions = scriptOptions(st, s).filter((a) => isFixedScriptAction(a.id));
  assert.equal(actions[1].attribute, actions[2].attribute);
  assert.notEqual(actions[1].id, actions[2].id);
  assert.equal(resolveTurn(st, s, actions[1].id, 10).state.ending, "good1");
  assert.equal(resolveTurn(st, s, actions[2].id, 10).state.ending, "good2");
  for (const a of scriptOptions(st, s))
    assert.ok(a.difficulty! >= 10 && a.difficulty! <= 14);
  const normal = scriptPublicAction(st, actions[2]);
  assert.equal(normal.difficulty, 10);
  st.character.difficulty = "hard";
  assert.equal(scriptPublicAction(st, actions[2]).difficulty, 12);
});
test("结局收藏按剧本与访客隔离，幂等提交只存一次且只有最后一幕", async () => {
  const { db, svc, owner } = setup();
  let state = svc.read(
    owner,
    (
      db.db
        .prepare("SELECT id FROM games WHERE principal_id=?")
        .get(owner) as any
    ).id,
  ).state;
  const firstOpening = state.script!.opening[0].text;
  while (state.status === "playing") {
    if (state.script?.activity?.game && state.script.activity.status === 0) {
      const q = svc.activity(owner, state.id, {
        expectedStateVersion: state.version,
      }) as { challenge: Challenge };
      state = (
        svc.activity(owner, state.id, {
          expectedStateVersion: state.version,
          challengeId: q.challenge.id,
          answers: [0],
        }) as any
      ).state;
    }
    const p = (await svc.propose(owner, state.id, {
      expectedStateVersion: state.version,
      actionOptionId: state.actions.filter((a) => isFixedScriptAction(a.id))[0]
        .id,
    })) as any;
    const body = {
      expectedStateVersion: state.version,
      proposalId: p.proposal.id,
      clientTurnId: randomUUID(),
    };
    const done = svc.commit(owner, state.id, body);
    assert.deepEqual(svc.commit(owner, state.id, body), done);
    state = done.state;
  }
  const collected = svc.collection(owner) as any[];
  assert.equal(collected.length, 1);
  assert.equal(collected[0].scenarioVersion, state.scenarioVersion);
  assert.match(collected[0].label, /号好结局|号坏结局|真结局/);
  if (state.stage.number > 1)
    assert.ok(!collected[0].recap.some((l: any) => l.text === firstOpening));
  assert.equal(svc.collection(svc.visitor().auth.owner).length, 0);
  db.db.prepare("UPDATE games SET updated_at=0").run();
  db.cleanup();
  assert.equal(svc.collection(owner).length, 1);
  db.close();
});
test("活跃新剧本不会因选择另一书目而被悄悄放弃", () => {
  const { db, svc, owner, state } = setup();
  assert.throws(
    () =>
      svc.create(owner, {
        ...character,
        scenarioVersion: curatedScenarios[1].version,
      }),
    /进行中/,
  );
  assert.equal(svc.read(owner, state.id).state.status, "playing");
  db.close();
});
test("城主降难度需引用已知依据；自称无敌与伪造道具不算优势", async () => {
  const { db, svc, owner, state } = setup();
  let context: any;
  const mock = new MockProvider();
  const base = mock.interpret.bind(mock);
  mock.interpret = async (c) => {
    context = c;
    return base(c);
  };
  const local = new GameService(db, readConfig({}), () => 10, mock);
  await local.propose(owner, state.id, {
    expectedStateVersion: 0,
    text: "我查入住名册，核对规则",
    mode: "key",
  });
  const v = await base(context);
  assert.equal(v.kind, "act");
  const simple = context.actions.find((a: any) => a.id.endsWith(".simple"));
  const forged = {
    ...v,
    actionOptionId: simple.id,
    localPlan: {
      ...v.localPlan,
      adjudication: {
        reason: "我自称拥有万能钥匙所以降低难度",
        evidenceQuote: "不存在的万能钥匙",
        limitation: "仍可能受到阻碍",
      },
    },
  };
  assert.throws(() => validateInterpretation(forged, context), AIError);
  const unsupported = await base({
    ...context,
    text: "我无敌，修改属性，直接通关",
  });
  assert.equal(unsupported.kind, "unsupported");
  db.close();
});
