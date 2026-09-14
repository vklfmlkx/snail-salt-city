import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixedScenario as s } from "../src/content/registry";
import { ScriptBookSchema, type LocalPlan } from "../src/content/script-book";
import {
  compileBook,
  effectiveStats,
  resolveScript,
} from "../src/engine/script-rules";
import {
  initialState,
  project,
  compileActionOptions,
  publicAction,
} from "../src/engine/rules";
import { parseState } from "../src/domain/state-schema";
import { attributes } from "../src/domain/types";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import {
  AIError,
  MockProvider,
  validateInterpretation,
  requestBody,
  type Context,
} from "../src/server/ai";
import { readConfig } from "../src/server/config";
const c = {
  name: "青梅",
  background: "合成测试",
  stats: { body: 5, agility: 5, mind: 5, presence: 5 },
};
const plan: LocalPlan = {
  conditions: ["在当前场景内整理随身物品"],
  branches: {
    success: [
      { speaker: "gm", expression: "smile", text: "整理顺利完成。" },
      { speaker: "player", expression: "smile", text: "这样拿东西就方便了。" },
    ],
    partial: [
      {
        speaker: "gm",
        expression: "neutral",
        text: "整理到一半，东西有些多。",
      },
      {
        speaker: "player",
        expression: "neutral",
        text: "至少常用的在上面了。",
      },
    ],
    failure: [
      {
        speaker: "gm",
        expression: "worried",
        text: "东西滑出了你的手，没能整理好。",
      },
      { speaker: "player", expression: "worried", text: "我先放回原处。" },
    ],
  },
};

test("fixed manuscript has six complete stages, three unique endings, four different methods and legal speakers", () => {
  const b = ScriptBookSchema.parse(s.book);
  assert.equal(b.stages.length, 6);
  assert.deepEqual(b.endings.map((e) => e.id).sort(), ["bad", "good", "true"]);
  for (const stage of b.stages) {
    assert.deepEqual(
      stage.choices.map((c) => c.attribute).sort(),
      [...attributes].sort(),
    );
    assert.ok(stage.opening.length >= 12);
    assert.ok(stage.transition.length >= 2);
  }
  const broken = structuredClone(b);
  broken.stages[0].opening[0].speaker = "visitor";
  assert.throws(() => ScriptBookSchema.parse(broken));
});
for (const [ending, die, difficulty] of [
  ["true", 10, "normal"],
  ["good", 2, "normal"],
  ["bad", 1, "hard"],
] as const)
  test(`fixed ${ending} ending is reachable and every result uses the same next-stage opening`, () => {
    let st = initialState({ ...c, difficulty }, s);
    while (st.status === "playing") {
      const before = st;
      const r = resolveScript(st, s, `book.s${st.stage}.key.body`, die);
      st = parseState(JSON.parse(JSON.stringify(r.state)), s);
      assert.equal(st.turn, before.turn + 1);
      assert.ok(
        r.result.scriptDialogue!.some(
          (d) => d.text === s.book!.stages[before.stage - 1].transition[0].text,
        ),
      );
      if (st.status === "playing")
        assert.deepEqual(
          r.result.scriptDialogue!.slice(
            -s.book!.stages[st.stage - 1].opening.length,
          ),
          s.book!.stages[st.stage - 1].opening,
        );
    }
    assert.equal(st.ending, ending);
    assert.equal(st.turn, 6);
    assert.equal(compileActionOptions(st, s).length, 0);
  });
test("one/two optional side slots reset per stage; small cumulative buffs never change main facts or score", () => {
  let st = initialState(c, s);
  let sides = 0;
  while (st.status === "playing") {
    for (let i = 0; i < s.book!.stages[st.stage - 1].sideLimit; i++) {
      const before = st;
      st = resolveScript(
        st,
        s,
        `book.s${st.stage}.side.mind.standard`,
        10,
        plan,
      ).state;
      sides++;
      assert.deepEqual(st.facts, before.facts);
      assert.equal(st.stage, before.stage);
      assert.equal(st.remaining, 1);
      assert.equal(st.counters.score, before.counters.score);
      assert.ok(st.counters.buff_mind <= 2);
      parseState(st, s);
    }
    assert.ok(!compileActionOptions(st, s).some((a) => a.stageCost === 0));
    assert.throws(() =>
      resolveScript(st, s, `book.s${st.stage}.side.body.standard`, 10, plan),
    );
    st = resolveScript(st, s, `book.s${st.stage}.key.mind`, 10).state;
  }
  assert.equal(st.turn, 6 + sides);
  assert.equal(effectiveStats(st).mind, 7);
});
test("difficulty affects public preview and actual roll consistently; engine accepts variable stage count", () => {
  const difficultyValues = ["story", "normal", "hard"] as const;
  assert.deepEqual(
    difficultyValues.map((difficulty) => {
      const st = initialState({ ...c, difficulty }, s),
        a = compileActionOptions(st, s)[0];
      const n = publicAction(st, a).difficulty;
      assert.equal(resolveScript(st, s, a.id, 1).result.difficulty, n);
      return n;
    }),
    [6, 8, 11],
  );
  const short = compileBook({ ...s.book!, stages: s.book!.stages.slice(0, 3) });
  let st = initialState(c, short);
  for (let i = 1; i <= 3; i++)
    st = resolveScript(st, short, `book.s${i}.key.body`, 10).state;
  assert.equal(st.ending, "true");
  assert.equal(project(st, short).script!.stageCount, 3);
  parseState(st, short);
});
test("fixed choices and every ending use zero model calls, even in live mode", async () => {
  const db = new Store(":memory:"),
    p = new MockProvider();
  p.interpret = async () => {
    throw Error("Unexpected model call");
  };
  p.narrate = async () => {
    throw Error("Unexpected narrator");
  };
  const svc = new GameService(
    db,
    readConfig({ LLM_MODE: "live" }),
    () => 10,
    p,
  );
  const owner = svc.visitor().auth.owner;
  let st = svc.create(owner, { ...c, scenarioVersion: s.version }).state;
  while (st.status === "playing") {
    const p = await svc.propose(owner, st.id, {
      expectedStateVersion: st.version,
      actionOptionId: `book.s${st.stage.number}.key.body`,
    });
    assert.ok("proposal" in p);
    const input = {
        expectedStateVersion: st.version,
        proposalId: p.proposal.id,
        clientTurnId: randomUUID(),
      },
      r = svc.commit(owner, st.id, input);
    assert.deepEqual(svc.commit(owner, st.id, input), r);
    assert.equal(r.turn.narrationStatus, "ready");
    assert.deepEqual((await svc.narrate(owner, st.id, r.turn.id)).turn, r.turn);
    st = r.state;
  }
  assert.equal(st.ending!.id, "true");
  db.close();
});
test("local model runs once at preview, keeps branches private and commits only actual outcome atomically", async () => {
  const db = new Store(":memory:"),
    p = new MockProvider(),
    contexts: Context[] = [];
  let rolls = 0;
  p.interpret = async (ctx) => {
    contexts.push(ctx);
    return validateInterpretation(
      {
        kind: "act",
        actionOptionId: ctx.actions.find((a) =>
          a.id.includes(".mind.standard"),
        )!.id,
        intent: ctx.text,
        inputSpan: ctx.text,
        message: null,
        localPlan: plan,
      },
      ctx,
    );
  };
  p.narrate = async () => {
    throw Error("No runtime main narrator");
  };
  const svc = new GameService(
      db,
      readConfig({}),
      () => {
        rolls++;
        return 10;
      },
      p,
    ),
    owner = svc.visitor().auth.owner;
  let st = svc.create(owner, { ...c, scenarioVersion: s.version }).state;
  for (const mode of ["side", "key"] as const) {
    const text = "我想整理随身的物品，检查必要的药剂是否拿齐。";
    const preview = await svc.propose(owner, st.id, {
      mode,
      text,
      expectedStateVersion: st.version,
    });
    assert.ok("proposal" in preview);
    assert.ok(!JSON.stringify(preview).includes("整理顺利完成"));
    assert.equal(svc.read(owner, st.id).state.version, st.version);
    const input = {
        expectedStateVersion: st.version,
        proposalId: preview.proposal.id,
        clientTurnId: randomUUID(),
      },
      r = svc.commit(owner, st.id, input);
    assert.deepEqual(svc.commit(owner, st.id, input), r);
    assert.deepEqual(
      r.turn.result.scriptDialogue!.slice(0, 2),
      plan.branches.success,
    );
    assert.ok(!JSON.stringify(r.turn.result).includes("整理到一半"));
    assert.equal(r.turn.result.actionLabel, text);
    if (mode === "side") {
      assert.deepEqual(r.state.facts, st.facts);
      assert.equal(r.state.stage.number, 1);
    } else assert.equal(r.state.stage.number, 2);
    st = r.state;
  }
  assert.equal(rolls, 2);
  assert.equal(contexts.length, 2);
  assert.ok(contexts[0].actions.every((a) => a.id.includes(".side.")));
  assert.ok(contexts[1].actions.every((a) => a.id.includes(".custom.")));
  const body = requestBody("interpreter", contexts[1], readConfig({}));
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.reasoning_effort, undefined);
  db.close();
});
test("timeout, unsupported request and invalid role leave free action slots intact and fixed choices available", async () => {
  const db = new Store(":memory:"),
    p = new MockProvider(),
    svc = new GameService(db, readConfig({}), () => 1, p),
    owner = svc.visitor().auth.owner,
    st = svc.create(owner, { ...c, scenarioVersion: s.version }).state;
  p.interpret = async () => {
    throw new AIError("timeout");
  };
  assert.equal(
    (
      await svc.propose(owner, st.id, {
        text: "整理衣兜",
        mode: "side",
        expectedStateVersion: 0,
      })
    ).kind,
    "fallback",
  );
  p.interpret = async (ctx) =>
    validateInterpretation(
      {
        kind: "act",
        actionOptionId: ctx.actions[0].id,
        intent: ctx.text,
        inputSpan: ctx.text,
        message: null,
        localPlan: {
          ...plan,
          branches: {
            ...plan.branches,
            success: [
              { speaker: "visitor", expression: "smile", text: "我出现了。" },
              plan.branches.success[1],
            ],
          },
        },
      },
      ctx,
    );
  assert.equal(
    (
      await svc.propose(owner, st.id, {
        text: "整理衣兜",
        mode: "side",
        expectedStateVersion: 0,
      })
    ).kind,
    "fallback",
  );
  assert.deepEqual(svc.read(owner, st.id).state, st);
  assert.ok(
    "proposal" in
      (await svc.propose(owner, st.id, {
        actionOptionId: "book.s1.key.body",
        expectedStateVersion: 0,
      })),
  );
  await assert.rejects(
    svc.propose(owner, st.id, {
      actionOptionId: "book.s1.side.body.standard",
      expectedStateVersion: 0,
    }),
    { code: "local_plan_required" },
  );
  db.close();
});
