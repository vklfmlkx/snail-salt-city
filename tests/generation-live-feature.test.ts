import { linkTestAccount } from "./helpers/zhihu-account";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  GenerationJobs,
  selectSources,
  GenerationInput,
  catalogTags,
} from "../src/server/generation/jobs";
import {
  StoryCache,
  type StoryItem,
  type StorySource,
} from "../src/server/zhihu-stories";
import { Store } from "../src/server/database";
import { readConfig } from "../src/server/config";
import { GameService } from "../src/server/service";
import { curatedBooks } from "../src/content/curated";
import {
  draftFields,
  generateBook,
  type BookModel,
} from "../src/server/generation/colloquial";
import { patchBook } from "../src/server/generation/book-patch";
const items: StoryItem[] = [
  {
    work_id: "1",
    title: "甲",
    description: "故事甲",
    labels: ["悬疑", "脑洞"],
  },
  { work_id: "2", title: "乙", description: "故事乙", labels: ["科幻"] },
  { work_id: "3", title: "丙", description: "故事丙", labels: ["奇幻"] },
  { work_id: "4", title: "丁", description: "故事丁", labels: ["日常"] },
];
const source = (i: StoryItem): StorySource => ({
  workId: i.work_id,
  title: i.title,
  author: "测试作者",
  labels: i.labels,
  introduction: "离线素材",
  content: "测试素材。".repeat(30),
  sourceUrl: `https://example.com/${i.work_id}`,
  fetchedAt: "2026-09-14",
  sha256: "test",
});
class Cache extends StoryCache {
  override async catalog() {
    return items;
  }
  override async detail(i: StoryItem) {
    return source(i);
  }
}
function fixture() {
  const b = structuredClone(curatedBooks[0]);
  return draftFields(b);
}
const live = readConfig({
  LLM_MODE: "live",
  AI_LIVE_ENABLED: "true",
  DEEPSEEK_API_KEY: "test-placeholder",
  LLM_GLOBAL_DAILY_CALL_LIMIT: "100",
  FEATURE_PLAYER_SCENARIO_GENERATION: "true",
});
test("审校补丁不能覆盖来源、版本或原型，也不能暗中增添路径", () => {
  const d = fixture();
  for (const path of [
    "/source",
    "/version",
    "/stages/0/__proto__",
    "/stages/99/opening",
  ])
    assert.throws(() => patchBook(d, { edits: [{ path, value: "伪造" }] }));
  const revised = patchBook(d, {
    edits: [{ path: "/stages/0/opening/0/text", value: "门口有人敲了三下。" }],
  }) as typeof d;
  assert.equal(revised.stages[0].opening[0].text, "门口有人敲了三下。");
  assert.notEqual(
    d.stages[0].opening[0].text,
    revised.stages[0].opening[0].text,
  );
});
test("标签只能2—5种且来自完整目录；参考最多K篇并覆盖全部所选标签", () => {
  for (let k = 2; k <= 5; k++) {
    const tags = catalogTags(items).slice(0, k),
      selected = selectSources(items, tags);
    assert.ok(selected.length <= k);
    assert.ok(tags.every((t) => selected.some((s) => s.labels.includes(t))));
  }
  assert.throws(() =>
    GenerationInput.parse({ id: randomUUID(), tags: ["悬疑"] }),
  );
  assert.throws(() => selectSources(items, ["悬疑", "伪造标签"]));
  assert.throws(() => selectSources(items, ["悬疑", "悬疑"]));
});
test("整本生成与审查只有有限修订，不发布无效JSON或逻辑不通过的稿件", async () => {
  let calls = 0;
  await assert.rejects(() =>
    generateBook(["悬疑", "脑洞"], [source(items[0])], async () => {
      calls++;
      return { bad: true };
    }),
  );
  assert.equal(calls, 4);
  calls = 0;
  const model: BookModel = async (phase) => {
    calls++;
    return phase.startsWith("review")
      ? { approved: false, issues: ["人物知道未获取的线索"] }
      : phase.startsWith("patch")
        ? { edits: [{ path: "/title", value: "测试故事" }] }
        : fixture();
  };
  await assert.rejects(() =>
    generateBook(["悬疑", "脑洞"], [source(items[0])], model),
  );
  assert.equal(calls, 12);
});
test("玩家生成幂等、并发受限、私人书架、可创建存档和重载，测试不联网", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, live),
    a = linkTestAccount(db, svc.visitor().auth.owner),
    b = linkTestAccount(db, svc.visitor().auth.owner);
  let calls = 0;
  const jobs = new GenerationJobs(db, live, new Cache(), async (phase) => {
    calls++;
    return phase.startsWith("review")
      ? { approved: true, issues: [] }
      : fixture();
  });
  const input = { id: randomUUID(), tags: ["悬疑", "脑洞"] };
  const first = await jobs.start(a, input);
  assert.equal(first.started, true);
  assert.equal((await jobs.start(a, input)).started, false);
  assert.equal(calls, 0);
  await assert.rejects(() => jobs.start(b, input));
  await assert.rejects(
    () => jobs.start(a, { ...input, id: randomUUID() }),
    /正在编写/,
  );
  await jobs.run(input.id);
  assert.equal(calls, 2);
  assert.equal(jobs.list(a)[0].status, "ready");
  assert.equal(jobs.books(b).length, 0);
  assert.equal(jobs.list(b).length, 0);
  await jobs.run(input.id);
  assert.equal(calls, 2);
  const book = jobs.books(a)[0];
  assert.equal(book.references?.length, 1);
  const c = {
    name: "测试",
    background: "本地",
    stats: { body: 5, agility: 5, mind: 5, presence: 5 },
    scenarioVersion: book.version,
  };
  assert.throws(() => svc.create(b, c));
  const state = svc.create(a, c).state;
  assert.equal(
    new GameService(db, live).read(a, state.id).state.scenarioVersion,
    book.version,
  );
  db.close();
});
test("离线禁用不会调用模型；供应商超时保留失败状态而不发布", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, live),
    owner = linkTestAccount(db, svc.visitor().auth.owner);
  let calls = 0;
  const mock = new GenerationJobs(db, readConfig({}), new Cache(), async () => {
    calls++;
    return fixture();
  });
  await assert.rejects(() =>
    mock.start(owner, { id: randomUUID(), tags: ["悬疑", "脑洞"] }),
  );
  assert.equal(calls, 0);
  const jobs = new GenerationJobs(db, live, new Cache(), async () => {
    calls++;
    throw new DOMException("timeout", "TimeoutError");
  });
  const input = { id: randomUUID(), tags: ["悬疑", "脑洞"] };
  await jobs.start(owner, input);
  await jobs.run(input.id);
  assert.equal(calls, 1);
  assert.equal(jobs.list(owner)[0].status, "failed");
  assert.equal(jobs.books(owner).length, 0);
  db.close();
});

test("供应商余额问题在后台留因，玩家只看到生成不可用，不泄漏诊断", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, live),
    owner = linkTestAccount(db, svc.visitor().auth.owner);
  let calls = 0;
  const jobs = new GenerationJobs(db, live, new Cache(), async () => {
    calls++;
    throw Error("provider_http_402");
  });
  const id = randomUUID();
  await jobs.start(owner, { id, tags: ["悬疑", "脑洞"] });
  await jobs.run(id);
  assert.equal(calls, 1);
  assert.match(jobs.list(owner)[0].error!, /故事生成暂时不可用/);
  assert.doesNotMatch(jobs.list(owner)[0].error!, /余额|充值|provider|402/);
  assert.equal(
    db.db.prepare("SELECT error_code FROM generation_jobs WHERE id=?").get(id)
      ?.error_code,
    "balance",
  );
  assert.equal(jobs.books(owner).length, 0);
  assert.equal("diagnostic" in jobs.list(owner)[0], false);
  assert.equal("draft_json" in jobs.list(owner)[0], false);
  db.close();
});
