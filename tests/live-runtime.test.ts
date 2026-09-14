import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchBudget } from "../src/server/research-budget";
import { BudgetedProvider } from "../src/server/budgeted-provider";
import {
  requestBody,
  MockProvider,
  validateNarration,
  type Context,
} from "../src/server/ai";
import { readConfig } from "../src/server/config";
import {
  homecoming,
  currentScenario,
  scenarios,
} from "../src/content/registry";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import { legacyGame } from "./legacy-fixture";
import { character } from "./paths";
import {
  initialState,
  resolveTurn,
  compileActionOptions,
} from "../src/engine/rules";
import { parseState } from "../src/domain/state-schema";

test("retired scenario is unavailable for creation; starting new game archives old save without deletion", () => {
  const store = new Store(":memory:"),
    service = new GameService(store, readConfig({}));
  const owner = service.visitor().auth.owner,
    old = legacyGame(service, owner, character).state;
  assert.equal(scenarios.length, 20);
  assert.ok(scenarios.every((s) => s.version.startsWith("curated-")));
  assert.throws(
    () => service.create(owner, { ...character, scenarioVersion: "0.5.0" }),
    { status: 410 },
  );
  assert.equal(
    service.create(owner, character).state.scenarioVersion,
    currentScenario.version,
  );
  assert.equal(service.read(owner, old.id).state.status, "abandoned");
  store.close();
});
test("side checks preserve scene, facts and main action budget; eight interactions still allow full ending", () => {
  let st = initialState(character, homecoming),
    interactions = 0;
  while (st.status === "playing") {
    const choices = compileActionOptions(st, homecoming);
    const side =
      interactions < 8 ? choices.find((a) => a.stageCost === 0) : undefined;
    const action =
      side ??
      choices.find((a) => a.id === "hc.end.stars") ??
      choices.find((a) => a.id.endsWith(".0"))!;
    const next = resolveTurn(
      st,
      homecoming,
      action.id,
      action.attribute ? 10 : null,
    ).state;
    if (side) {
      interactions++;
      assert.deepEqual(next.facts, st.facts);
      assert.equal(next.counters.step, st.counters.step);
      assert.equal(next.remaining, st.remaining);
    }
    st = parseState(JSON.parse(JSON.stringify(next)), homecoming);
  }
  assert.equal(st.turn, 32);
  assert.equal(st.ending, "stars");
});
test("custom method and same-scene dialogue survive atomic commit and reach next narrator context", async () => {
  const store = new Store(":memory:");
  const contexts: Context[] = [];
  const provider = new MockProvider();
  provider.interpret = async (c) => ({
    kind: "act",
    actionOptionId: c.actions.find((a) => a.id.includes(".side.presence"))!.id,
    intent: c.text,
    inputSpan: c.text,
    message: null,
  });
  provider.narrate = async (c) => {
    contexts.push(c);
    return {
      reaction: "",
      description: "",
      dialogue: [
        {
          roleId: "player",
          text: "我还有一个问题。",
          expressionId: "hero_f.face.neutral",
        },
        {
          roleId: "student",
          text: "老师，您说，我听着。",
          expressionId: "zhou.face.neutral",
        },
      ],
      usedFactIds: [],
    };
  };
  const service = new GameService(store, readConfig({}), () => 7, provider),
    owner = service.visitor().auth.owner;
  let state = service.create(owner, {
    ...character,
    scenarioVersion: homecoming.version,
  }).state;
  for (const text of ["我想和学生聊聊他为什么喜欢魔法。", "指出论文缺乏证据"]) {
    const p = await service.propose(owner, state.id, {
      expectedStateVersion: state.version,
      ...(state.turn ? { actionOptionId: "hc.s1.1.0" } : { text }),
    });
    assert.ok("proposal" in p);
    const b = {
      expectedStateVersion: state.version,
      clientTurnId: randomUUID(),
      proposalId: p.proposal.id,
    };
    const c = service.commit(owner, state.id, b);
    assert.deepEqual(service.commit(owner, state.id, b), c);
    if (!state.turn) assert.equal(c.turn.result.actionLabel, text);
    state = c.state;
    await service.narrate(owner, state.id, c.turn.id);
  }
  assert.equal(
    contexts[1].drama?.previousDialogue?.at(-1)?.text,
    "老师，您说，我听着。",
  );
  const payload = JSON.parse(
    requestBody("narrator", contexts[1], readConfig({})).messages[1].content,
  );
  assert.equal(payload.drama.previousDialogue.length, 2);
  const sidePayload = JSON.parse(
    requestBody("narrator", contexts[0], readConfig({})).messages[1].content,
  );
  assert.ok(!JSON.stringify(sidePayload).includes("飞机"));
  assert.equal(sidePayload.drama.nextGoal, undefined);
  assert.ok(!sidePayload.drama.goal.includes("驳回"));
  assert.throws(
    () =>
      validateNarration(
        {
          reaction: "",
          description: "",
          dialogue: [
            {
              roleId: "player",
              text: "论文驳回，日记留下。",
              expressionId: "hero_f.face.neutral",
            },
            {
              roleId: "student",
              text: "我看见了飞机。",
              expressionId: "zhou.face.neutral",
            },
          ],
          usedFactIds: [],
        },
        contexts[0],
      ),
    { code: "illegal_reference" },
  );
  store.close();
});
test("runtime budget settles independent concurrent reservations and blocks exhausted calls before fetch", async () => {
  const budget = new ResearchBudget(":memory:");
  let calls = 0;
  const cfg = readConfig({
    LLM_MODE: "live",
    AI_LIVE_ENABLED: "true",
    LLM_GLOBAL_DAILY_CALL_LIMIT: "100",
    DEEPSEEK_API_KEY: "synthetic",
  });
  const c: Context = {
    scene: "test",
    facts: [],
    actions: [],
    text: "查看线索",
    roles: [],
  };
  const fetcher: typeof fetch = async () => {
    const n = ++calls;
    return new Response(
      JSON.stringify({
        usage: { prompt_tokens: n * 10, completion_tokens: n * 20 },
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                kind: "view",
                actionOptionId: null,
                intent: "查看线索",
                inputSpan: null,
                message: null,
              }),
            },
          },
        ],
      }),
    );
  };
  const provider = new BudgetedProvider(cfg, budget, fetcher, () => {});
  await Promise.all([provider.interpret(c), provider.interpret(c)]);
  assert.deepEqual(
    budget
      .report()
      .map((r) => r.charged)
      .sort((a, b) => Number(a) - Number(b)),
    [180, 360],
  );
  budget.close();
  const empty = new ResearchBudget(":memory:", 0);
  await assert.rejects(
    new BudgetedProvider(cfg, empty, fetcher, () => {}).interpret(c),
    { code: "quota" },
  );
  assert.equal(calls, 2);
  empty.close();
});
