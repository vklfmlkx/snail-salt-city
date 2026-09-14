import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import { readConfig } from "../src/server/config";
import { curatedBooks } from "../src/content/curated";
import { clearPlayHistory } from "../src/server/clear-play-history";
test("仅清理已核对的旧版本，保留新版、生成稿、访客凭证及用量", () => {
  const store = new Store(":memory:");
  const svc = new GameService(store, readConfig({}));
  const visitor = svc.visitor();
  const character = {
    name: "验证",
    background: "离线",
    stats: { body: 5, agility: 5, mind: 5, presence: 5 },
    scenarioVersion: curatedBooks[0].version,
  };
  const old = svc.create(visitor.auth.owner, character);
  store.db
    .prepare("UPDATE games SET scenario_version=? WHERE id=?")
    .run("curated-double-door-1.2", old.state.id);
  const other = svc.visitor();
  const current = svc.create(other.auth.owner, character);
  store.db
    .prepare("INSERT INTO quota_ledger VALUES(?,?,?)")
    .run("2026-09-14", "global", 9);
  store.db
    .prepare("INSERT INTO generated_books VALUES(?,?,?,?)")
    .run("generated-old", visitor.auth.owner, "{}", Date.now());
  store.db
    .prepare("INSERT INTO ending_collection VALUES(?,?,?,?,?,?,?)")
    .run(
      visitor.auth.owner,
      "curated-double-door-1.2",
      "bad",
      "旧结局",
      "坏结局",
      "[]",
      Date.now(),
    );
  const result = clearPlayHistory(
    store,
    ["curated-double-door-1.2"],
    Date.now(),
  );
  assert.equal(result.games, 1);
  assert.equal(result.collection, 1);
  assert.equal(
    store.db.prepare("SELECT count(*) as n FROM generated_books").get()?.n,
    1,
  );
  assert.equal(
    svc.read(other.auth.owner, current.state.id).state.scenarioVersion,
    curatedBooks[0].version,
  );
  assert.throws(() => svc.read(visitor.auth.owner, old.state.id), /没有找到/);
  assert.equal(svc.collection(visitor.auth.owner).length, 0);
  assert.equal(svc.auth(visitor.token)?.owner, visitor.auth.owner);
  assert.equal(
    store.db.prepare("SELECT calls FROM quota_ledger").get()?.calls,
    9,
  );
  assert.equal(
    svc.create(visitor.auth.owner, character).state.scenarioVersion,
    curatedBooks[0].version,
  );
  assert.equal(
    clearPlayHistory(store, ["curated-double-door-1.2"], Date.now()).games,
    0,
  );
  assert.throws(
    () => clearPlayHistory(store, [curatedBooks[0].version], Date.now()),
    /retired/,
  );
  store.close();
});
