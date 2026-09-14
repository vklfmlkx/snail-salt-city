import { legacyGame } from "./legacy-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/database";
import { GameService, checkWrite } from "../src/server/service";
import { readConfig } from "../src/server/config";
import { AIError, MockProvider, type Provider } from "../src/server/ai";
import { character } from "./paths";
import { routeAction } from "./paths";
import { scenario } from "../src/content/legacy/snail-scenario";
import { parseState } from "../src/domain/state-schema";
for (const ending of [
  "contract_released",
  "temporary_containment",
  "narrow_escape",
] as const)
  test(`full persisted ${ending} route with proposals and narration`, async () => {
    const store = new Store(":memory:"),
      svc = new GameService(store, readConfig({}), () => 10);
    const owner = svc.visitor().auth.owner;
    let state = legacyGame(svc, owner, character).state;
    while (state.status === "playing") {
      const raw = store.db
        .prepare("SELECT state_json FROM games WHERE id=?")
        .get(state.id) as { state_json: string };
      const internal = parseState(JSON.parse(raw.state_json), scenario);
      let id = routeAction(internal, ending);
      if (
        ending === "contract_released" &&
        internal.stage === 2 &&
        !internal.flags.clause
      )
        id = "s2.opt.clause";
      if (
        ending === "contract_released" &&
        internal.stage === 4 &&
        !internal.flags.signature
      )
        id = "s4.opt.signature"; // Advance synthetic rate-limit clock buckets; production has no test bypass.
      store.db
        .prepare("DELETE FROM preview_limits WHERE principal_id=?")
        .run(owner);
      const p = (await svc.propose(owner, state.id, {
        expectedStateVersion: state.version,
        actionOptionId: id,
      })) as any;
      const committed = svc.commit(owner, state.id, {
        expectedStateVersion: state.version,
        proposalId: p.proposal.id,
        clientTurnId: randomUUID(),
      });
      state = committed.state;
      await svc.narrate(owner, state.id, committed.turn.id);
    }
    assert.equal(state.ending?.id, ending);
    assert.equal(svc.history(owner, state.id).length, state.turn);
    assert.equal(svc.me(svc.visitor().auth).summaries.length, 0);
    store.close();
  });
function setup(provider?: Provider, file = ":memory:") {
  const store = new Store(file);
  const svc = new GameService(store, readConfig({}), () => 7, provider);
  const v = svc.visitor(),
    owner = v.auth.owner;
  const game = legacyGame(svc, owner, character).state;
  return { store, svc, v, owner, game };
}
async function proposal(x: ReturnType<typeof setup>) {
  const p = await x.svc.propose(x.owner, x.game.id, {
    expectedStateVersion: 0,
    actionOptionId: "s1.1.notice",
  });
  assert.equal(p.kind, "act");
  return (p as any).proposal;
}
test("visitor uses hashed 32-byte token, cookie expiry and owner isolation", async () => {
  const x = setup();
  assert.equal(x.v.token?.length, 64);
  const row = x.store.db.prepare("SELECT * FROM visitor_sessions").get()!;
  assert.ok(!JSON.stringify(row).includes(x.v.token!));
  assert.equal(x.svc.visitor(x.v.token).token, null);
  const other = x.svc.visitor().auth.owner;
  assert.throws(() => x.svc.read(other, x.game.id), { status: 404 });
  const p = await proposal(x);
  assert.throws(
    () =>
      x.svc.commit(other, x.game.id, {
        proposalId: p.id,
        clientTurnId: randomUUID(),
        expectedStateVersion: 0,
      }),
    { status: 404 },
  );
  const otherNew = x.svc.visitor().auth.owner;
  x.svc.create(otherNew, character);
  assert.throws(() => x.svc.create(otherNew, character), { status: 409 });
  assert.throws(() => x.svc.create(x.owner, { ...character, ownerId: other }));
  x.store.close();
});
test("proposal is zero-cost; same idempotency key replays before version check; conflicts rejected", async () => {
  const x = setup();
  const p = await proposal(x);
  assert.equal(x.svc.read(x.owner, x.game.id).state.turn, 0);
  const payload = {
    proposalId: p.id,
    clientTurnId: randomUUID(),
    expectedStateVersion: 0,
  };
  const one = x.svc.commit(x.owner, x.game.id, payload);
  const two = x.svc.commit(x.owner, x.game.id, payload);
  assert.deepEqual(one, two);
  assert.equal(one.state.turn, 1);
  assert.throws(
    () =>
      x.svc.commit(x.owner, x.game.id, {
        ...payload,
        proposalId: randomUUID(),
      }),
    { status: 409 },
  );
  assert.throws(
    () =>
      x.svc.commit(x.owner, x.game.id, {
        ...payload,
        clientTurnId: randomUUID(),
      }),
    { status: 409 },
  );
  x.store.close();
});
test("two old-version proposals: exactly one commit; transaction failure rolls back state and dice event", async () => {
  const x = setup();
  const p = await proposal(x),
    q = await proposal(x);
  x.store.db.exec(
    "CREATE TRIGGER fail_turn BEFORE INSERT ON turns BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  assert.throws(() =>
    x.svc.commit(x.owner, x.game.id, {
      proposalId: p.id,
      clientTurnId: randomUUID(),
      expectedStateVersion: 0,
    }),
  );
  assert.equal(x.svc.read(x.owner, x.game.id).state.version, 0);
  x.store.db.exec("DROP TRIGGER fail_turn");
  const outcomes = await Promise.allSettled(
    [p, q].map(async (p) =>
      x.svc.commit(x.owner, x.game.id, {
        proposalId: p.id,
        clientTurnId: randomUUID(),
        expectedStateVersion: 0,
      }),
    ),
  );
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(x.svc.read(x.owner, x.game.id).state.turn, 1);
  x.store.close();
});
test("SQLite restart and lost response preserve exact state and dice; abandon explicit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snail-test-")),
    file = join(dir, "save.db");
  const x = setup(undefined, file);
  const p = await proposal(x),
    payload = {
      proposalId: p.id,
      clientTurnId: randomUUID(),
      expectedStateVersion: 0,
    },
    one = x.svc.commit(x.owner, x.game.id, payload);
  x.store.close();
  const db = new Store(file),
    svc = new GameService(db, readConfig({}), () => 1);
  assert.ok(svc.auth(x.v.token));
  const two = svc.commit(x.owner, x.game.id, payload);
  assert.deepEqual(one, two);
  assert.throws(() =>
    svc.abandon(x.owner, x.game.id, {
      expectedStateVersion: 1,
      confirm: false,
    }),
  );
  svc.abandon(x.owner, x.game.id, { expectedStateVersion: 1, confirm: true });
  assert.ok(svc.create(x.owner, character).state.id);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
test("narration claim once, fallback retained, late old narration never mutates game", async () => {
  let calls = 0;
  class Fail extends MockProvider {
    async narrate(): Promise<never> {
      calls++;
      throw new AIError("timeout");
    }
  }
  const x = setup(new Fail());
  const p = await proposal(x);
  const turn = x.svc.commit(x.owner, x.game.id, {
    proposalId: p.id,
    clientTurnId: randomUUID(),
    expectedStateVersion: 0,
  }).turn;
  await Promise.all([
    x.svc.narrate(x.owner, x.game.id, turn.id),
    x.svc.narrate(x.owner, x.game.id, turn.id),
  ]);
  assert.equal(calls, 1);
  const t = (await x.svc.narrate(x.owner, x.game.id, turn.id)).turn;
  assert.equal(t.narrationStatus, "fallback");
  assert.equal(t.errorCode, "timeout");
  assert.ok(t.result.fallback.length > 200);
  assert.equal(x.svc.read(x.owner, x.game.id).state.version, 1);
  x.store.close();
});
test("crashed running narration lease expires without retry or charge", async () => {
  const x = setup();
  const p = await proposal(x);
  const t = x.svc.commit(x.owner, x.game.id, {
    proposalId: p.id,
    clientTurnId: randomUUID(),
    expectedStateVersion: 0,
  }).turn;
  x.store.db
    .prepare(
      "UPDATE turns SET narration_status='running',narration_attempt_count=1,narration_lease_until=0 WHERE id=?",
    )
    .run(t.id);
  assert.equal(
    (await x.svc.narrate(x.owner, x.game.id, t.id)).turn.narrationStatus,
    "fallback",
  );
  x.store.close();
});
test("explanation timeout preserves actions, expired preview and schema forged dice rejected", async () => {
  class Fail extends MockProvider {
    async interpret(): Promise<never> {
      throw new AIError("timeout");
    }
  }
  const x = setup(new Fail());
  const r = await x.svc.propose(x.owner, x.game.id, {
    expectedStateVersion: 0,
    text: "核对通知",
  });
  assert.equal(r.kind, "fallback");
  assert.equal(x.svc.read(x.owner, x.game.id).state.version, 0);
  const p = await proposal(x);
  x.store.db.prepare("UPDATE proposals SET expires_at=0 WHERE id=?").run(p.id);
  assert.throws(
    () =>
      x.svc.commit(x.owner, x.game.id, {
        proposalId: p.id,
        clientTurnId: randomUUID(),
        expectedStateVersion: 0,
      }),
    { status: 409 },
  );
  assert.throws(() =>
    x.svc.commit(x.owner, x.game.id, {
      proposalId: p.id,
      clientTurnId: randomUUID(),
      expectedStateVersion: 0,
      die: 10,
    }),
  );
  x.store.close();
});
test("Origin + CSRF checks do not trust Host, production cookie uses __Host-", () => {
  const c = readConfig({});
  const req = (origin: string, csrf: string) =>
    new Request("http://evil.test/api/sessions", {
      method: "POST",
      headers: {
        Origin: origin,
        Host: "localhost:3000",
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
    });
  assert.throws(() => checkWrite(req("http://evil.test", "abc"), c, "abc"), {
    status: 403,
  });
  assert.throws(() => checkWrite(req(c.APP_ORIGIN, "bad"), c, "abc"), {
    status: 403,
  });
  checkWrite(req(c.APP_ORIGIN, "abc"), c, "abc");
  const s = new Store(":memory:");
  assert.equal(
    new GameService(s, readConfig({ APP_ORIGIN: "https://example.test" }))
      .cookieName,
    "__Host-snail_sid",
  );
  s.close();
});
test("preview rate is independent of successful commits", async () => {
  const x = setup();
  for (let i = 0; i < 12; i++) await proposal(x);
  await assert.rejects(proposal(x), { status: 429 });
  x.store.close();
});
