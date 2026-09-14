import { linkTestAccount } from "./helpers/zhihu-account";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import { readConfig } from "../src/server/config";
import { Bookshelf } from "../src/server/bookshelf";
import { GenerationJobs } from "../src/server/generation/jobs";
import { curatedBooks } from "../src/content/curated";
import { draftFields } from "../src/server/generation/colloquial";
import { StoryCache, type StoryItem } from "../src/server/zhihu-stories";
import { registerBook } from "../src/content/registry";
const config = readConfig({
  LLM_MODE: "live",
  AI_LIVE_ENABLED: "true",
  DEEPSEEK_API_KEY: "fixture",
  LLM_GLOBAL_DAILY_CALL_LIMIT: "100",
  FEATURE_PLAYER_SCENARIO_GENERATION: "true",
});
const items = [
  { work_id: "1", title: "测试", description: "", labels: ["悬疑", "脑洞"] },
];
class Cache extends StoryCache {
  override async catalog() {
    return items;
  }
  override async detail(i: StoryItem) {
    return {
      workId: i.work_id,
      title: i.title,
      author: "作者",
      labels: i.labels,
      introduction: "",
      content: "离线素材".repeat(30),
      sourceUrl: "https://www.zhihu.com/question/1",
      fetchedAt: "2026-09-14",
      sha256: "test",
    };
  }
}
const fixture = () => {
  return draftFields(structuredClone(curatedBooks[0]));
};
function add(db: Store, owner: string, slot: number) {
  const b = structuredClone(curatedBooks[0]);
  b.version = `generated-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  db.db
    .prepare("INSERT INTO generated_books VALUES(?,?,?,?)")
    .run(b.version, owner, JSON.stringify(b), Date.now());
  db.db
    .prepare("INSERT INTO book_slots VALUES(?,?,?)")
    .run(owner, slot, b.version);
  registerBook(b);
  return b;
}
function unlock(db: Store, owner: string, version: string, id: string) {
  db.db
    .prepare("INSERT INTO ending_collection VALUES(?,?,?,?,?,?,?)")
    .run(owner, version, id, "测试结局", "好结局", "[]", Date.now());
}
test("私人三栏、社区一栏、快照隔离、下架与完整剧本权限", () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, readConfig({})),
    a = linkTestAccount(db, svc.visitor().auth.owner),
    b = linkTestAccount(db, svc.visitor().auth.owner),
    shelf = new Bookshelf(db),
    book = add(db, a, 1);
  assert.equal(
    shelf.list(b).some((s) => s.version === book.version),
    false,
  );
  assert.throws(() => shelf.manuscript(b, book.version));
  assert.throws(() => shelf.manuscript(a, book.version), /一个结局/);
  unlock(db, a, book.version, book.endings[0].id);
  assert.equal(shelf.manuscript(a, book.version).title, book.title);
  const published = shelf.publish(a, book.version);
  assert.equal(
    shelf.list(b).find((s) => s.version === published.version)?.category,
    "community",
  );
  assert.throws(() => shelf.publish(a, book.version), /已分享/);
  assert.throws(() => shelf.remove(b, book.version));
  assert.throws(() => shelf.unpublish(b, published.version));
  assert.throws(() => shelf.manuscript(b, published.version), /一个结局/);
  unlock(db, b, published.version, book.endings[0].id);
  assert.ok(shelf.manuscript(b, published.version));
  const play = svc.create(b, {
    name: "你",
    background: "",
    stats: { body: 5, agility: 5, mind: 5, presence: 5 },
    scenarioVersion: published.version,
  });
  shelf.remove(a, book.version);
  assert.equal(shelf.personal(a).length, 0);
  assert.ok(shelf.find(b, published.version));
  shelf.unpublish(a, published.version);
  assert.throws(() => shelf.find(b, published.version));
  assert.equal(
    svc.read(b, play.state.id).state.scenarioVersion,
    published.version,
  );
  assert.throws(() => shelf.manuscript(a, curatedBooks[0].version), /所有结局/);
  for (const e of curatedBooks[0].endings)
    unlock(db, a, curatedBooks[0].version, e.id);
  assert.ok(shelf.manuscript(a, curatedBooks[0].version));
  db.close();
});
test("重新生成占一次机会，失败保留原稿，成功原子替换而社区副本不变", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, config),
    owner = linkTestAccount(db, svc.visitor().auth.owner),
    shelf = new Bookshelf(db),
    book = add(db, owner, 1);
  add(db, owner, 2);
  add(db, owner, 3);
  const shared = shelf.publish(owner, book.version);
  let fail = true,
    observed = "";
  const jobs = new GenerationJobs(
    db,
    config,
    new Cache(),
    async (phase, messages) => {
      if (fail) throw Error("provider_http_402");
      if (phase.startsWith("write")) observed = messages[0].content;
      return phase.startsWith("review")
        ? { approved: true, issues: [] }
        : fixture();
    },
  );
  await assert.rejects(
    () => jobs.start(owner, { id: randomUUID(), tags: items[0].labels }),
    /栏位已满/,
  );
  const id = randomUUID();
  await jobs.start(owner, {
    id,
    tags: items[0].labels,
    description: "希望主角有一只猫",
    replaceVersion: book.version,
  });
  assert.throws(() => shelf.remove(owner, book.version), /正在重新生成/);
  await jobs.run(id);
  assert.equal(shelf.personal(owner)[0].book.version, book.version);
  assert.equal(jobs.limits(owner).dailyRemaining, 5);
  fail = false;
  const next = randomUUID();
  await jobs.start(owner, {
    id: next,
    tags: items[0].labels,
    description: "希望主角有一只猫",
    replaceVersion: book.version,
  });
  await jobs.run(next);
  assert.equal(jobs.list(owner).find((j) => j.id === next)?.status, "ready");
  assert.equal(shelf.personal(owner).length, 3);
  assert.notEqual(shelf.personal(owner)[0].book.version, book.version);
  assert.ok(observed.includes("希望主角有一只猫"));
  assert.equal(shelf.find(owner, shared.version).book.title, book.title);
  assert.equal(jobs.limits(owner).dailyRemaining, 4);
  db.close();
});
test("每日6次、失败计次、跨日重置、500字校验及并发重复请求不多扣", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, config),
    owner = linkTestAccount(db, svc.visitor().auth.owner);
  const jobs = new GenerationJobs(db, config, new Cache(), async () => {
    throw Error("provider_http_402");
  });
  await assert.rejects(() =>
    jobs.start(owner, {
      id: randomUUID(),
      tags: items[0].labels,
      description: "字".repeat(501),
    }),
  );
  assert.equal(jobs.limits(owner).dailyRemaining, 6);
  for (let i = 0; i < 6; i++) {
    const id = randomUUID();
    await jobs.start(owner, { id, tags: items[0].labels });
    assert.equal(
      (await jobs.start(owner, { id, tags: items[0].labels })).started,
      false,
    );
    await jobs.run(id);
  }
  assert.equal(jobs.limits(owner).dailyRemaining, 0);
  await assert.rejects(
    () => jobs.start(owner, { id: randomUUID(), tags: items[0].labels }),
    /6次/,
  );
  db.db
    .prepare("UPDATE generation_jobs SET created_at=created_at-86400000")
    .run();
  assert.equal(jobs.limits(owner).dailyRemaining, 6);
  db.close();
});

test("同时到达的同编号生成只占一个机会，修改描述不能复用编号", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, config),
    owner = linkTestAccount(db, svc.visitor().auth.owner),
    jobs = new GenerationJobs(db, config, new Cache(), async () => fixture());
  const value = {
    id: randomUUID(),
    tags: items[0].labels,
    description: "一个轻松的故事",
  };
  const results = await Promise.all([
    jobs.start(owner, value),
    jobs.start(owner, value),
  ]);
  assert.equal(results.filter((r) => r.started).length, 1);
  assert.equal(jobs.limits(owner).dailyRemaining, 5);
  await assert.rejects(() =>
    jobs.start(owner, { ...value, description: "不同故事" }),
  );
  db.close();
});
