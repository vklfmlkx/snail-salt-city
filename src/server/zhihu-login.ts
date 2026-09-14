import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Config } from "./config";
import type { Store } from "./database";
import { GameError } from "../domain/types";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function oauthReady(c: Config) {
  try {
    const u = new URL(c.ZHIHU_OAUTH_REDIRECT_URI);
    return (
      c.FEATURE_ZHIHU_OAUTH === "true" &&
      !!c.ZHIHU_OAUTH_APP_ID &&
      !!c.ZHIHU_OAUTH_APP_KEY &&
      u.protocol === "https:" &&
      u.origin === c.APP_ORIGIN &&
      u.pathname === "/api/auth/zhihu/callback" &&
      !u.hash
    );
  } catch {
    return false;
  }
}
export function parseProfile(text: string): { uid: string; name: string } {
  const parsed = JSON.parse(text, ((
    key: string,
    value: unknown,
    context: { source?: string },
  ) =>
    key === "uid" && typeof value === "number"
      ? context.source
      : value) as any);
  const p =
    parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  if (parsed.code !== undefined && ![0, 20000].includes(parsed.code))
    throw Error("oauth_profile");
  const uid =
    typeof p.hash_id === "string" && /^[a-zA-Z0-9_-]{4,128}$/.test(p.hash_id)
      ? `hash:${p.hash_id}`
      : typeof p.uid === "string" && /^\d{1,30}$/.test(p.uid)
        ? `uid:${p.uid}`
        : null;
  if (!uid) throw Error("oauth_profile");
  return {
    uid,
    name:
      typeof p.fullname === "string"
        ? Array.from(p.fullname).slice(0, 40).join("")
        : "知乎玩家",
  };
}
export class ZhihuLogin {
  constructor(
    private db: Store,
    private cfg: Config,
    private fetcher: typeof fetch = fetch,
  ) {}
  start(owner: string, csrf: string) {
    if (!oauthReady(this.cfg))
      throw new GameError(
        503,
        "oauth_unconfigured",
        "知乎登录暂未开放，你可以先以访客身份游玩。",
      );
    const state = randomBytes(32).toString("hex");
    this.db.transaction(() => {
      this.db.db
        .prepare("DELETE FROM oauth_states WHERE browser_hash=?")
        .run(hash(csrf));
      this.db.db
        .prepare("INSERT INTO oauth_states VALUES(?,?,?,?)")
        .run(hash(state), hash(csrf), owner, Date.now() + 600000);
    });
    const u = new URL("https://openapi.zhihu.com/authorize");
    u.search = new URLSearchParams({
      app_id: this.cfg.ZHIHU_OAUTH_APP_ID,
      redirect_uri: this.cfg.ZHIHU_OAUTH_REDIRECT_URI,
      response_type: "code",
      state,
    }).toString();
    return u.toString();
  }
  async callback(owner: string, csrf: string, state: string, code: string) {
    if (
      !oauthReady(this.cfg) ||
      !state ||
      state.length > 128 ||
      !code ||
      code.length > 2048
    )
      throw Error("oauth_state");
    const consumed = this.db.transaction(() =>
      this.db.db
        .prepare(
          "DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND principal_id=? AND expires_at>? RETURNING state_hash",
        )
        .get(hash(state), hash(csrf), owner, Date.now()),
    );
    if (!consumed) throw Error("oauth_state");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.fetcher(
        "https://openapi.zhihu.com/access_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            app_id: this.cfg.ZHIHU_OAUTH_APP_ID,
            app_key: this.cfg.ZHIHU_OAUTH_APP_KEY,
            grant_type: "authorization_code",
            redirect_uri: this.cfg.ZHIHU_OAUTH_REDIRECT_URI,
            code,
          }),
          signal: controller.signal,
          redirect: "error",
        },
      );
      const text = await response.text();
      if (!response.ok || text.length > 32768) throw Error("oauth_token");
      const json = JSON.parse(text),
        t = json.data ?? json;
      if (json.code !== undefined && ![0, 20000].includes(json.code))
        throw Error("oauth_token");
      if (
        typeof t.access_token !== "string" ||
        !t.access_token ||
        !Number.isSafeInteger(t.expires_in) ||
        t.expires_in <= 0
      )
        throw Error("oauth_token");
      const profile = await this.fetcher("https://openapi.zhihu.com/user", {
        headers: { Authorization: `Bearer ${t.access_token}` },
        signal: controller.signal,
        redirect: "error",
      });
      const raw = await profile.text();
      if (!profile.ok || raw.length > 65536) throw Error("oauth_profile");
      const user = parseProfile(raw);
      // Login needs identity only. Discard the OAuth token after this one minimal read.
      return this.db.transaction(() => {
        const old = this.db.db
          .prepare("SELECT principal_id FROM zhihu_accounts WHERE uid=?")
          .get(user.uid) as { principal_id: string } | undefined;
        const linked = this.db.db
          .prepare("SELECT uid FROM zhihu_accounts WHERE principal_id=?")
          .get(owner) as { uid: string } | undefined;
        if (linked && linked.uid !== user.uid)
          throw Error("oauth_account_conflict");
        const target = old?.principal_id ?? owner;
        if (
          target !== owner &&
          (this.db.db
            .prepare("SELECT id FROM games WHERE principal_id=? LIMIT 1")
            .get(owner) ||
            this.db.db
              .prepare(
                "SELECT version FROM generated_books WHERE principal_id=? LIMIT 1",
              )
              .get(owner))
        )
          throw Error("oauth_guest_conflict");
        this.db.db
          .prepare("UPDATE principals SET type='zhihu',expires_at=? WHERE id=?")
          .run(Number.MAX_SAFE_INTEGER, target);
        this.db.db
          .prepare(
            "INSERT INTO zhihu_accounts VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name",
          )
          .run(user.uid, target, user.name);
        const token = randomBytes(32).toString("hex"),
          expiresAt = Date.now() + Math.min(t.expires_in, 30 * 86400) * 1000;
        this.db.db
          .prepare("INSERT INTO visitor_sessions VALUES(?,?,?,?)")
          .run(randomUUID(), target, hash(token), expiresAt);
        return { token, expiresAt };
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
