import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import { readConfig } from "../src/server/config";
import {
  AIError,
  MockProvider,
  DeepSeekProvider,
  modelContext,
  requestBody,
  validateInterpretation,
  type Context,
} from "../src/server/ai";
import { curatedBooks, curatedScenarios } from "../src/content/curated";
import { initialState } from "../src/engine/rules";
import { resolveScript } from "../src/engine/script-rules";
import { continuityFor } from "../src/server/custom-action";
import { validateProse } from "../src/server/generation/colloquial";
import { viewpointIssues } from "../src/content/narration-viewpoint";
const character = {
  name: "测试",
  background: "测试",
  stats: { body: 5, agility: 5, mind: 5, presence: 5 },
};
function setup(die = 10, provider = new MockProvider()) {
  const store = new Store(":memory:");
  const service = new GameService(store, readConfig({}), () => die, provider);
  const owner = service.visitor().auth.owner;
  let state = service.create(owner, {
    ...character,
    scenarioVersion: curatedBooks[0].version,
  }).state;
  const { challenge } = service.activity(owner, state.id, {
    expectedStateVersion: state.version,
  });
  state = service.activity(owner, state.id, {
    expectedStateVersion: state.version,
    challengeId: challenge!.id,
    answers: [0],
  }).state!;
  return { store, service, owner, state };
}
test("20篇85个行动阶段都有嵌入正文的小游戏，结束语视角一致，生成稿缺失时拒收", () => {
  assert.equal(curatedBooks.flatMap((b) => b.stages).length, 85);
  for (const b of curatedBooks) {
    validateProse(b);
    assert.deepEqual(viewpointIssues(b), []);
    for (const s of b.stages) {
      const a = s.activity!;
      assert.ok(a?.game);
      assert.deepEqual(
        s.opening.slice(a.afterLine - a.intro.length, a.afterLine),
        a.intro,
      );
    }
  }
  const broken = structuredClone(curatedBooks[0]);
  delete broken.stages[0].activity;
  assert.throws(() => validateProse(broken), /activity/);
});
test("测试开关默认关且隔离；未开启不调用模型，停用使未结算预览失效", async () => {
  const x = setup();
  let calls = 0;
  const mock = new MockProvider();
  x.service.gateway.run = async (_r, _o, c) => {
    if (_r === "continuity") return { approved: true, reason: "离线审查" };
    calls++;
    return mock.interpret(c);
  };
  const input = {
    text: "抢走郑工的房卡，去一楼的房间",
    expectedStateVersion: x.state.version,
  };
  await assert.rejects(
    x.service.proposeCustom(x.owner, x.state.id, input),
    /测试功能/,
  );
  assert.equal(calls, 0);
  x.service.setTestFeatures(x.owner, { customActions: true });
  assert.equal(
    x.service.testFeatures(x.service.visitor().auth.owner).customActions,
    false,
  );
  const p = await x.service.proposeCustom(x.owner, x.state.id, input);
  assert.ok("proposal" in p);
  assert.equal(JSON.stringify(p).includes("landingIds"), false);
  x.service.setTestFeatures(x.owner, { customActions: false });
  assert.throws(
    () =>
      x.service.commit(x.owner, x.state.id, {
        proposalId: p.proposal.id,
        clientTurnId: randomUUID(),
        expectedStateVersion: x.state.version,
      }),
    /测试功能/,
  );
  assert.equal(
    x.service.read(x.owner, x.state.id).state.version,
    x.state.version,
  );
  x.store.close();
});
for (const die of [1, 6, 10])
  test(`桥段只替换表现，骰点${die}按固定路线结算；重复提交不重掷`, async () => {
    const x = setup(die);
    x.service.setTestFeatures(x.owner, { customActions: true });
    let context: Context | undefined;
    const mock = new MockProvider();
    let calls = 0;
    x.service.gateway.run = async (_r, _o, c) => {
      if (_r === "continuity") return { approved: true, reason: "离线审查" };
      calls++;
      context = c;
      return mock.interpret(c);
    };
    const p = await x.service.proposeCustom(x.owner, x.state.id, {
      text: "抢走郑工的房卡，去一楼的房间",
      expectedStateVersion: x.state.version,
    });
    assert.ok("proposal" in p);
    assert.ok(context!.scripted!.continuity);
    assert.ok(JSON.stringify(modelContext(context!)).length < 48000);
    const input = {
      proposalId: p.proposal.id,
      clientTurnId: randomUUID(),
      expectedStateVersion: x.state.version,
    };
    const turn = x.service.commit(x.owner, x.state.id, input);
    const base = initialState(character, curatedScenarios[0]);
    const expected = resolveScript(
      base,
      curatedScenarios[0],
      p.proposal.action.id,
      die,
    );
    assert.equal(turn.state.stage.number, expected.state.stage);
    assert.equal(turn.state.status, expected.state.status);
    assert.deepEqual(turn.turn.result.events, expected.result.events);
    // The inserted two Mock paragraphs precede the entire unchanged fixed result.
    assert.deepEqual(
      turn.turn.result.scriptDialogue?.slice(2),
      expected.result.scriptDialogue,
    );
    x.service.setTestFeatures(x.owner, { customActions: false });
    assert.deepEqual(
      x.service.commit(x.owner, x.state.id, input).turn,
      turn.turn,
    );
    assert.equal(calls, 1);
    x.store.close();
  });
test("模型不能伪造落点、拿其他方向的桥段、凭空降低门槛；超时与关闭中途请求不推进", async () => {
  const x = setup();
  x.service.setTestFeatures(x.owner, { customActions: true });
  const mock = new MockProvider();
  let ctx: Context | undefined;
  x.service.gateway.run = async (_r, _o, c) => {
    if (_r === "continuity") return { approved: true, reason: "离线审查" };
    ctx = c;
    return mock.interpret(c);
  };
  const input = {
    text: "核对已知消息再上楼",
    expectedStateVersion: x.state.version,
  };
  await x.service.proposeCustom(x.owner, x.state.id, input);
  const raw = await mock.interpret(ctx!);
  raw.localPlan!.continuity!.landingIds.success = "invented";
  assert.throws(() => validateInterpretation(raw, ctx!), /illegal_reference/);
  const body = requestBody("interpreter", ctx!, readConfig({}));
  assert.match(
    body.messages.map((m) => m.content).join("\n"),
    /不能开辟新主线|requiredResult|不能在预览假装/,
  );
  assert.equal(body.thinking.type, "disabled");
  assert.equal(body.response_format.type, "json_object");
  assert.equal("reasoning_effort" in body, false);
  x.service.gateway.run = async () => {
    throw new AIError("timeout");
  };
  assert.equal(
    (await x.service.proposeCustom(x.owner, x.state.id, input)).kind,
    "fallback",
  );
  assert.equal(
    x.service.read(x.owner, x.state.id).state.version,
    x.state.version,
  );
  x.service.gateway.run = async (_r, _o, c) => {
    if (_r === "continuity") return { approved: true, reason: "离线审查" };
    x.service.setTestFeatures(x.owner, { customActions: false });
    return mock.interpret(c);
  };
  await assert.rejects(
    x.service.proposeCustom(x.owner, x.state.id, input),
    /测试功能/,
  );
  x.store.close();
});
test("衔接契约按真实flag选择条件结局，不把未解锁真结局交给模型", () => {
  for (const book of curatedBooks)
    for (const [i, stage] of book.stages.entries()) {
      const state = initialState(
        character,
        curatedScenarios[curatedBooks.indexOf(book)],
      );
      state.stage = i + 1;
      const contracts = continuityFor(book, state);
      stage.choices.forEach((choice, j) => {
        for (const o of ["success", "partial", "failure"] as const) {
          const r = choice.routes![o];
          if (r.requires?.some((f) => !r.grants.includes(f) && !state.flags[f]))
            assert.equal(
              contracts[j].outcomes[o].nextScene,
              book.endings.find((e) => e.id === r.otherwise)!.title,
            );
        }
      });
    }
});
test("衔接审查拒绝或超时不保存预览、不消耗行动，两个模型步骤各仅调用一次", async () => {
  for (const fail of ["reject", "timeout"]) {
    const x = setup();
    x.service.setTestFeatures(x.owner, { customActions: true });
    const roles: string[] = [];
    x.service.gateway.run = async (role, _o, c) => {
      roles.push(role);
      if (role === "continuity") {
        assert.ok(c.scripted?.reviewPlan);
        assert.equal(c.scripted?.continuity?.length, 1);
        if (fail === "timeout") throw new AIError("timeout");
        return { approved: false, reason: "持卡状态尚未回归" };
      }
      return new MockProvider().interpret(c);
    };
    const p = await x.service.proposeCustom(x.owner, x.state.id, {
      text: "抢一下房卡",
      expectedStateVersion: x.state.version,
    });
    assert.equal(p.kind, "fallback");
    assert.deepEqual(roles, ["interpreter", "continuity"]);
    assert.equal(
      x.service.read(x.owner, x.state.id).state.version,
      x.state.version,
    );
    assert.equal(
      (
        x.store.db.prepare("SELECT COUNT(*) n FROM proposals").get() as {
          n: number;
        }
      ).n,
      0,
    );
    x.store.close();
  }
});
test("仅修复无歧义的JSON包装层级，冲突字段和非法引用仍被拒绝", async () => {
  const x = setup();
  x.service.setTestFeatures(x.owner, { customActions: true });
  let context: Context | undefined;
  x.service.gateway.run = async (role, _o, c) => {
    if (role === "continuity") return { approved: true, reason: "测试" };
    context = c;
    return new MockProvider().interpret(c);
  };
  await x.service.proposeCustom(x.owner, x.state.id, {
    text: "核对房卡",
    expectedStateVersion: x.state.version,
  });
  const raw = await new MockProvider().interpret(context!);
  const { branches, rejoins, ...plan } = raw.localPlan!;
  const nested = { ...raw, localPlan: plan, branches, rejoins };
  assert.deepEqual(validateInterpretation(nested, context!), raw);
  assert.throws(
    () => validateInterpretation({ ...raw, branches }, context!),
    /schema_invalid/,
  );
  assert.throws(
    () =>
      validateInterpretation(
        { ...nested, actionOptionId: "invented" },
        context!,
      ),
    /illegal_reference/,
  );
  assert.equal(
    JSON.stringify(modelContext(context!)).includes("requiredResult"),
    false,
  );
  x.store.close();
});
test("自定义桥段的真实适配器有独立deadline且仅尝试一次", async () => {
  const x = setup();
  x.service.setTestFeatures(x.owner, { customActions: true });
  let context: Context | undefined;
  x.service.gateway.run = async (_r, _o, c) => {
    if (_r === "continuity") return { approved: true, reason: "离线审查" };
    context = c;
    return new MockProvider().interpret(c);
  };
  await x.service.proposeCustom(x.owner, x.state.id, {
    text: "试着交谈",
    expectedStateVersion: x.state.version,
  });
  let calls = 0;
  const cfg = readConfig({
    LLM_MODE: "live",
    AI_LIVE_ENABLED: "true",
    DEEPSEEK_API_KEY: "test-key",
    LLM_GLOBAL_DAILY_CALL_LIMIT: "1",
    LLM_CUSTOM_TIMEOUT_MS: "5",
  });
  const provider = new DeepSeekProvider(
    cfg,
    async () => {
      calls++;
      return await new Promise<Response>(() => {});
    },
    () => {},
  );
  await assert.rejects(provider.interpret(context!), /timeout/);
  assert.equal(calls, 1);
  x.store.close();
});
