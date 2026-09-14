import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { currentScenario as s } from "../src/content/registry";
import { ScriptBookSchema } from "../src/content/script-book";
import { initialState, resolveTurn, project } from "../src/engine/rules";
import { checkChances } from "../src/domain/check-chances";
import { validateBranches } from "../scripts/branch-validation";
import { GameService } from "../src/server/service";
import { Store } from "../src/server/database";
import { readConfig } from "../src/server/config";
import { MockProvider, AIError } from "../src/server/ai";
const c = {
  name: "青梅",
  background: "测试",
  stats: { body: 5, agility: 5, mind: 5, presence: 5 },
};
test("published branch text keeps early and late timelines separate", () => {
  const end = (id: string) =>
    s
      .book!.endings.find((e) => e.id === id)!
      .dialogue.map((d) => d.text)
      .join("");
  assert.doesNotMatch(end("bad_departure"), /三个月|克隆|魔力会慢慢少/);
  assert.doesNotMatch(end("bad_stranded"), /灵魂|发电机|药喂了|第十个月，/);
  assert.doesNotMatch(end("good_home"), /未婚|无子|百岁|要在异世界好好活着/);
  assert.equal(end("true").split("要在异世界好好活着").length - 1, 1);
  assert.match(s.book!.stages[7].opening[0].text, /餐桌/);
});
test("full manuscript context fits the adapter limit and uses unprefixed expression enums", async () => {
  const db = new Store(":memory:"),
    mock = new MockProvider(),
    seen: string[] = [];
  const provider = new MockProvider();
  provider.interpret = async (ctx) => {
    assert.ok(JSON.stringify(ctx).length < 24000);
    assert.equal(ctx.actions.length, 48);
    assert.ok(
      ctx.roles.every(
        (r) =>
          r.expressions.includes("neutral") &&
          !r.expressions.some((e) => e.includes(".face.")),
      ),
    );
    seen.push(ctx.text);
    return mock.interpret(ctx);
  };
  const svc = new GameService(db, readConfig({}), () => 10, provider),
    owner = svc.visitor().auth.owner,
    st = svc.create(owner, c).state;
  const text = "我和阿瑟斯搬好行李，准备出发";
  const p = await svc.propose(owner, st.id, {
    text,
    mode: "key",
    expectedStateVersion: 0,
  });
  assert.ok("proposal" in p);
  assert.deepEqual(seen, [text]);
  assert.ok(p.proposal.action.id.startsWith("book.s1.custom.body.body."));
  db.close();
});
test("all six branching endings reachable, including early exits and eight-action detours", () => {
  const result = validateBranches(s);
  assert.equal(result.routes.length, 6);
  assert.equal(Math.min(...result.routes.map((r) => r.min)), 1);
  assert.equal(Math.max(...result.routes.map((r) => r.max)), 8);
  assert.deepEqual(s.book!.endings.map((e) => e.category).sort(), [
    "bad",
    "bad",
    "bad",
    "good",
    "good",
    "true",
  ]);
  assert.ok(s.actions.every((a) => a.stageCost === 1));
});
test("difficulty has measurable failure; default balanced normal is 40/20/40", () => {
  assert.deepEqual(checkChances(5, 12), {
    success: 40,
    partial: 20,
    failure: 40,
  });
  assert.deepEqual(checkChances(5, 8), {
    success: 80,
    partial: 20,
    failure: 0,
  });
  assert.deepEqual(checkChances(5, 14), {
    success: 20,
    partial: 20,
    failure: 60,
  });
  assert.deepEqual(checkChances(8, 12), {
    success: 70,
    partial: 20,
    failure: 10,
  });
  for (const [difficulty, dc] of [
    ["story", 8],
    ["normal", 12],
    ["hard", 14],
  ] as const) {
    const st = initialState({ ...c, difficulty }, s);
    const counts = { success: 0, partial: 0, failure: 0 };
    for (let die = 1; die <= 10; die++) {
      const r = resolveTurn(st, s, "book.s1.key.body", die);
      assert.equal(r.result.difficulty, dc);
      counts[r.result.outcome as keyof typeof counts] += 10;
    }
    assert.deepEqual(counts, checkChances(5, dc));
  }
});
test("true ending requires both meaningful milestones, not a total success score", () => {
  function play(community: boolean, archive: boolean) {
    let st = initialState(c, s);
    for (const attr of [
      "body",
      "mind",
      community ? "presence" : "body",
      "body",
      archive ? "mind" : "body",
      "mind",
    ]) {
      st = resolveTurn(st, s, `book.s${st.stage}.key.${attr}`, 10).state;
    }
    return st;
  }
  assert.equal(play(true, true).ending, "true");
  assert.equal(play(false, true).ending, "good_home");
  assert.equal(play(true, false).ending, "good_home");
});
test("custom direction is independent of attribute; returning cannot silently become staying", () => {
  const st = resolveTurn(initialState(c, s), s, "book.s1.key.body", 10).state;
  const r = resolveTurn(st, s, "book.s3.custom.presence.mind.standard", 10);
  assert.equal(r.result.attribute, "mind");
  assert.equal(r.state.ending, "good_return");
  assert.ok(!JSON.stringify(project(st, s)).includes("bad_closed"));
});
test("malformed branch graph rejects cycles, invented flags and missing endings", () => {
  for (const mutate of [
    (b: any) => (b.stages[0].choices[0].routes.success.stage = 1),
    (b: any) => (b.stages[0].choices[0].routes.success.grants = ["invented"]),
    (b: any) => b.endings.pop(),
  ]) {
    const b = structuredClone(s.book);
    mutate(b);
    assert.equal(ScriptBookSchema.safeParse(b).success, false);
  }
});
test("every ending survives service save/read and duplicate commit with no model calls", async () => {
  for (const route of validateBranches(s).routes) {
    const db = new Store(":memory:"),
      p = new MockProvider();
    let die = 10;
    p.interpret = async () => {
      throw Error("preset must not call model");
    };
    p.narrate = async () => {
      throw Error("no runtime narrator");
    };
    const svc = new GameService(db, readConfig({}), () => die, p),
      owner = svc.visitor().auth.owner;
    let st = svc.create(owner, c).state;
    for (const step of route.path) {
      const [id, n] = step.split(":");
      die = Number(n);
      const pre = await svc.propose(owner, st.id, {
        actionOptionId: id,
        expectedStateVersion: st.version,
      });
      assert.ok("proposal" in pre);
      const input = {
        proposalId: pre.proposal.id,
        expectedStateVersion: st.version,
        clientTurnId: randomUUID(),
      };
      const r = svc.commit(owner, st.id, input);
      assert.deepEqual(svc.commit(owner, st.id, input), r);
      assert.equal(r.turn.narrationStatus, "ready");
      st = r.state;
      assert.deepEqual(svc.read(owner, st.id).state, st);
    }
    assert.equal(st.ending!.id, route.ending);
    db.close();
  }
});
test("side actions rejected and timeout leaves state unchanged with preset fallback available", async () => {
  const db = new Store(":memory:"),
    p = new MockProvider();
  let calls = 0;
  p.interpret = async () => {
    calls++;
    throw new AIError("timeout");
  };
  const svc = new GameService(db, readConfig({}), () => 1, p),
    owner = svc.visitor().auth.owner,
    st = svc.create(owner, c).state;
  const side = await svc.propose(owner, st.id, {
    text: "活动肩膀",
    mode: "side",
    expectedStateVersion: 0,
  });
  assert.equal(side.kind, "unsupported");
  assert.equal(calls, 0);
  const pre = await svc.propose(owner, st.id, {
    text: "与阿瑟斯搬运行李",
    mode: "key",
    expectedStateVersion: 0,
  });
  assert.equal(pre.kind, "fallback");
  assert.equal(calls, 1);
  assert.deepEqual(svc.read(owner, st.id).state, st);
  assert.ok(
    "proposal" in
      (await svc.propose(owner, st.id, {
        actionOptionId: "book.s1.key.body",
        expectedStateVersion: 0,
      })),
  );
  db.close();
});
