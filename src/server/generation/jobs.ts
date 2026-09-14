import { Bookshelf } from "../bookshelf";
import { z } from "zod";
import { createHash } from "node:crypto";
import bundledSources from "../../content/curated/sources.json";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { GameError } from "../../domain/types";
import { registerBook } from "../../content/registry";
import { ScriptBookSchema } from "../../content/script-book";
import type { Store } from "../database";
import { liveReady, type Config } from "../config";
import { StoryCache, type StoryItem } from "../zhihu-stories";
import { generateBook, type BookModel } from "./colloquial";
import { paidJSON, ResearchBudget } from "../research-budget";
export const GenerationInput = z
  .object({
    id: z.string().uuid(),
    description: z
      .string()
      .trim()
      .refine((v) => Array.from(v).length <= 500)
      .default(""),
    replaceVersion: z.string().max(100).optional(),
    tags: z.array(z.string().min(1).max(40)).min(2).max(5),
  })
  .strict()
  .refine((v) => new Set(v.tags).size === v.tags.length);
export const catalogTags = (items: StoryItem[]) =>
  [...new Set(items.flatMap((i) => i.labels))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
/** Cover selected tags first, then take the strongest remaining matches, never more than K. */
export function selectSources(items: StoryItem[], tags: string[]) {
  if (
    tags.length < 2 ||
    tags.length > 5 ||
    new Set(tags).size !== tags.length ||
    tags.some((t) => !catalogTags(items).includes(t))
  )
    throw new GameError(400, "tags", "请选择目录中的2—5个不同标签。");
  const remaining = items.filter((i) => i.labels.some((l) => tags.includes(l))),
    chosen: StoryItem[] = [],
    uncovered = new Set(tags);
  while (chosen.length < tags.length && remaining.length) {
    remaining.sort(
      (a, b) =>
        b.labels.filter((l) => uncovered.has(l)).length -
          a.labels.filter((l) => uncovered.has(l)).length ||
        b.labels.filter((l) => tags.includes(l)).length -
          a.labels.filter((l) => tags.includes(l)).length ||
        a.work_id.localeCompare(b.work_id),
    );
    const item = remaining.shift()!;
    chosen.push(item);
    item.labels.forEach((l) => uncovered.delete(l));
  }
  if (uncovered.size)
    throw new GameError(
      400,
      "tags_uncovered",
      "当前目录无法覆盖这些标签，请更换组合。",
    );
  return chosen;
}
type Job = {
  id: string;
  principal_id: string;
  tags_json: string;
  status: string;
  phase: string;
  book_version: string | null;
  error_code: string | null;
  created_at: number;
  deadline: number;
  description: string;
  replace_version: string | null;
  slot: number;
};
const publicJob = (j: Job) => ({
  id: j.id,
  tags: JSON.parse(j.tags_json),
  status: j.status,
  description: j.description,
  replaceVersion: j.replace_version,
  slot: j.slot,
  phase: j.phase,
  version: j.book_version,
  error: j.error_code
    ? j.error_code === "timeout" || j.error_code === "deadline"
      ? "这次写作超时了，未完成的稿件没有发布。可以稍后重新生成。"
      : j.error_code === "balance"
        ? "故事生成暂时不可用，请稍后再试。精选故事和小游戏仍可正常游玩。"
        : j.error_code === "quota"
          ? "故事生成服务暂时达到用量上限，请稍后再试。"
          : j.error_code === "quality"
            ? "这次没能写出完整连贯的故事。可以调整标签或想法后再试。"
            : "这次故事没有完成，请稍后再试。已有故事不会受到影响。"
    : null,
});
export class GenerationJobs {
  constructor(
    private store: Store,
    private cfg: Config,
    private cache = new StoryCache(),
    private injectedModel?: BookModel,
  ) {}
  canGenerate(owner: string) {
    return !!this.store.db
      .prepare(
        "SELECT p.id FROM principals p JOIN zhihu_accounts z ON z.principal_id=p.id WHERE p.id=? AND p.type='zhihu'",
      )
      .get(owner);
  }
  requireAccount(owner: string) {
    if (!this.canGenerate(owner))
      throw new GameError(
        403,
        "generation_login_required",
        "请先登录知乎账号，再生成新故事。访客可以游玩精选和社区故事。",
      );
  }
  enabled() {
    return (
      this.cfg.FEATURE_PLAYER_SCENARIO_GENERATION === "true" &&
      liveReady(this.cfg)
    );
  }
  expire() {
    this.store.db
      .prepare(
        "UPDATE generation_jobs SET status='failed',phase='生成已中断',error_code='deadline' WHERE status IN ('queued','running') AND deadline<?",
      )
      .run(Date.now());
  }
  async localCatalog() {
    try {
      return await this.cache.catalog(false);
    } catch {
      return bundledSources.map((s) => ({
        work_id: s.workId,
        title: s.title,
        description: "",
        labels: s.tags,
      }));
    }
  }
  async catalog() {
    const items = await this.localCatalog();
    return {
      tags: catalogTags(items),
      count: items.length,
      enabled: this.enabled(),
    };
  }
  list(owner: string) {
    this.expire();
    return (
      this.store.db
        .prepare(
          "SELECT * FROM generation_jobs WHERE principal_id=? ORDER BY created_at DESC LIMIT 12",
        )
        .all(owner) as Job[]
    ).map(publicJob);
  }
  limits(owner: string) {
    this.expire();
    const start =
      Math.floor((Date.now() + 8 * 3600000) / 86400000) * 86400000 -
      8 * 3600000;
    const used = (
      this.store.db
        .prepare(
          "SELECT COUNT(*) n FROM generation_jobs WHERE principal_id=? AND created_at>=?",
        )
        .get(owner, start) as { n: number }
    ).n;
    return {
      requiresLogin: !this.canGenerate(owner),
      dailyRemaining: this.canGenerate(owner) ? Math.max(0, 6 - used) : 0,
      dailyLimit: 6,
      slots: new Bookshelf(this.store).personal(owner).map((s) => ({
        slot: s.slot,
        version: s.book.version,
        title: s.book.title,
        tags: s.book.source?.tags ?? [],
      })),
    };
  }
  async start(owner: string, input: unknown) {
    this.requireAccount(owner);
    const value = GenerationInput.parse(input);
    value.tags.sort();
    this.expire();
    const prior = this.store.db
      .prepare("SELECT * FROM generation_jobs WHERE id=?")
      .get(value.id) as Job | undefined;
    if (prior) {
      if (
        prior.principal_id !== owner ||
        prior.tags_json !== JSON.stringify(value.tags) ||
        prior.description !== value.description ||
        prior.replace_version !== (value.replaceVersion ?? null)
      )
        throw new GameError(
          409,
          "generation_id_conflict",
          "这次生成的信息有变化，请刷新后再试。",
        );
      return { job: publicJob(prior), started: false };
    }
    if (!this.enabled())
      throw new GameError(
        503,
        "generation_disabled",
        "故事生成暂未开放，请先游玩书架中的故事。",
      );
    selectSources(await this.localCatalog(), value.tags);
    const inserted = this.store.transaction(() => {
      this.requireAccount(owner);
      const same = this.store.db
        .prepare("SELECT * FROM generation_jobs WHERE id=?")
        .get(value.id) as Job | undefined;
      if (same) {
        if (
          same.principal_id !== owner ||
          same.tags_json !== JSON.stringify(value.tags) ||
          same.description !== value.description ||
          same.replace_version !== (value.replaceVersion ?? null)
        )
          throw new GameError(
            409,
            "generation_id_conflict",
            "这次生成的信息有变化，请刷新后再试。",
          );
        return false;
      }
      const running = this.store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM generation_jobs WHERE status IN ('queued','running')",
        )
        .get() as { n: number };
      if (running.n >= 1)
        throw new GameError(
          429,
          "generation_busy",
          "正在编写一篇故事，完成后再试。",
        );
      const limits = this.limits(owner);
      if (limits.dailyRemaining <= 0)
        throw new GameError(
          429,
          "generation_daily",
          "今天的6次生成机会已用完，明天再来。",
        );
      const old = value.replaceVersion
        ? limits.slots.find((s) => s.version === value.replaceVersion)
        : undefined;
      if (value.replaceVersion && !old)
        throw new GameError(
          404,
          "replace_missing",
          "只能重新生成自己栏位中的故事。",
        );
      const slot =
        old?.slot ??
        [1, 2, 3].find((i) => !limits.slots.some((s) => s.slot === i));
      if (!slot)
        throw new GameError(
          409,
          "slots_full",
          "三个栏位已满，请删除一篇或重新生成已有故事。",
        );
      this.store.db
        .prepare(
          "INSERT INTO generation_jobs(id,principal_id,tags_json,status,phase,book_version,error_code,created_at,deadline,description,replace_version,slot) VALUES(?,?,?,'queued','等待编写',NULL,NULL,?,?,?,?,?)",
        )
        .run(
          value.id,
          owner,
          JSON.stringify(value.tags),
          Date.now(),
          Date.now() + 18 * 60000,
          value.description,
          value.replaceVersion ?? null,
          slot,
        );
      return true;
    });
    return {
      job: publicJob(
        this.store.db
          .prepare("SELECT * FROM generation_jobs WHERE id=?")
          .get(value.id) as Job,
      ),
      started: inserted,
    };
  }
  async run(id: string) {
    if (
      !this.store.db
        .prepare(
          "UPDATE generation_jobs SET status='running' WHERE id=? AND status='queued'",
        )
        .run(id).changes
    )
      return;
    const job = this.store.db
      .prepare("SELECT * FROM generation_jobs WHERE id=?")
      .get(id) as Job;
    let budget: ResearchBudget | undefined;
    try {
      this.requireAccount(job.principal_id);
      if (!this.enabled()) throw Error("disabled");
      if (job.deadline <= Date.now()) throw Error("deadline");
      // Refresh on explicit generation only. Browsing, builds and polling never fetch or pay.
      const items = await this.cache.catalog(true, true),
        tags = JSON.parse(job.tags_json) as string[],
        selected = selectSources(items, tags),
        sources = [];
      for (const item of selected)
        sources.push(await this.cache.detail(item, items, true));
      mkdirSync(resolve("data/research"), { recursive: true });
      if (!this.injectedModel)
        budget = new ResearchBudget(
          resolve("data/research/budget.sqlite"),
          this.cfg.LLM_BUDGET_YUAN === "unlimited"
            ? Infinity
            : this.cfg.LLM_BUDGET_YUAN * 1e6,
        );
      const model: BookModel =
        this.injectedModel ??
        (async (phase, messages, maxTokens) => {
          const remaining = job.deadline - Date.now();
          if (remaining < 1000) throw Error("deadline");
          return (
            await paidJSON(
              budget!,
              this.cfg.DEEPSEEK_API_KEY,
              `player-${id}:${phase}`,
              messages,
              phase.startsWith("review")
                ? 5000
                : phase.startsWith("write")
                  ? 36000
                  : maxTokens,
              Math.min(300000, remaining),
              false,
              true,
              "low",
            )
          ).value;
        });
      const book = await generateBook(
        tags,
        sources,
        model,
        (phase) =>
          this.store.db
            .prepare(
              "UPDATE generation_jobs SET phase=? WHERE id=? AND status='running'",
            )
            .run(phase, id),
        undefined,
        (draft) =>
          this.store.db
            .prepare(
              "UPDATE generation_jobs SET draft_json=? WHERE id=? AND status='running'",
            )
            .run(JSON.stringify(draft), id),
        job.description,
      );
      book.version = `generated-${createHash("sha256")
        .update(id + JSON.stringify(book))
        .digest("hex")
        .slice(0, 24)}`;
      ScriptBookSchema.parse(book);
      this.store.transaction(() => {
        const current = this.store.db
          .prepare(
            "SELECT status FROM generation_jobs WHERE id=? AND principal_id=? AND deadline>?",
          )
          .get(id, job.principal_id, Date.now()) as
          | { status: string }
          | undefined;
        if (current?.status !== "running") throw Error("job_expired");
        this.store.db
          .prepare("INSERT INTO generated_books VALUES(?,?,?,?)")
          .run(
            book.version,
            job.principal_id,
            JSON.stringify(book),
            Date.now(),
          );
        this.store.db
          .prepare(
            "INSERT INTO book_slots VALUES(?,?,?) ON CONFLICT(principal_id,slot) DO UPDATE SET version=excluded.version",
          )
          .run(job.principal_id, job.slot, book.version);
        this.store.db
          .prepare(
            "UPDATE generation_jobs SET status='ready',phase='故事已完成',book_version=? WHERE id=?",
          )
          .run(book.version, id);
      });
      registerBook(book);
    } catch (e) {
      const message = e instanceof Error ? e.message : "",
        code =
          e instanceof Error && ["AbortError", "TimeoutError"].includes(e.name)
            ? "timeout"
            : message.includes("deadline") || message.includes("expired")
              ? "deadline"
              : message.startsWith("generation_not_approved")
                ? "quality"
                : message === "provider_http_402"
                  ? "balance"
                  : message.startsWith("provider_http")
                    ? "provider"
                    : message.includes("budget")
                      ? "quota"
                      : "generation_failed";
      // Private schema/editorial diagnostic only; the public DTO never includes it or the draft.
      const diagnostic =
        code === "quality"
          ? message.slice(0, 10000)
          : /^provider_http_\d{3}$/.test(message)
            ? message
            : code;
      this.store.db
        .prepare(
          "UPDATE generation_jobs SET status='failed',phase='生成未完成',error_code=?,diagnostic=? WHERE id=? AND status='running'",
        )
        .run(code, diagnostic, id);
    } finally {
      budget?.close();
    }
  }
  books(owner: string) {
    return new Bookshelf(this.store).personal(owner).map((s) => s.book);
  }
}
