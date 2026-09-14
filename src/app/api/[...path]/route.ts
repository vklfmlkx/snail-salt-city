import { Bookshelf } from "@/server/bookshelf";
import { ZhihuLogin, oauthReady } from "@/server/zhihu-login";
import { NextRequest, NextResponse, after } from "next/server";
import { GenerationJobs } from "@/server/generation/jobs";
import { compileBook } from "@/engine/script-rules";
import { ZodError } from "zod";
import { service } from "@/server/runtime";
import { checkWrite } from "@/server/service";
import { GameError } from "@/domain/types";
import { currentScenario, scenarios } from "@/content/registry";
import { endingLabel } from "@/engine/script-rules";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Origin" },
  });
async function body(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 8192)
    throw new GameError(400, "input_size", "输入过长。");
  const reader = req.body?.getReader();
  if (!reader) throw new GameError(400, "input", "缺少输入。");
  let n = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    n += r.value.length;
    if (n > 8192) {
      await reader.cancel();
      throw new GameError(400, "input_size", "输入过长。");
    }
    chunks.push(r.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new GameError(400, "input", "输入格式不正确。");
  }
}
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const p = (await context.params).path;
    const s = service();
    const token = req.cookies.get(s.cookieName)?.value;
    const a = s.auth(token);
    const generation = new GenerationJobs(s.store, s.cfg);
    const post = req.method === "POST";
    if (post && p.join("/") === "visitor") {
      checkWrite(req, s.cfg);
      const v = s.visitor(token);
      const response = json(s.me(v.auth));
      if (v.token)
        response.cookies.set(s.cookieName, v.token, {
          httpOnly: true,
          secure: s.cfg.APP_ORIGIN.startsWith("https:"),
          sameSite: "lax",
          path: "/",
          expires: new Date(v.auth.expiresAt),
        });
      return response;
    }
    if (!post && p.join("/") === "scenarios")
      return json({ scenarios: new Bookshelf(s.store).list(a?.owner) });
    if (!post && p.join("/") === "auth/zhihu/callback") {
      let result: { token: string; expiresAt: number } | undefined;
      let message = "failed";
      try {
        if (
          !a ||
          ["state", "authorization_code"].some(
            (k) => req.nextUrl.searchParams.getAll(k).length !== 1,
          )
        )
          throw Error("oauth_state");
        result = await new ZhihuLogin(s.store, s.cfg).callback(
          a.owner,
          a.csrf,
          req.nextUrl.searchParams.get("state")!,
          req.nextUrl.searchParams.get("authorization_code")!,
        );
        if (token) s.logout(token);
        message = "success";
      } catch (e) {
        if (e instanceof Error && e.message === "oauth_guest_conflict")
          message = "guest_conflict";
      }
      const response = NextResponse.redirect(
        new URL("/?login=" + message, s.cfg.APP_ORIGIN),
        303,
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      if (result)
        response.cookies.set(s.cookieName, result.token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          expires: new Date(result.expiresAt),
        });
      return response;
    }
    if (!a) throw new GameError(401, "visitor_required", "请先建立访客存档。");
    if (post) checkWrite(req, s.cfg, a.csrf);
    if (!post && p.join("/") === "generation")
      return json({
        oauthReady: oauthReady(s.cfg),
        ...(await generation.catalog()),
        jobs: generation.list(a.owner),
        ...generation.limits(a.owner),
      });
    if (post && p.join("/") === "generation") {
      const result = await generation.start(a.owner, await body(req));
      if (result.started) after(() => generation.run(result.job.id));
      return json({ job: result.job }, 202);
    }
    if (post && p.join("/") === "auth/zhihu/start")
      return json({
        url: new ZhihuLogin(s.store, s.cfg).start(a.owner, a.csrf),
      });
    if (post && p.join("/") === "auth/logout") {
      if (token) s.logout(token);
      const response = json({ ok: true });
      response.cookies.set(s.cookieName, "", {
        path: "/",
        httpOnly: true,
        secure: s.cfg.APP_ORIGIN.startsWith("https:"),
        sameSite: "lax",
        maxAge: 0,
      });
      return response;
    }
    if (p[0] === "books" && p.length === 3) {
      const shelf = new Bookshelf(s.store),
        v = p[1];
      if (!post && p[2] === "manuscript")
        return json({ book: shelf.manuscript(a.owner, v) });
      if (post && p[2] === "delete") return json(shelf.remove(a.owner, v));
      if (post && p[2] === "publish") return json(shelf.publish(a.owner, v));
      if (post && p[2] === "unpublish")
        return json(shelf.unpublish(a.owner, v));
    }
    if (!post && p.join("/") === "me") return json(s.me(a));
    if (!post && p.join("/") === "collection")
      return json({ collection: s.collection(a.owner) });
    if (p[0] === "sessions") {
      if (p.length === 1 && post) {
        const input = await body(req);
        if (
          input?.scenarioVersion &&
          !scenarios.some((s) => s.version === input.scenarioVersion) &&
          !s.ownsBook(a.owner, input.scenarioVersion)
        )
          throw new GameError(
            410,
            "scenario_retired",
            "旧剧本已归档，请开始固定主线新版。",
          );
        return json(
          s.create(a.owner, {
            ...input,
            scenarioVersion: input.scenarioVersion ?? scenarios[0].version,
          }),
          201,
        );
      }
      const id = p[1];
      if (!id || !/^[0-9a-f-]{36}$/.test(id))
        throw new GameError(404, "not_found", "没有找到这个存档。");
      if (p.length === 2 && !post) return json(s.read(a.owner, id));
      if (
        post &&
        p[2] !== "abandon" &&
        ![currentScenario, ...scenarios].some(
          (x) => x.version === s.read(a.owner, id).state.scenarioVersion,
        ) &&
        !s.read(a.owner, id).state.scenarioVersion?.startsWith("curated-") &&
        !s.read(a.owner, id).state.scenarioVersion?.startsWith("generated-") &&
        !s.ownsBook(a.owner, s.read(a.owner, id).state.scenarioVersion ?? "")
      )
        throw new GameError(
          410,
          "scenario_retired",
          "原版蜗牛剧本已移除。旧记录保留，请开始《错位百年》。",
        );
      if (p.length === 3 && post) {
        const b = await body(req);
        if (p[2] === "proposals") {
          if (b.text !== undefined)
            throw new GameError(
              400,
              "custom_actions_closed",
              "本版请从当前剧情提供的行动中选择，保证判定与后续情节一致。",
            );
          return json(await s.propose(a.owner, id, b));
        }
        if (p[2] === "turns") return json(s.commit(a.owner, id, b));
        if (p[2] === "abandon") return json(s.abandon(a.owner, id, b));
        if (p[2] === "activity") return json(s.activity(a.owner, id, b));
      }
      if (p.length === 3 && p[2] === "turns" && !post) {
        const after = Number(req.nextUrl.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0)
          throw new GameError(400, "input", "分页位置不合法。");
        return json({
          turns: s.history(a.owner, id, after),
          activities: s.activityHistory(a.owner, id),
        });
      }
      if (p.length === 5 && p[2] === "turns" && p[4] === "narration" && post)
        return json(await s.narrate(a.owner, id, p[3]));
    }
    throw new GameError(404, "not_found", "未找到此功能。");
  } catch (e) {
    if (e instanceof GameError)
      return json({ error: { code: e.code, message: e.message } }, e.status);
    if (e instanceof ZodError)
      return json(
        {
          error: {
            code: "invalid_input",
            message:
              "填写的内容不符合要求，请检查属性合计、文字长度或标签数量。",
          },
        },
        400,
      );
    console.error(JSON.stringify({ event: "api_error", code: "internal" }));
    return json(
      {
        error: {
          code: "internal",
          message: "暂时无法完成操作，请稍后重试。已保存的行动不会重新掷骰。",
        },
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
