import { linkTestAccount } from "./helpers/zhihu-account";
import { customFailureMessage, retryCustom } from "../src/server/custom-retry";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import { readConfig } from "../src/server/config";
import {
  AIError,
  ModelGateway,
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
  const owner = linkTestAccount(store, service.visitor().auth.owner);
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
    // New plans replace the old choice result and transition, then play the next opening.
    const plan = JSON.parse(
      (
        x.store.db
          .prepare("SELECT local_plan FROM proposals WHERE id=?")
          .get(p.proposal.id) as { local_plan: string }
      ).local_plan,
    );
    assert.equal(plan.continuity.playback, "replace");
    const o = turn.turn.result.outcome;
    const landing = expected.state.ending
      ? curatedBooks[0].endings.find((e) => e.id === expected.state.ending)!
          .dialogue
      : curatedBooks[0].stages[expected.state.stage - 1].opening;
    const legacy = structuredClone(plan);
    delete legacy.continuity.playback;
    assert.deepEqual(
      resolveScript(
        base,
        curatedScenarios[0],
        p.proposal.action.id,
        die,
        legacy,
      ).result.scriptDialogue,
      [
        ...plan.branches[o],
        ...plan.rejoins[o],
        ...expected.result.scriptDialogue!,
      ],
    );
    assert.deepEqual(turn.turn.result.scriptDialogue, [
      ...plan.branches[o],
      ...plan.rejoins[o],
      ...landing,
    ]);
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
test("取消合理性否决，临时失败自动重试后只保存一个预览", async () => {
  const x = setup();
  x.service.setTestFeatures(x.owner, { customActions: true });
  const roles: string[] = [];
  x.service.gateway.run = async (role, _o, c) => {
    roles.push(role);
    if (roles.length === 1) throw new AIError("network");
    if (roles.length === 2) throw new AIError("schema_invalid");
    const draft = await new MockProvider().interpret(c);
    for (const o of ["success", "partial", "failure"] as const) {
      draft.localPlan!.branches[o] = [
        {
          speaker: "gm",
          expression: "neutral",
          text: "你抢到了房卡，冲到一楼。门后居然又是一部电梯，刚才的人追过来，把你塞回了队伍。",
        },
      ];
    }
    return draft;
  };
  const p = await x.service.proposeCustom(x.owner, x.state.id, {
    text: "抢走房卡去一楼",
    expectedStateVersion: x.state.version,
  });
  assert.ok("proposal" in p);
  assert.deepEqual(roles, ["interpreter", "interpreter", "interpreter"]);
  assert.equal(
    x.service.read(x.owner, x.state.id).state.version,
    x.state.version,
  );
  assert.equal(
    x.store.db.prepare("SELECT COUNT(*) n FROM proposals").get()!.n,
    1,
  );
  assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM turns").get()!.n, 0);
  x.store.close();
});

test("访客即使残留旧开关也不能启用或调用模型", async () => {
  const x = setup();
  const guest = x.service.visitor().auth.owner;
  x.store.db.prepare("INSERT INTO test_features VALUES(?,1)").run(guest);
  assert.deepEqual(x.service.testFeatures(guest), { customActions: false });
  assert.throws(
    () => x.service.setTestFeatures(guest, { customActions: true }),
    /知乎登录/,
  );
  x.service.gateway.run = async () => {
    throw new Error("must not call model");
  };
  await assert.rejects(
    x.service.proposeCustom(guest, x.state.id, {
      text: "抢卡",
      expectedStateVersion: x.state.version,
    }),
    /知乎登录/,
  );
  x.store.close();
});

for (const kind of ["unsupported", "clarify"] as const)
  for (const firstFailure of [false, true])
    test(`正常返回${kind}立即展示且不重试（此前连接失败=${firstFailure}）`, async () => {
      const x = setup();
      try {
        x.service.setTestFeatures(x.owner, { customActions: true });
        let calls = 0;
        const message =
          kind === "unsupported"
            ? "这个行动不合理，不能直接把属性改成一百。"
            : "还没明白你想做什么，请补充一个具体动作。";
        // Exercise the real HTTP adapter/parser, but never contact a paid service.
        const provider = new DeepSeekProvider(
          readConfig({
            LLM_MODE: "live",
            AI_LIVE_ENABLED: "true",
            DEEPSEEK_API_KEY: "offline-test-only",
            LLM_GLOBAL_DAILY_CALL_LIMIT: "20",
          }),
          async () => {
            calls++;
            if (firstFailure && calls === 1)
              throw new TypeError("offline connection failure");
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: JSON.stringify({
                        kind,
                        actionOptionId: null,
                        intent: "说明行动限制",
                        inputSpan: null,
                        message,
                      }),
                    },
                  },
                ],
              }),
            );
          },
          () => {},
        );
        x.service.gateway.run = async (role, _owner, c, signal) => {
          assert.equal(role, "interpreter");
          return provider.interpret(c, signal);
        };
        const result = await x.service.proposeCustom(x.owner, x.state.id, {
          text: "把属性直接改成一百",
          expectedStateVersion: x.state.version,
        });
        assert.deepEqual(result, { kind, message });
        assert.equal(calls, firstFailure ? 2 : 1);
        assert.equal(
          x.service.read(x.owner, x.state.id).state.version,
          x.state.version,
        );
        assert.equal(
          x.store.db.prepare("SELECT COUNT(*) n FROM proposals").get()!.n,
          0,
        );
        assert.equal(
          x.store.db.prepare("SELECT COUNT(*) n FROM turns").get()!.n,
          0,
        );
      } finally {
        x.store.close();
      }
    });

test("天马行空的桥段直接接受，不经合理性复审，仍按固定路线结算", async () => {
  const x = setup();
  try {
    x.service.setTestFeatures(x.owner, { customActions: true });
    let calls = 0;
    const surreal =
      "你骑上从天花板掉下来的鲸鱼，冲进一楼。电梯忽然横着飞了过来，一口吞下鲸鱼，把你倒回同伴身旁，手里的房卡也飞回了原主口袋。";
    x.service.gateway.run = async (role, _owner, c) => {
      assert.equal(role, "interpreter");
      calls++;
      const prompt = requestBody(role, c, readConfig({})).messages[0].content;
      assert.match(prompt, /即使衔接十分天马行空也可以直接使用/);
      assert.doesNotMatch(prompt, /不存在的装备、未展示的能力.*应澄清或拒绝/);
      const draft = await new MockProvider().interpret(c);
      for (const o of ["success", "partial", "failure"] as const)
        draft.localPlan!.rejoins![o] = [
          { speaker: "gm", expression: "surprised", text: surreal },
        ];
      return validateInterpretation(draft, c);
    };
    const p = await x.service.proposeCustom(x.owner, x.state.id, {
      text: "抢卡去一楼，然后骑鲸鱼回来",
      expectedStateVersion: x.state.version,
    });
    assert.ok("proposal" in p);
    const expected = resolveScript(
      initialState(character, curatedScenarios[0]),
      curatedScenarios[0],
      p.proposal.action.id,
      10,
    );
    const turn = x.service.commit(x.owner, x.state.id, {
      proposalId: p.proposal.id,
      clientTurnId: randomUUID(),
      expectedStateVersion: x.state.version,
    });
    assert.equal(calls, 1);
    assert.equal(turn.state.stage.number, expected.state.stage);
    assert.equal(turn.state.status, expected.state.status);
    assert.deepEqual(turn.turn.result.events, expected.result.events);
    assert.ok(turn.turn.result.scriptDialogue!.some((l) => l.text === surreal));
  } finally {
    x.store.close();
  }
});

test("自动重试有上限；配置、凭证、额度与拒绝不重试；总超时会中止请求", async () => {
  for (const code of [
    "network",
    "timeout",
    "rate_limit",
    "provider_error",
    "empty_content",
    "invalid_json",
    "schema_invalid",
    "truncated",
    "illegal_reference",
    "configuration",
    "auth",
    "quota",
    "refusal",
  ] as const) {
    let calls = 0;
    const cfg = readConfig({ LLM_CUSTOM_MAX_ATTEMPTS: "2" });
    await assert.rejects(
      retryCustom(cfg, async () => {
        calls++;
        throw new AIError(code);
      }),
      new RegExp(code),
    );
    assert.equal(
      calls,
      ["configuration", "auth", "quota", "refusal"].includes(code) ? 1 : 2,
    );
  }
  let signal: AbortSignal | undefined;
  const began = Date.now();
  await assert.rejects(
    retryCustom(
      readConfig({ LLM_CUSTOM_TOTAL_TIMEOUT_MS: "15" }),
      async (s) => {
        signal = s;
        return new Promise(() => {});
      },
    ),
    /timeout/,
  );
  assert.equal(signal!.aborted, true);
  assert.ok(Date.now() - began < 1000);
});

test("每次自动重试分别占用调用额度，额度不足即停，租约正常释放", async () => {
  for (const limit of [1, 2]) {
    const x = setup();
    const cfg = readConfig({
      LLM_MODE: "live",
      AI_LIVE_ENABLED: "true",
      DEEPSEEK_API_KEY: "offline",
      LLM_GLOBAL_DAILY_CALL_LIMIT: String(limit),
    });
    let context: Context | undefined;
    x.service.setTestFeatures(x.owner, { customActions: true });
    x.service.gateway.run = async (_r, _o, c) => {
      context = c;
      return new MockProvider().interpret(c);
    };
    await x.service.proposeCustom(x.owner, x.state.id, {
      text: "试着交谈",
      expectedStateVersion: x.state.version,
    });
    const mock = new MockProvider();
    let calls = 0;
    const provider = {
      interpret: async (c: Context) => {
        calls++;
        if (calls === 1) throw new AIError("network");
        return mock.interpret(c);
      },
      narrate: mock.narrate.bind(mock),
    };
    const gateway = new ModelGateway(x.store, cfg, provider);
    const result = retryCustom(cfg, (s) =>
      gateway.run("interpreter", x.owner, context!, s),
    );
    if (limit === 1) await assert.rejects(result, /quota/);
    else assert.equal(((await result) as { kind: string }).kind, "act");
    assert.equal(calls, limit);
    assert.equal(
      x.store.db
        .prepare("SELECT calls FROM quota_ledger WHERE scope='global'")
        .get()!.calls,
      limit,
    );
    assert.equal(
      x.store.db.prepare("SELECT COUNT(*) n FROM model_leases").get()!.n,
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
    true,
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

test("自定义行动失败说明区分超时、额度、配置与格式，明确未消耗行动", () => {
  for (const [code, word] of [
    ["timeout", "超时"],
    ["quota", "额度"],
    ["auth", "配置"],
    ["schema_invalid", "内容不完整"],
    ["network", "连接异常"],
  ] as const) {
    const text = customFailureMessage(code);
    assert.ok(text.includes(word));
    assert.ok(text.includes("尚未投骰或消耗行动"));
  }
});
