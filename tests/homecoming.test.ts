import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homecoming } from "../src/content/registry";
import { FrameworkSchema } from "../src/content/framework-schema";
import source from "../src/content/generated/homecoming.json";
import {
  initialState,
  resolveTurn,
  compileActionOptions,
  validateScenario,
} from "../src/engine/rules";
import { parseState } from "../src/domain/state-schema";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import { readConfig } from "../src/server/config";
import {
  AIError,
  MockProvider,
  validateNarration,
  requestBody,
  type Context,
} from "../src/server/ai";
import { ResearchBudget } from "../src/server/research-budget";
const character = {
  name: "审校",
  background: "",
  stats: { body: 5, agility: 5, mind: 5, presence: 5 },
  avatar: "hero_m" as const,
};
for (const [ending, branch, die] of [
  ["return", 0, 10],
  ["home", 1, 10],
  ["stars", 0, 10],
  ["shelter", 0, 1],
] as const)
  test(`model framework: ${ending} route, exact state reload, ending conditions`, () => {
    validateScenario(homecoming);
    let st = initialState(character, homecoming);
    while (st.status === "playing") {
      const options = compileActionOptions(st, homecoming);
      const end = options.find((a) => a.id === `hc.end.${ending}`);
      const action = end ?? options.find((a) => a.id.endsWith(`.${branch}`))!;
      assert.ok(action);
      st = resolveTurn(
        st,
        homecoming,
        action.id,
        action.attribute ? die : null,
      ).state;
      assert.deepEqual(
        parseState(JSON.parse(JSON.stringify(st)), homecoming),
        st,
      );
      assert.ok(st.turn <= 24);
    }
    assert.equal(st.ending, ending);
    assert.equal(st.character.avatar, "hero_m");
    assert.equal(st.turn, ending === "return" ? 8 : 24);
  });
test("generated opening and cast reject spoilers and future roles", () => {
  const f = structuredClone(source);
  f.premise += "灵魂回现代";
  assert.equal(FrameworkSchema.safeParse(f).success, false);
  f.premise = source.premise;
  f.chapters[0].roles = ["visitor"];
  assert.equal(FrameworkSchema.safeParse(f).success, false);
});
test("new game service preserves atomic dice and avatar; narration failure never changes state", async () => {
  const store = new Store(":memory:");
  const provider = new MockProvider();
  provider.narrate = async () => {
    throw new AIError("timeout");
  };
  const service = new GameService(store, readConfig({}), () => 3, provider);
  const owner = service.visitor().auth.owner;
  const state = service.create(owner, {
    ...character,
    scenarioVersion: homecoming.version,
  }).state;
  const p = await service.propose(owner, state.id, {
    expectedStateVersion: 0,
    actionOptionId: state.actions[0].id,
  });
  assert.ok("proposal" in p);
  const body = {
    clientTurnId: randomUUID(),
    proposalId: p.proposal.id,
    expectedStateVersion: 0,
  };
  const first = service.commit(owner, state.id, body);
  assert.deepEqual(service.commit(owner, state.id, body), first);
  assert.equal(first.turn.result.die, 3);
  const n = await service.narrate(owner, state.id, first.turn.id);
  assert.equal(n.turn.errorCode, "timeout");
  assert.deepEqual(service.read(owner, state.id).state, first.state);
  store.close();
});
test("persistent research budget reserves uncertain requests and refuses excess without a call", () => {
  const dir = mkdtempSync(join(tmpdir(), "snail-budget-")),
    path = join(dir, "budget.sqlite");
  let b = new ResearchBudget(path, 20000);
  const id = b.reserve("uncertain", "a", 100);
  assert.throws(() => b.reserve("too-large", "b", 2000));
  b.close();
  b = new ResearchBudget(path, 20000);
  assert.equal(b.report().length, 1);
  b.settle(id, { prompt_tokens: 100, completion_tokens: 100 });
  assert.equal(b.report()[0].charged, 1000);
  b.settle(id, { prompt_tokens: 0, completion_tokens: 0 });
  assert.equal(b.report()[0].charged, 1000);
  b.close();
  rmSync(dir, { recursive: true });
});
test("drama requires expression tags, few narration lines and only current speakers", () => {
  const c: Context = {
    scene: "塔",
    facts: [],
    actions: [],
    text: "",
    roles: [{ roleId: "player", expressions: ["hero_m.face.neutral"] }],
    drama: {
      goal: "收拾",
      time: "现在",
      stage: 1,
      step: 1,
      voices: { visitor: "不应发送的未来角色" },
    },
  };
  const n = {
    reaction: "",
    description: "",
    dialogue: [
      {
        roleId: "player",
        text: "记录看过了。",
        expressionId: "hero_m.face.neutral",
      },
      {
        roleId: "player",
        text: "先收拾背包。",
        expressionId: "hero_m.face.neutral",
      },
    ],
    usedFactIds: [],
  };
  assert.doesNotThrow(() => validateNarration(n, c));
  assert.throws(() =>
    validateNarration(
      { ...n, dialogue: n.dialogue.map((d) => ({ ...d, expressionId: null })) },
      c,
    ),
  );
  assert.throws(() =>
    validateNarration(
      {
        ...n,
        dialogue: [
          ...n.dialogue,
          {
            roleId: "visitor",
            text: "我来了",
            expressionId: "hero_m.face.neutral",
          },
        ],
      },
      c,
    ),
  );
  const payload = JSON.parse(
    requestBody("narrator", c, readConfig({})).messages[1].content,
  );
  assert.deepEqual(payload.drama.voices, {});
});
test("reviewed model rehearsal replays all 24 turns with expressions and no paid calls", async () => {
  const store = new Store(":memory:");
  const service = new GameService(store, readConfig({}), () => 10);
  const owner = service.visitor().auth.owner;
  let state = service.create(owner, {
    ...character,
    scenarioVersion: homecoming.version,
  }).state;
  for (let n = 0; n < 24; n++) {
    store.db.prepare("DELETE FROM preview_limits").run();
    const action =
      state.actions.find((a) => a.id === "hc.end.stars") ??
      state.actions.find((a) => !a.id.startsWith("hc.end."))!;
    const p = await service.propose(owner, state.id, {
      expectedStateVersion: state.version,
      actionOptionId: action.id,
    });
    assert.ok("proposal" in p);
    const turn = service.commit(owner, state.id, {
      proposalId: p.proposal.id,
      clientTurnId: randomUUID(),
      expectedStateVersion: state.version,
    });
    state = turn.state;
    const r = await service.narrate(owner, state.id, turn.turn.id);
    assert.equal(r.turn.narrationStatus, "ready");
    assert.ok(r.turn.narration!.dialogue.length >= 4);
    assert.ok(r.turn.narration!.dialogue.every((d) => d.expressionId !== null));
    assert.ok(
      r.turn.narration!.dialogue.some(
        (d) => d.roleId === "player" && d.expressionId!.startsWith("hero_m."),
      ),
    );
  }
  assert.equal(state.ending?.id, "stars");
  store.close();
});
