import { readConfig } from "../src/server/config";
import { Store } from "../src/server/database";
import { ModelGateway, AIError } from "../src/server/ai";
import { scenario } from "../src/content/legacy/snail-scenario";
import { initialState, project } from "../src/engine/rules";
import { character } from "../tests/paths";
async function main() {
  const p = project(initialState(character, scenario), scenario);
  const ctx = {
    scene: p.stage.title,
    facts: p.facts,
    actions: p.actions,
    text: "核对奖金通知",
    roles: [],
  };
  if (!process.argv.includes("--live")) {
    const db = new Store(":memory:");
    const c = readConfig({}),
      g = new ModelGateway(db, c);
    await g.run("interpreter", "synthetic-smoke", ctx);
    await g.run("narrator", "synthetic-smoke", ctx);
    db.close();
    console.log(
      JSON.stringify({
        mode: "dry-run",
        businessProvider: "MockProvider",
        roles: ["interpreter", "narrator"],
        localSchema: "PASS",
        networkRequests: 0,
        realDeepSeek: "SKIPPED",
        reason: "没有执行live；没有读取.env.local",
      }),
    );
    return;
  }
  const role = process.argv.find((a) => a.startsWith("--role="))?.slice(7);
  if (
    !["interpreter", "narrator"].includes(role ?? "") ||
    !process.argv.includes("--confirm-one-paid-request")
  ) {
    console.error(
      "需要指定单个 --role=interpreter 或 narrator，并明确授权 --confirm-one-paid-request。每次运行最多一次可能收费请求，不会自动运行第二角色。",
    );
    process.exitCode = 1;
    return;
  }
  const c = readConfig();
  if (
    c.LLM_MODE !== "live" ||
    c.AI_LIVE_ENABLED !== "true" ||
    !c.DEEPSEEK_API_KEY ||
    c.LLM_GLOBAL_DAILY_CALL_LIMIT <= 0
  )
    throw new AIError("configuration");
  const db = new Store(c.SQLITE_FILE);
  try {
    const { resolveTurn } = await import("../src/engine/rules");
    const r = resolveTurn(
      initialState(character, scenario),
      scenario,
      "s1.1.notice",
      7,
    );
    const liveCtx =
      role === "narrator"
        ? {
            ...ctx,
            actions: [],
            facts: project(r.state, scenario).facts,
            result: r.result,
          }
        : ctx;
    await new ModelGateway(db, c).run(
      role as "interpreter" | "narrator",
      "synthetic-model-smoke",
      liveCtx,
    );
    console.log(
      JSON.stringify({
        mode: "live",
        role,
        localSchema: "PASS",
        maximumRequests: 1,
        configuredModel:
          role === "interpreter"
            ? c.LLM_MODEL_INTERPRETER
            : c.LLM_MODEL_NARRATOR,
        date: new Date().toISOString(),
      }),
    );
  } finally {
    db.close();
  }
}
main().catch(() => {
  console.error("model:smoke FAILED (redacted)");
  process.exitCode = 1;
});
