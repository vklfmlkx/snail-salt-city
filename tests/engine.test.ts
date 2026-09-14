import { test } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "../src/content/legacy/snail-scenario";
import { CharacterSchema, type Action, type State } from "../src/domain/types";
import {
  condition,
  validateCondition,
  validateEffect,
} from "../src/domain/conditions";
import {
  compileActionOptions,
  initialState,
  modifier,
  outcomeFromMargin,
  project,
  resolveTurn,
  validateScenario,
} from "../src/engine/rules";
import { reserveSlot, reserveSlotAtVersion } from "../src/domain/slots";
import { parseState } from "../src/domain/state-schema";
import { character, walk } from "./paths";
test("future last-slot concurrent fixture uses owner and optimistic version", async () => {
  let snapshot = {
    version: 2,
    slots: reserveSlot(reserveSlot([], "a", "one"), "a", "two"),
  };
  const attempts = ["three", "four"].map(async (id) => {
    const expected = snapshot.version;
    await Promise.resolve();
    snapshot = reserveSlotAtVersion(snapshot, expected, "a", id);
  });
  const results = await Promise.allSettled(attempts);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(snapshot.slots.length, 3);
  assert.throws(() => reserveSlot(snapshot.slots, "b", "one"));
});
test("persisted state runtime schema rejects corrupt values and cast drift", () => {
  const st = initialState(character, scenario);
  assert.deepEqual(parseState(st, scenario), st);
  assert.throws(() => parseState({ ...st, hp: -1 }, scenario));
  assert.throws(() =>
    parseState({ ...st, flags: { invented: true } }, scenario),
  );
  const other = structuredClone(st);
  other.castSnapshot[0].actorId = "actor_b";
  assert.throws(() => parseState(other, scenario));
});
test("public risk discloses worst resource loss, relationship changes actual consequences", () => {
  const st = initialState(character, scenario);
  st.counters.step = 2;
  assert.ok(
    project(st, scenario)
      .actions.find((a) => a.id === "s1.3.barrier")!
      .risk.includes("生命"),
  );
  st.stage = 5;
  const alone = resolveTurn(st, scenario, "s5.3.detour", 10);
  st.flags.support = true;
  const helped = resolveTurn(st, scenario, "s5.3.detour", 10);
  assert.equal(helped.state.supplies, alone.state.supplies + 1);
  assert.equal(helped.result.modifier, alone.result.modifier + 1);
});
test("published scenario: 6 stages, each node >=2 methods, 25 planned assets", () => {
  const v = validateScenario(scenario);
  assert.equal(v.stages, 6);
  assert.equal(v.plannedLayers, 25);
  assert.ok(v.actions > 60);
});
test("creation validates four integer stats and 20 total", () => {
  for (const stats of [
    { body: 9, agility: 3, mind: 4, presence: 4 },
    { body: 1, agility: 6, mind: 6, presence: 7 },
    { body: 5.5, agility: 4.5, mind: 5, presence: 5 },
    { body: 5, agility: 5, mind: 5, presence: 6 },
  ])
    assert.equal(
      CharacterSchema.safeParse({ ...character, stats }).success,
      false,
    );
});
test("margin boundaries and natural rolls have no override", () => {
  assert.deepEqual([-3, -2, -1, 0].map(outcomeFromMargin), [
    "failure",
    "partial",
    "partial",
    "success",
  ]);
  const s = initialState(
    { ...character, stats: { body: 4, agility: 4, mind: 8, presence: 4 } },
    scenario,
  );
  assert.equal(
    resolveTurn(s, scenario, "s1.1.notice", 1).result.outcome,
    "success",
  );
});
test("prepared only consumed on rolled checks and uses pre-turn injury; transitions clear it", () => {
  let s = initialState(character, scenario);
  s = resolveTurn(s, scenario, "s1.opt.prepare", null).state;
  assert.ok(s.prepared);
  assert.ok(
    !compileActionOptions(s, scenario).some((a) => a.id.endsWith(".prepare")),
  );
  s = resolveTurn(s, scenario, "s1.1.read", null).state;
  assert.ok(s.prepared);
  s.hp = 4;
  const a = compileActionOptions(s, scenario).find(
    (a) => a.id === "s1.2.sidestep",
  )!;
  assert.equal(modifier(s, a), 0);
  const r = resolveTurn(s, scenario, a.id, 1);
  assert.equal(r.result.modifier, 0);
  assert.equal(r.state.prepared, false);
  s = r.state;
  s.counters.step = 3;
  s.remaining = 1;
  s.prepared = true;
  s = resolveTurn(s, scenario, "s1.4.counter", null).state;
  assert.equal(s.stage, 2);
  assert.equal(s.prepared, false);
});
test("resource costs reject, consequences clamp, preparation gains cap", () => {
  let s = initialState(character, scenario);
  s.supplies = 0;
  assert.throws(() => resolveTurn(s, scenario, "s1.1.read", null));
  s = resolveTurn(s, scenario, "s1.1.notice", 1).state;
  assert.equal(s.supplies, 0);
  s.supplies = 5;
  s.counters.step = 3;
  assert.equal(resolveTurn(s, scenario, "s1.4.call", 10).state.supplies, 5);
});
test("condition DSL rejects arbitrary paths, wrong types, depth, empty arrays and unknown effects", () => {
  for (const c of [
    { kind: "compare", field: "__proto__.admin", op: "eq", value: true },
    { kind: "compare", field: "hp", op: "eq", value: true },
    { kind: "all", conditions: [] },
    { kind: "compare", field: "flag:clause", op: "gte", value: true },
  ])
    assert.throws(() => validateCondition(c as never, scenario));
  let deep: any = { kind: "always" };
  for (let i = 0; i < 6; i++) deep = { kind: "not", condition: deep };
  assert.throws(() => validateCondition(deep, scenario));
  assert.throws(() =>
    validateEffect({ kind: "eval", value: "x" } as never, scenario),
  );
  assert.equal(
    condition(
      { kind: "has_item", itemId: "box", quantity: 1 },
      initialState(character, scenario),
    ),
    false,
  );
});
for (const ending of [
  "caught",
  "contract_released",
  "temporary_containment",
  "narrow_escape",
] as const)
  test(`golden route ${ending}`, () => {
    const r = walk(ending);
    assert.equal(r.state.ending, ending);
    if (ending !== "caught") {
      assert.deepEqual(
        [...new Set(r.trace.map((t) => t.stage))],
        [1, 2, 3, 4, 5, 6],
      );
      assert.ok(r.trace.length >= 24 && r.trace.length <= 32);
    }
  });
test("typical exploration: 28 meaningful actions and 7000+ Chinese characters", () => {
  const r = walk("contract_released", true);
  assert.equal(r.trace.length, 28);
  assert.ok(
    r.chineseCharacters >= 7000,
    `${r.chineseCharacters} Chinese characters`,
  );
});
test("shortest nonfatal route is 24, structural lower bound without global turn gate", () => {
  const r = walk("narrow_escape");
  assert.equal(r.trace.length, 24);
  for (let stage = 1; stage <= 6; stage++) {
    assert.ok(scenario.stages[stage - 1].budget >= 4);
    for (let n = 0; n < 4; n++) {
      const a = scenario.actions.filter(
        (a) => a.stage === stage && a.step === n,
      );
      for (const x of a)
        for (const effects of Object.values(x.effects))
          assert.equal(
            effects
              .filter((e) => e.kind === "counter_delta" && e.id === "step")
              .reduce((v, e) => v + ("value" in e ? Number(e.value) : 0), 0),
            1,
          );
    }
  }
  assert.ok(
    scenario.actions
      .filter((a) =>
        Object.values(a.effects)
          .flat()
          .some(
            (e) =>
              e.kind === "flag_set" &&
              ["released", "contained", "escaped"].includes(e.id),
          ),
      )
      .every((a) => a.stage === 6 && a.step === 3),
  );
});
test("all minimum dice terminates without illegal resources or softlock", () => {
  const r = walk("narrow_escape", false, 1);
  assert.equal(r.state.status, "ended");
  assert.ok(r.trace.length <= 32);
  assert.ok(r.trace.every((t) => t.hp >= 0 && t.supplies >= 0));
});
test("normal transition takes precedence on final available action", () => {
  const s = initialState(character, scenario);
  s.counters.step = 3;
  s.remaining = 1;
  const r = resolveTurn(s, scenario, "s1.4.counter", null);
  assert.equal(r.state.stage, 2);
  assert.equal(r.state.supplies, 3);
  assert.equal(r.result.events.filter((e) => e.type === "stage").length, 1);
  assert.ok(r.result.events.some((e) => e.type === "stage" && !e.timeout));
});
test("timeouts all stages have consequences; final timeout is terminal", () => {
  for (let stage = 1; stage <= 6; stage++) {
    const s = initialState(character, scenario);
    s.stage = stage;
    s.remaining = 1;
    s.counters.step = 0;
    const a = compileActionOptions(s, scenario).find((a) => a.core)!;
    const r = resolveTurn(s, scenario, a.id, a.attribute ? 10 : null);
    assert.equal(r.state.stage, Math.min(6, stage + 1));
    if (stage === 6) assert.equal(r.state.ending, "caught");
    else assert.equal(r.state.status, "playing");
  }
});
test("death lock wins over healing and simultaneous success", () => {
  const s = initialState(character, scenario);
  const modified = structuredClone(scenario);
  const a = modified.actions.find((a) => a.id === "s1.1.notice")!;
  a.effects.success = [
    { kind: "resource_delta", resource: "hp", value: -10 },
    { kind: "resource_delta", resource: "hp", value: 10 },
    { kind: "flag_set", id: "escaped", value: true },
  ];
  const r = resolveTurn(s, modified, a.id, 10);
  assert.equal(r.state.hp, 0);
  assert.equal(r.state.ending, "caught");
});
test("missing items and evidence cannot unlock routes; same reward unavailable twice", () => {
  const s = initialState(character, scenario);
  s.stage = 5;
  s.counters.step = 1;
  const ids = compileActionOptions(s, scenario).map((a) => a.id);
  assert.ok(!ids.includes("s5.2.release"));
  assert.ok(!ids.includes("s5.2.container"));
  assert.ok(!ids.includes("s5.2.vehicle"));
  assert.ok(ids.includes("s5.2.flight"));
  s.stage = 3;
  s.counters.step = 1;
  const next = resolveTurn(s, scenario, "s3.2.box", null).state;
  assert.throws(() => resolveTurn(next, scenario, "s3.2.box", null));
  assert.ok(
    !compileActionOptions(next, scenario).some((a) => a.id === "s3.opt.backup"),
  );
});
test("public projection hides flags, full scenario and future facts; cast locked", () => {
  const s = initialState(character, scenario);
  const p = project(s, scenario);
  const wire = JSON.stringify(p);
  assert.ok(!wire.includes("clause"));
  assert.ok(!wire.includes("effects"));
  assert.ok(!Object.hasOwn(p, "flags"));
  assert.deepEqual(
    p.render.characters.map((c) => c.roleId),
    ["keeper"],
  );
  assert.deepEqual(p.render.props, []);
  s.stage = 4;
  s.facts.push("records_visible");
  assert.ok(project(s, scenario).render.props.includes("prop.record_folder"));
  assert.deepEqual(
    project(s, scenario).render.characters.map((c) => c.actorId),
    ["actor_b"],
  );
});
test("future slots reserved + ready <=3 and owner separation; curated does not occupy", () => {
  let slots: any[] = [];
  for (let n = 0; n < 3; n++) slots = reserveSlot(slots, "a", String(n));
  assert.throws(() => reserveSlot(slots, "a", "four"));
  assert.equal(reserveSlot(slots, "b", "other").length, 4);
  assert.equal(reserveSlot(slots, "a", "2").length, 3);
  slots[0].status = "failed";
  assert.equal(reserveSlot(slots, "a", "new").length, 4);
});
