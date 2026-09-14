import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/database";
import { readConfig } from "../src/server/config";
import { GameService } from "../src/server/service";
import {
  ZhihuLogin,
  oauthReady,
  parseProfile,
} from "../src/server/zhihu-login";
const cfg = readConfig({
  APP_ORIGIN: "https://game.example",
  FEATURE_ZHIHU_OAUTH: "true",
  ZHIHU_OAUTH_APP_ID: "app-fixture",
  ZHIHU_OAUTH_APP_KEY: "key-fixture",
  ZHIHU_OAUTH_REDIRECT_URI: "https://game.example/api/auth/zhihu/callback",
});
test("知乎基础身份uid无损解析，错误响应不能建账号", () => {
  assert.equal(
    parseProfile('{"uid":969570047710216200,"fullname":"测试"}').uid,
    "uid:969570047710216200",
  );
  assert.equal(
    parseProfile('{"code":20000,"data":{"uid":969570047710216200}}').uid,
    "uid:969570047710216200",
  );
  for (const raw of [
    "{}",
    '{"code":404,"data":"User does not exist"}',
    '{"uid":1e30}',
    '{"uid":-2}',
  ])
    assert.throws(() => parseProfile(raw));
  assert.equal(oauthReady(readConfig({})), false);
  assert.equal(oauthReady(cfg), true);
});
test("OAuth state绑定浏览器，单次消费、过期拒绝、最小读取、身份稳定与退出", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, cfg),
    a = svc.visitor(),
    b = svc.visitor();
  let calls = 0;
  const login = new ZhihuLogin(db, cfg, (async (url, options) => {
    calls++;
    if (String(url).endsWith("access_token")) {
      const body = options?.body as URLSearchParams;
      assert.equal(body.get("code"), "code-fixture");
      assert.equal(body.get("redirect_uri"), cfg.ZHIHU_OAUTH_REDIRECT_URI);
      return Response.json({
        code: 20000,
        data: { access_token: "token-fixture", expires_in: 3600 },
      });
    }
    assert.equal(String(url), "https://openapi.zhihu.com/user");
    assert.equal(
      (options?.headers as any).Authorization,
      "Bearer token-fixture",
    );
    return new Response(
      '{"uid":969570047710216200,"fullname":"测试玩家","email":"discard@example.com"}',
    );
  }) as typeof fetch);
  const begin = () =>
    new URL(login.start(a.auth.owner, a.auth.csrf)).searchParams.get("state")!;
  let state = begin();
  await assert.rejects(() =>
    login.callback(b.auth.owner, b.auth.csrf, state, "code-fixture"),
  );
  await assert.rejects(() =>
    login.callback(a.auth.owner, a.auth.csrf, "wrong", "code-fixture"),
  );
  assert.equal(calls, 0);
  db.db.prepare("UPDATE oauth_states SET expires_at=0").run();
  await assert.rejects(() =>
    login.callback(a.auth.owner, a.auth.csrf, state, "code-fixture"),
  );
  assert.equal(calls, 0);
  state = begin();
  const result = await login.callback(
    a.auth.owner,
    a.auth.csrf,
    state,
    "code-fixture",
  );
  assert.equal(calls, 2);
  assert.equal(svc.auth(result.token)?.owner, a.auth.owner);
  assert.equal(
    (svc.me(svc.auth(result.token)!).account as any).name,
    "测试玩家",
  );
  await assert.rejects(() =>
    login.callback(a.auth.owner, a.auth.csrf, state, "code-fixture"),
  );
  assert.equal(calls, 2);
  svc.logout(result.token);
  assert.equal(svc.auth(result.token), null);
  assert.equal(
    db.db.prepare("SELECT COUNT(*) n FROM zhihu_accounts").get()?.n,
    1,
  );
  assert.ok(
    !JSON.stringify(
      db.db.prepare("SELECT * FROM zhihu_accounts").all(),
    ).includes("discard"),
  );
  const url = new URL(login.start(b.auth.owner, b.auth.csrf));
  const same = await login.callback(
    b.auth.owner,
    b.auth.csrf,
    url.searchParams.get("state")!,
    "code-fixture",
  );
  assert.equal(svc.auth(same.token)?.owner, a.auth.owner);
  db.close();
});
test("Token失败不创建账号、不重试、不泄漏供应商错误", async () => {
  const db = new Store(":memory:"),
    svc = new GameService(db, cfg),
    a = svc.visitor();
  let calls = 0;
  const login = new ZhihuLogin(db, cfg, (async () => {
    calls++;
    return new Response("private provider payload", { status: 401 });
  }) as typeof fetch);
  const state = new URL(
    login.start(a.auth.owner, a.auth.csrf),
  ).searchParams.get("state")!;
  await assert.rejects(
    () => login.callback(a.auth.owner, a.auth.csrf, state, "code-fixture"),
    /oauth_token/,
  );
  assert.equal(calls, 1);
  assert.equal(
    db.db.prepare("SELECT COUNT(*) n FROM zhihu_accounts").get()?.n,
    0,
  );
  db.close();
});
