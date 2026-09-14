import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/database";
import { GameService } from "../src/server/service";
import { readConfig } from "../src/server/config";
import { GenerationJobs } from "../src/server/generation/jobs";
import { StoryCache } from "../src/server/zhihu-stories";
import { linkTestAccount } from "./helpers/zhihu-account";

test("访客不能创建或重新生成，不能伪造身份；拒绝发生在读素材和模型调用前", async () => {
  const db = new Store(":memory:");
  const cfg = readConfig({});
  const svc = new GameService(db, cfg);
  const owner = svc.visitor().auth.owner;
  let calls = 0;
  class Cache extends StoryCache {
    override async catalog() {
      calls++;
      return [];
    }
  }
  const jobs = new GenerationJobs(db, cfg, new Cache(), async () => {
    calls++;
    return {};
  });
  assert.equal(jobs.limits(owner).requiresLogin, true);
  assert.equal(jobs.limits(owner).dailyRemaining, 0);
  for (const replaceVersion of [undefined, "someone-elses-book"]) {
    await assert.rejects(
      () =>
        jobs.start(owner, {
          id: randomUUID(),
          tags: ["悬疑", "脑洞"],
          replaceVersion,
          account: true,
        }),
      (e: any) => e.status === 403 && e.code === "generation_login_required",
    );
  }
  db.db.prepare("UPDATE principals SET type='zhihu' WHERE id=?").run(owner);
  assert.equal(jobs.canGenerate(owner), false);
  linkTestAccount(db, owner);
  assert.equal(jobs.limits(owner).requiresLogin, false);
  assert.equal(jobs.limits(owner).dailyRemaining, 6);
  assert.equal(jobs.limits(owner).dailyLimit, 6);
  assert.equal(calls, 0);
  assert.equal(
    db.db.prepare("SELECT COUNT(*) n FROM generation_jobs").get()?.n,
    0,
  );
  db.close();
});
