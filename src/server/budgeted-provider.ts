import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AIError,
  DeepSeekProvider,
  requestBody,
  modelContext,
  type Context,
  type Provider,
  type ModelRole,
  type ContinuityReview,
} from "./ai";
import { liveReady, type Config } from "./config";
import { ResearchBudget } from "./research-budget";

/** Shares the user's original ¥10 authorization with the editorial tools.
 * Every concurrent request owns its reservation; uncertain attempts stay charged.
 */
export class BudgetedProvider implements Provider {
  constructor(
    private cfg: Config,
    private budget: ResearchBudget,
    private fetcher: typeof fetch = fetch,
    private log: (v: Record<string, unknown>) => void = (v) =>
      console.info(JSON.stringify(v)),
  ) {}
  private async call(role: ModelRole, c: Context, signal?: AbortSignal) {
    if (!liveReady(this.cfg)) throw new AIError("configuration");
    if (
      this.cfg.LLM_MODEL_INTERPRETER !== "deepseek-flash" ||
      this.cfg.LLM_MODEL_NARRATOR !== "deepseek-flash"
    )
      throw new AIError("configuration");
    if (JSON.stringify(modelContext(c)).length > 48000)
      throw new AIError("schema_invalid");
    const body = requestBody(role, c, this.cfg);
    let reservation: string;
    try {
      reservation = this.budget.reserve(
        `game-${role}-v3`,
        JSON.stringify(body),
        body.max_tokens,
      );
    } catch {
      throw new AIError("quota");
    }
    const provider = new DeepSeekProvider(this.cfg, this.fetcher, (record) => {
      if (record.usage && typeof record.usage === "object")
        this.budget.settle(reservation, record.usage);
      this.log(record);
    });
    if (role === "continuity") return provider.review(c, signal);
    return role === "interpreter"
      ? provider.interpret(c, signal)
      : provider.narrate(c, signal);
  }
  async interpret(c: Context, signal?: AbortSignal) {
    return (await this.call("interpreter", c, signal)) as Awaited<
      ReturnType<Provider["interpret"]>
    >;
  }
  async narrate(c: Context, signal?: AbortSignal) {
    return (await this.call("narrator", c, signal)) as Awaited<
      ReturnType<Provider["narrate"]>
    >;
  }
  async review(c: Context, signal?: AbortSignal) {
    return (await this.call("continuity", c, signal)) as ContinuityReview;
  }
}
export function runtimeProvider(cfg: Config) {
  if (cfg.LLM_MODE !== "live") return undefined;
  const path = resolve("data/research/budget.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  return new BudgetedProvider(
    cfg,
    new ResearchBudget(
      path,
      cfg.LLM_BUDGET_YUAN === "unlimited"
        ? Infinity
        : cfg.LLM_BUDGET_YUAN * 1e6,
    ),
  );
}
