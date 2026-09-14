import { Bookshelf } from "./bookshelf";
import { oauthReady } from "./zhihu-login";
import { isFixedScriptAction } from "../domain/script-action";
import { continuityFor } from "./custom-action";
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  CharacterSchema,
  GameError,
  type State,
  type PublicTurn,
  type PublicResult,
  type Narration,
} from "../domain/types";
import { scenario } from "../content/legacy/snail-scenario";
import {
  getScenario,
  homecoming,
  fixedScenario,
  currentScenario,
  scenarios,
  registerBook,
} from "../content/registry";
import {
  LocalPlanSchema,
  validateLocalLines,
  type LocalPlan,
} from "../content/script-book";
import {
  resolveScript,
  scriptNames,
  endingLabel,
  effectiveStats,
} from "../engine/script-rules";
import {
  makeChallenge,
  gradeChallenge,
  type Challenge,
} from "../domain/minigames";
import {
  compileActionOptions,
  initialState,
  project,
  publicAction,
  resolveTurn,
  validateScenario,
} from "../engine/rules";
import type { Config } from "./config";
import { Store } from "./database";
import { parseState } from "../domain/state-schema";
import { AIError, ModelGateway, type Context, type Provider } from "./ai";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid = z.string().uuid();
const ProposalInput = z
  .object({
    expectedStateVersion: z.number().int().min(0),
    text: z
      .string()
      .trim()
      .min(1)
      .refine((s) => Array.from(s).length <= 500)
      .optional(),
    actionOptionId: z.string().max(120).optional(),
    mode: z.enum(["side", "key"]).optional(),
  })
  .strict()
  .refine((v) => !!v.text !== !!v.actionOptionId);
const TurnInput = z
  .object({
    clientTurnId: uuid,
    proposalId: uuid,
    expectedStateVersion: z.number().int().min(0),
  })
  .strict();
interface GameRow {
  id: string;
  principal_id: string;
  state_json: string;
  state_version: number;
  status: string;
}
interface TurnRow {
  id: string;
  game_id: string;
  request_hash: string;
  public_result: string;
  narration_status: PublicTurn["narrationStatus"];
  narration: string | null;
  error_code: string | null;
  context_json: string;
  narration_lease_until: number | null;
}
interface Auth {
  owner: string;
  csrf: string;
  expiresAt: number;
}
export class GameService {
  gateway: ModelGateway;
  constructor(
    public store: Store,
    public cfg: Config,
    private dice: () => number = () => randomInt(1, 11),
    provider?: Provider,
  ) {
    validateScenario(scenario);
    this.gateway = new ModelGateway(store, cfg, provider);
    for (const row of store.db
      .prepare(
        "SELECT book_json FROM generated_books UNION ALL SELECT book_json FROM community_books",
      )
      .all() as { book_json: string }[])
      registerBook(JSON.parse(row.book_json));
  }
  get cookieName() {
    return this.cfg.APP_ORIGIN.startsWith("https:")
      ? "__Host-snail_sid"
      : "snail_sid_dev";
  }
  auth(token?: string | null): Auth | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.store.db
      .prepare(
        "SELECT principal_id,expires_at FROM visitor_sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(hash(token), Date.now()) as
      | { principal_id: string; expires_at: number }
      | undefined;
    return row
      ? {
          owner: row.principal_id,
          csrf: hash(`csrf:${token}`),
          expiresAt: row.expires_at,
        }
      : null;
  }
  visitor(token?: string | null) {
    const existing = this.auth(token);
    if (existing) return { auth: existing, token: null };
    this.store.cleanup();
    return this.store.transaction(() => {
      const now = Date.now(),
        expires = now + this.cfg.GUEST_SESSION_DAYS * 86400000,
        owner = randomUUID(),
        t = randomBytes(32).toString("hex");
      this.store.db
        .prepare("INSERT INTO principals VALUES(?,?,?,?)")
        .run(owner, "guest", now, expires);
      this.store.db
        .prepare("INSERT INTO visitor_sessions VALUES(?,?,?,?)")
        .run(randomUUID(), owner, hash(t), expires);
      return {
        auth: { owner, csrf: hash(`csrf:${t}`), expiresAt: expires },
        token: t,
      };
    });
  }
  me(a: Auth) {
    const active = this.store.db
      .prepare("SELECT id FROM games WHERE principal_id=? AND status=?")
      .get(a.owner, "playing") as { id: string } | undefined;
    const summaries = this.store.db
      .prepare(
        "SELECT ending_id AS endingId,title,turns,created_at AS createdAt FROM ending_summaries WHERE principal_id=? ORDER BY created_at DESC LIMIT 3",
      )
      .all(a.owner);
    const account =
      this.store.db
        .prepare("SELECT name FROM zhihu_accounts WHERE principal_id=?")
        .get(a.owner) ?? null;
    return {
      activeGameId: active?.id ?? null,
      account,
      testFeatures: this.testFeatures(a.owner),
      oauthReady: oauthReady(this.cfg),
      csrfToken: a.csrf,
      expiresAt: a.expiresAt,
      summaries,
      collection: this.collection(a.owner),
      mode: this.cfg.LLM_MODE,
      liveEnabled:
        this.cfg.LLM_MODE === "live" && this.cfg.AI_LIVE_ENABLED === "true",
      retention: account
        ? "书架和结局收藏跟随知乎账号。登录会话到期后请重新登录；已结束的完整局记录最多保留7天。"
        : "访客存档有效期为30天。请使用同一浏览器继续，清除浏览器数据可能丢失进度。结局收藏保留最后一幕回顾，已结束的完整对话记录最多保留7天。",
    };
  }
  private game(owner: string, id: string) {
    const row = this.store.db
      .prepare("SELECT * FROM games WHERE id=? AND principal_id=?")
      .get(id, owner) as unknown as GameRow | undefined;
    if (!row) throw new GameError(404, "not_found", "没有找到这个存档。");
    const raw = JSON.parse(row.state_json);
    const selected = getScenario(raw.scenarioVersion);
    return { row, scenario: selected, state: parseState(raw, selected) };
  }
  create(owner: string, input: unknown) {
    const { scenarioVersion, ...character } = z
      .object({ scenarioVersion: z.string().optional() })
      .passthrough()
      .parse(input);
    if (
      scenarioVersion &&
      ![
        homecoming.version,
        fixedScenario.version,
        currentScenario.version,
        ...scenarios.map((s) => s.version),
      ].includes(scenarioVersion) &&
      !this.ownsBook(owner, scenarioVersion)
    )
      throw new GameError(
        410,
        "scenario_retired",
        "原版蜗牛剧本已下架，请开始《错位百年》。旧存档仍保留。",
      );
    const selected = scenarioVersion
      ? getScenario(scenarioVersion)
      : currentScenario;
    const ch = CharacterSchema.parse(character);
    const scenarioLocal = selected;
    return this.store.transaction(() => {
      const retired = this.store.db
        .prepare(
          "SELECT id,state_json FROM games WHERE principal_id=? AND status='playing' AND scenario_version<>?",
        )
        .get(owner, selected.version) as
        | { id: string; state_json: string }
        | undefined;
      if (
        retired &&
        !JSON.parse(retired.state_json).scenarioVersion.startsWith(
          "curated-",
        ) &&
        !JSON.parse(retired.state_json).scenarioVersion.startsWith(
          "generated-",
        ) &&
        !this.ownsBook(owner, JSON.parse(retired.state_json).scenarioVersion) &&
        !scenarios.some(
          (s) => s.version === JSON.parse(retired.state_json).scenarioVersion,
        ) &&
        JSON.parse(retired.state_json).scenarioVersion !==
          currentScenario.version
      ) {
        const saved = JSON.parse(retired.state_json);
        saved.status = "abandoned";
        saved.version++;
        this.store.db
          .prepare(
            "UPDATE games SET status='abandoned',state_version=?,state_json=?,updated_at=? WHERE id=?",
          )
          .run(saved.version, JSON.stringify(saved), Date.now(), retired.id);
      }
      if (
        this.store.db
          .prepare("SELECT id FROM games WHERE principal_id=? AND status=?")
          .get(owner, "playing")
      )
        throw new GameError(
          409,
          "active_exists",
          "已有进行中的存档，请继续，或明确放弃后再开始。",
        );
      const id = randomUUID(),
        st = initialState(ch, scenarioLocal),
        now = Date.now();
      this.store.db
        .prepare("INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          owner,
          st.rulesVersion,
          st.scenarioVersion,
          st.assetCatalogVersion,
          0,
          "playing",
          JSON.stringify(st),
          JSON.stringify(st.castSnapshot),
          now,
          now,
        );
      return { state: project(st, scenarioLocal, id), turns: [] };
    });
  }
  read(owner: string, id: string) {
    const { state, scenario } = this.game(owner, id);
    return {
      state: project(state, scenario, id),
      turns: this.history(owner, id, Math.max(0, state.turn - 8)),
    };
  }
  ownsBook(owner: string, version: string) {
    try {
      return (
        new Bookshelf(this.store).find(owner, version).category !== "curated"
      );
    } catch {
      return false;
    }
  }
  logout(token: string) {
    this.store.db
      .prepare("DELETE FROM visitor_sessions WHERE token_hash=?")
      .run(hash(token));
    this.store.db
      .prepare("DELETE FROM oauth_states WHERE browser_hash=?")
      .run(hash(hash(`csrf:${token}`)));
  }
  testFeatures(owner: string) {
    const row = this.store.db
      .prepare("SELECT custom_actions FROM test_features WHERE principal_id=?")
      .get(owner) as { custom_actions: number } | undefined;
    return { customActions: row?.custom_actions === 1 };
  }
  setTestFeatures(owner: string, input: unknown) {
    const flags = z
      .object({ customActions: z.boolean() })
      .strict()
      .parse(input);
    this.store.db
      .prepare(
        "INSERT INTO test_features VALUES(?,?) ON CONFLICT(principal_id) DO UPDATE SET custom_actions=excluded.custom_actions",
      )
      .run(owner, Number(flags.customActions));
    return flags;
  }
  private requireCustomActions(owner: string) {
    if (!this.testFeatures(owner).customActions)
      throw new GameError(
        403,
        "custom_actions_closed",
        "请先在首页的测试功能中开启自定义行动，并阅读衔接风险提示。",
      );
  }
  async proposeCustom(owner: string, id: string, input: unknown) {
    this.requireCustomActions(owner);
    const parsed = ProposalInput.parse(input);
    if (
      !parsed.text ||
      parsed.mode === "side" ||
      this.game(owner, id).scenario.book?.structure !== "branching"
    )
      throw new GameError(
        422,
        "custom_unavailable",
        "请描述当前关键节点的一次局部行动。",
      );
    return this.propose(owner, id, parsed, true);
  }
  history(owner: string, id: string, after = 0) {
    this.game(owner, id);
    this.expireNarration(id);
    return (
      this.store.db
        .prepare(
          "SELECT * FROM turns WHERE game_id=? AND turn_number>? ORDER BY turn_number LIMIT 64",
        )
        .all(id, after) as unknown as TurnRow[]
    ).map((r) => this.publicTurn(r));
  }
  private publicTurn(t: TurnRow): PublicTurn {
    return {
      id: t.id,
      result: JSON.parse(t.public_result),
      narrationStatus: t.narration_status,
      narration: t.narration ? JSON.parse(t.narration) : null,
      errorCode: t.error_code,
    };
  }
  private expireNarration(id: string) {
    this.store.db
      .prepare(
        "UPDATE turns SET narration_status='fallback',error_code='timeout' WHERE game_id=? AND narration_status='running' AND narration_lease_until<=?",
      )
      .run(id, Date.now());
  }
  private context(st: State, text = "", result?: PublicResult): Context {
    const scenario = getScenario(st.scenarioVersion);
    const pub = project(st, scenario);
    if (scenario.book) {
      const stage = scenario.book.stages[st.stage - 1];
      return {
        scene: stage.location,
        facts: pub.facts,
        actions: pub.actions,
        text,
        scripted: {
          mode: "key",
          branching: scenario.book.structure === "branching",
          flexible: !!scenario.book.edition,
          stage: st.stage,
          anchor: stage.anchor,
          landing: "完成眼前这一件事，随后播放固定过场；不要自行跨场景或跳时间",
          opening: stage.opening,
        },
        roles: stage.roles.map((id) => ({
          roleId: id,
          name: scenario.book!.roleNames?.[id] ?? scriptNames[id],
          expressions: [
            "neutral",
            "smile",
            "worried",
            "surprised",
            "angry",
            "sad",
          ],
        })),
        ...(result ? { result } : {}),
      };
    }
    return {
      scene: result?.afterScene ?? pub.render.sceneLabel,
      ...(scenario.drama
        ? {
            drama: {
              goal:
                scenario.actions.find(
                  (a) => a.stage === st.stage && a.step === st.counters.step,
                )?.target ?? pub.stage.intro,
              time: result?.afterScene ?? pub.render.sceneLabel,
              voices: scenario.drama.voices,
              stage: st.stage,
              step: st.counters.step,
            },
          }
        : {}),
      facts: pub.facts,
      actions: result ? [] : pub.actions,
      text,
      roles: pub.render.characters
        .filter(
          (c) =>
            !scenario.drama ||
            c.roleId !== "student" ||
            (st.stage === 1 && st.counters.step === 0) ||
            (st.stage === 2 && st.counters.step === 1),
        )
        .map((c) => ({
          roleId: c.roleId,
          name: c.name,
          expressions: [
            "neutral",
            "smile",
            "worried",
            "surprised",
            "angry",
            "sad",
          ].map((e) => `${c.actorId}.face.${e}`),
        })),
      ...(result ? { result } : {}),
    };
  }
  async propose(
    owner: string,
    id: string,
    input: unknown,
    customBridge = false,
  ) {
    const body = ProposalInput.parse(input);
    const { state, scenario } = this.game(owner, id);
    if (state.version !== body.expectedStateVersion)
      throw new GameError(409, "stale", "存档已变化，请刷新后重新选择。");
    this.store.transaction(() => {
      const minute = Math.floor(Date.now() / 60000);
      const count =
        (
          this.store.db
            .prepare(
              "SELECT count FROM preview_limits WHERE principal_id=? AND minute=?",
            )
            .get(owner, minute) as { count: number } | undefined
        )?.count ?? 0;
      if (count >= 12)
        throw new GameError(
          429,
          "preview_rate",
          "预览过于频繁，请稍后再试；已确认的存档不受影响。",
        );
      this.store.db
        .prepare(
          "INSERT INTO preview_limits VALUES(?,?,1) ON CONFLICT(principal_id,minute) DO UPDATE SET count=count+1",
        )
        .run(owner, minute);
    });
    let localPlan: LocalPlan | undefined;
    let actionId = body.actionOptionId,
      intent = "";
    if (body.text) {
      try {
        const context = this.context(state, body.text);
        if (customBridge && context.scripted) {
          context.scripted.continuity = continuityFor(scenario.book!, state);
          context.scripted.landing =
            "按选中方向对应判定结果的衔接契约完成局部桥段，不重演后续预写对白";
        }
        if (context.scripted) {
          if (context.scripted.branching && body.mode === "side")
            return {
              kind: "unsupported",
              message: "新版取消独立支线，请描述本节点的关键做法。",
            };
          context.scripted.mode = body.mode ?? "key";
          const previous = this.store.db
            .prepare(
              "SELECT public_result AS result FROM turns WHERE game_id=? ORDER BY turn_number DESC LIMIT 1",
            )
            .get(id) as { result: string } | undefined;
          if (previous)
            context.scripted.previousDialogue = (
              JSON.parse(previous.result) as PublicResult
            ).scriptDialogue?.slice(-12);
          const side = context.scripted.mode === "side";
          context.actions = context.actions.filter((a) =>
            a.id.includes(side ? ".side." : ".custom."),
          );
          if (side) {
            context.scripted.anchor = "当前场景内的小行动，不改变主线";
            context.scripted.landing = "仍然留在当前场景，主线保持原样";
          }
          if (!context.actions.length)
            return {
              kind: "unsupported",
              message: "本阶段支线机会已用完，可以直接选择关键行动。",
            };
        }
        const interpreted = (await this.gateway.run(
          "interpreter",
          owner,
          context,
        )) as import("../domain/types").Interpretation;
        if (interpreted.kind !== "act")
          return {
            kind: interpreted.kind,
            message:
              interpreted.kind === "view"
                ? project(state, scenario)
                    .facts.map((f) => f.text)
                    .join("\n")
                : (interpreted.message ?? "请从当前选项中选择。"),
          };
        actionId = interpreted.actionOptionId!;
        intent = interpreted.intent;
        localPlan = interpreted.localPlan;
        if (customBridge && localPlan && context.scripted) {
          this.requireCustomActions(owner);
          if (this.game(owner, id).state.version !== state.version)
            throw new GameError(409, "stale", "进度已变化，请重新预览。");
          try {
            validateLocalLines(
              localPlan,
              scenario.book!.stages[state.stage - 1],
            );
          } catch {
            throw new AIError("schema_invalid");
          }
          // Only review the selected route. It contains all three actual roll landings.
          const reviewContext: Context = {
            ...context,
            actions: [],
            scripted: {
              ...context.scripted,
              reviewPlan: localPlan,
              continuity: context.scripted.continuity!.filter(
                (r) => r.choiceId === localPlan!.continuity!.choiceId,
              ),
            },
          };
          const review = (await this.gateway.run(
            "continuity",
            owner,
            reviewContext,
          )) as import("./ai").ContinuityReview;
          if (!review.approved)
            return {
              kind: "fallback",
              errorCode: "continuity_rejected",
              message:
                "这个做法的后续暂时接不顺，尚未消耗行动。请换个说法或选择推荐行动。",
            };
        }
      } catch (e) {
        if (e instanceof AIError)
          return {
            kind: "fallback",
            errorCode: e.code,
            message: customBridge
              ? "城主暂时没能整理好这段行动，尚未消耗行动。请稍后重试，或选择推荐行动。"
              : `行动解释暂不可用（${e.code}）。未消耗行动，请保留输入并选择下方按钮。`,
          };
        throw e;
      }
    }
    return this.store.transaction(() => {
      const current = this.game(owner, id).state;
      if (customBridge) this.requireCustomActions(owner);
      if (current.version !== body.expectedStateVersion)
        throw new GameError(409, "stale", "解释期间存档已变化，请重新预览。");
      const a = compileActionOptions(current, scenario).find(
        (a) => a.id === actionId,
      );
      if (!a)
        throw new GameError(
          422,
          "illegal_action",
          "这个选项暂时不可用，请重新选择。",
        );
      if (scenario.book && !isFixedScriptAction(a.id) && !localPlan)
        throw new GameError(
          422,
          "local_plan_required",
          "自由行动需要先解释并预览。",
        );
      if (scenario.book && localPlan) {
        try {
          validateLocalLines(
            localPlan,
            scenario.book.stages[current.stage - 1],
          );
        } catch {
          throw new GameError(
            422,
            "schema_invalid",
            "这次桥段没能通过检查，尚未消耗行动。请换个说法或选择推荐行动。",
          );
        }
      }
      const pid = randomUUID(),
        expires = Date.now() + 600000;
      this.store.db
        .prepare("DELETE FROM proposals WHERE game_id=? AND expires_at<=?")
        .run(id, Date.now());
      this.store.db
        .prepare(
          "INSERT INTO proposals(id,game_id,state_version,action_id,action_hash,action_snapshot,original_input,intent,expires_at,local_plan) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          pid,
          id,
          current.version,
          a.id,
          hash(JSON.stringify(a)),
          JSON.stringify(a),
          body.text ?? "",
          intent || a.intent,
          expires,
          localPlan ? JSON.stringify(localPlan) : null,
        );
      return {
        kind: "act",
        proposal: {
          id: pid,
          stateVersion: current.version,
          expiresAt: expires,
          intent: intent || a.intent,
          action: {
            ...publicAction(current, a),
            ...(localPlan
              ? {
                  risk: [
                    localPlan.adjudication?.reason,
                    localPlan.adjudication?.limitation,
                    localPlan.conditions.join("；"),
                    a.risk,
                  ]
                    .filter(Boolean)
                    .map((text) => text!.replace(/[。；;\s]+$/u, ""))
                    .join("。"),
                }
              : {}),
          },
        },
      };
    });
  }
  commit(owner: string, id: string, input: unknown) {
    const body = TurnInput.parse(input);
    const requestHash = hash(JSON.stringify(body));
    this.game(owner, id);
    return this.store.transaction(() => {
      const previous = this.store.db
        .prepare("SELECT * FROM turns WHERE game_id=? AND client_turn_id=?")
        .get(id, body.clientTurnId) as unknown as TurnRow | undefined;
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new GameError(
            409,
            "idempotency_conflict",
            "这次行动的信息有变化，请刷新页面后重新选择。",
          );
        return {
          turn: this.publicTurn(previous),
          state: this.read(owner, id).state,
        };
      }
      const { state, scenario } = this.game(owner, id);
      if (state.version !== body.expectedStateVersion)
        throw new GameError(409, "stale", "另一页面已经推进了故事，请刷新。");
      if (
        scenario.book?.stages[state.stage - 1].activity?.game &&
        !state.counters[`activity_${state.stage}`]
      )
        throw new GameError(
          409,
          "activity_required",
          "请先完成这一幕的小游戏，再决定关键行动。",
        );
      const p = this.store.db
        .prepare("SELECT * FROM proposals WHERE id=? AND game_id=?")
        .get(body.proposalId, id) as
        | {
            state_version: number;
            expires_at: number;
            action_id: string;
            action_hash: string;
            action_snapshot: string;
            original_input: string;
            local_plan: string | null;
          }
        | undefined;
      if (!p) throw new GameError(404, "not_found", "没有找到这个预览。");
      if (p.local_plan && JSON.parse(p.local_plan).continuity)
        this.requireCustomActions(owner);
      if (p.state_version !== state.version || p.expires_at <= Date.now())
        throw new GameError(
          409,
          "proposal_expired",
          "预览已失效，请重新选择。",
        );
      if (
        this.store.db
          .prepare("SELECT id FROM turns WHERE game_id=? AND proposal_id=?")
          .get(id, body.proposalId)
      )
        throw new GameError(409, "proposal_used", "这个预览已经结算。");
      const action = compileActionOptions(state, scenario).find(
        (a) => a.id === p.action_id,
      );
      if (
        !action ||
        hash(JSON.stringify(action)) !== p.action_hash ||
        p.action_snapshot !== JSON.stringify(action)
      )
        throw new GameError(
          422,
          "illegal_action",
          "行动条件已变化，请重新预览。",
        );
      const rolled = action.attribute ? this.dice() : null;
      const { state: next, result } = scenario.book
        ? resolveScript(
            state,
            scenario,
            action.id,
            rolled,
            p.local_plan
              ? validateLocalLines(
                  LocalPlanSchema.parse(JSON.parse(p.local_plan)),
                  scenario.book.stages[state.stage - 1],
                )
              : undefined,
          )
        : resolveTurn(state, scenario, action.id, rolled);
      if (p.original_input) result.actionLabel = p.original_input;
      const tid = randomUUID();
      const ctx = this.context(state, p.original_input, result);
      ctx.actions = [];
      ctx.facts = project(next, scenario).facts;
      if (ctx.drama) ctx.drama.ending = project(next, scenario).ending?.text;
      if (ctx.drama)
        ctx.drama.nextGoal = project(next, scenario).actions[0]?.target;
      if (ctx.drama)
        ctx.drama.previousDialogue = this.history(
          owner,
          id,
          Math.max(0, state.turn - 2),
        )
          .filter((t) => t.result.beforeScene === result.beforeScene)
          .flatMap((t) => t.narration?.dialogue ?? [])
          .filter((d) => ctx.roles.some((r) => r.roleId === d.roleId))
          .slice(-8)
          .map(({ roleId, text }) => ({ roleId, text }));
      this.store.db
        .prepare(
          "UPDATE games SET state_json=?,state_version=?,status=?,updated_at=? WHERE id=? AND state_version=?",
        )
        .run(
          JSON.stringify(next),
          next.version,
          next.status,
          Date.now(),
          id,
          state.version,
        );
      this.store.db
        .prepare(
          "INSERT INTO turns(id,game_id,client_turn_id,turn_number,request_hash,proposal_id,before_version,after_version,die,outcome,events,public_result,fallback_narration,narration_status,context_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          tid,
          id,
          body.clientTurnId,
          next.turn,
          requestHash,
          body.proposalId,
          state.version,
          next.version,
          result.die,
          result.outcome,
          JSON.stringify(result.events),
          JSON.stringify(result),
          result.fallback,
          scenario.book ? "ready" : "pending",
          JSON.stringify(ctx),
        );
      if (next.ending) {
        if (scenario.book) {
          const end = scenario.book.endings.find((e) => e.id === next.ending)!;
          const lastStage = scenario.book.stages[state.stage - 1];
          const recap = [
            ...lastStage.opening,
            ...(result.scriptDialogue ?? []),
          ];
          this.store.db
            .prepare(
              "INSERT OR IGNORE INTO ending_collection VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              owner,
              scenario.version,
              end.id,
              end.title,
              endingLabel(scenario.book, end.id),
              JSON.stringify(recap),
              Date.now(),
            );
        }
        const ending = scenario.endings.find((e) => e.id === next.ending)!;
        this.store.db
          .prepare("INSERT INTO ending_summaries VALUES(?,?,?,?,?,?)")
          .run(id, owner, ending.id, ending.title, next.turn, Date.now());
        this.store.db
          .prepare(
            "DELETE FROM ending_summaries WHERE principal_id=? AND id NOT IN (SELECT id FROM ending_summaries WHERE principal_id=? ORDER BY created_at DESC LIMIT 3)",
          )
          .run(owner, owner);
      }
      return {
        state: project(next, scenario, id),
        turn: {
          id: tid,
          result,
          narrationStatus: scenario.book
            ? ("ready" as const)
            : ("pending" as const),
          narration: null,
          errorCode: null,
        },
      };
    });
  }
  collection(owner: string) {
    return this.store.db
      .prepare(
        "SELECT scenario_version AS scenarioVersion,ending_id AS endingId,title,label,recap,achieved_at AS achievedAt FROM ending_collection WHERE principal_id=? ORDER BY achieved_at DESC",
      )
      .all(owner)
      .map((row) => ({
        ...row,
        recap: JSON.parse(row.recap as string),
        roleNames: getScenario(row.scenarioVersion as string).book?.roleNames,
      }));
  }
  activity(owner: string, id: string, input: unknown) {
    const body = z
      .object({
        expectedStateVersion: z.number().int().min(0),
        challengeId: uuid.optional(),
        answers: z
          .array(z.number().int().min(-1000).max(1019))
          .max(512)
          .optional(),
        skip: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    return this.store.transaction(() => {
      const { state, scenario } = this.game(owner, id);
      const old = (
        body.challengeId
          ? this.store.db
              .prepare("SELECT * FROM activities WHERE game_id=? AND id=?")
              .get(id, body.challengeId)
          : this.store.db
              .prepare("SELECT * FROM activities WHERE game_id=? AND stage=?")
              .get(id, state.stage)
      ) as
        | {
            id: string;
            stage: number;
            challenge_json: string;
            result_json: string | null;
            created_at: number;
          }
        | undefined;
      if (old?.result_json && body.challengeId === old.id)
        return {
          state: project(state, scenario, id),
          result: JSON.parse(old.result_json),
        };
      if (
        state.version !== body.expectedStateVersion ||
        state.status !== "playing" ||
        (old && old.stage !== state.stage)
      )
        throw new GameError(409, "stale", "进度已变化，请刷新后继续。");
      const activity = scenario.book?.stages[state.stage - 1].activity;
      if (!activity)
        throw new GameError(422, "no_activity", "这一幕没有可用的小练习。");
      if (!body.challengeId) {
        if (old)
          return old.result_json
            ? {
                state: project(state, scenario, id),
                result: JSON.parse(old.result_json),
              }
            : { challenge: JSON.parse(old.challenge_json) };
        const challenge = makeChallenge(
          randomUUID(),
          activity.attribute,
          randomInt(0, 65536),
          activity.game,
          state.character.difficulty ?? "normal",
        );
        this.store.db
          .prepare("INSERT INTO activities VALUES(?,?,?,?,?,?,?)")
          .run(
            challenge.id,
            id,
            state.stage,
            state.turn,
            JSON.stringify(challenge),
            null,
            Date.now(),
          );
        return { challenge };
      }
      if (!old || body.challengeId !== old.id)
        throw new GameError(404, "not_found", "没有找到这次练习。");
      if (activity.game && (body.skip || !body.answers?.length))
        throw new GameError(
          422,
          "activity_attempt_required",
          "请先操作一次小游戏；未完成目标也可以结束本局。",
        );
      const challenge = JSON.parse(old.challenge_json) as Challenge;
      const success =
        !body.skip &&
        Date.now() - old.created_at < 1200000 &&
        gradeChallenge(challenge, body.answers ?? []);
      const next = structuredClone(state),
        key = `buff_${activity.attribute}`;
      const reward =
        success &&
        (next.counters.trainingTotal ?? 0) < 2 &&
        (next.counters[key] ?? 0) < 1
          ? 1
          : 0;
      next.counters[key] = (next.counters[key] ?? 0) + reward;
      next.counters.trainingTotal = (next.counters.trainingTotal ?? 0) + reward;
      next.counters[`activity_${state.stage}`] = success ? 2 : 1;
      next.version++;
      const result = {
        success,
        skipped: !!body.skip,
        reward,
        attribute: activity.attribute,
        dialogue: success ? activity.success : activity.failure,
        intro: activity.intro,
        introInOpening: !!activity.game,
        openingLength: scenario.book!.stages[state.stage - 1].opening.length,
        afterLine: activity.afterLine,
        afterTurn: state.turn,
        before: effectiveStats(state)[activity.attribute],
        after: effectiveStats(next)[activity.attribute],
      };
      this.store.db
        .prepare("UPDATE activities SET result_json=? WHERE id=?")
        .run(JSON.stringify(result), old.id);
      this.store.db
        .prepare(
          "UPDATE games SET state_json=?,state_version=?,updated_at=? WHERE id=? AND state_version=?",
        )
        .run(JSON.stringify(next), next.version, Date.now(), id, state.version);
      return { state: project(next, scenario, id), result };
    });
  }
  activityHistory(owner: string, id: string) {
    this.game(owner, id);
    return this.store.db
      .prepare(
        "SELECT result_json FROM activities WHERE game_id=? AND result_json IS NOT NULL ORDER BY stage",
      )
      .all(id)
      .map((r) => JSON.parse(r.result_json as string));
  }
  async narrate(owner: string, id: string, turnId: string) {
    this.game(owner, id);
    const claim = this.store.transaction(() => {
      this.expireNarration(id);
      const row = this.store.db
        .prepare("SELECT * FROM turns WHERE id=? AND game_id=?")
        .get(turnId, id) as unknown as TurnRow | undefined;
      if (!row) throw new GameError(404, "not_found", "没有找到这个回合。");
      if (row.narration_status !== "pending") return { row, claimed: false };
      this.store.db
        .prepare(
          "UPDATE turns SET narration_status='running',narration_attempt_count=1,narration_lease_until=? WHERE id=? AND narration_status='pending'",
        )
        .run(Date.now() + this.cfg.LLM_NARRATOR_TIMEOUT_MS + 1000, turnId);
      return { row, claimed: true };
    });
    if (!claim.claimed) return { turn: this.publicTurn(claim.row) };
    let narration: Narration | null = null,
      error: string | null = null;
    try {
      narration = (await this.gateway.run(
        "narrator",
        owner,
        JSON.parse(claim.row.context_json),
      )) as Narration;
    } catch (e) {
      error = e instanceof AIError ? e.code : "provider_error";
    }
    this.store.db
      .prepare(
        "UPDATE turns SET narration_status=?,narration=?,error_code=? WHERE id=? AND narration_status='running' AND narration_lease_until>?",
      )
      .run(
        error ? "fallback" : "ready",
        narration ? JSON.stringify(narration) : null,
        error,
        turnId,
        Date.now(),
      );
    this.expireNarration(id);
    const row = this.store.db
      .prepare("SELECT * FROM turns WHERE id=?")
      .get(turnId) as unknown as TurnRow;
    return { turn: this.publicTurn(row) };
  }
  abandon(owner: string, id: string, input: unknown) {
    const body = z
      .object({
        expectedStateVersion: z.number().int(),
        confirm: z.literal(true),
      })
      .strict()
      .parse(input);
    return this.store.transaction(() => {
      const { state, scenario } = this.game(owner, id);
      if (
        state.version !== body.expectedStateVersion ||
        state.status !== "playing"
      )
        throw new GameError(409, "stale", "此存档状态已变化。");
      state.status = "abandoned";
      state.version++;
      this.store.db
        .prepare(
          "UPDATE games SET state_json=?,state_version=?,status=?,updated_at=? WHERE id=?",
        )
        .run(
          JSON.stringify(state),
          state.version,
          state.status,
          Date.now(),
          id,
        );
      return { abandoned: true };
    });
  }
}
export function checkWrite(request: Request, cfg: Config, csrf?: string) {
  if (
    request.headers.get("origin") !== cfg.APP_ORIGIN ||
    !request.headers.get("content-type")?.startsWith("application/json") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new GameError(403, "origin", "请回到游戏页面重新操作。");
  if (csrf) {
    const supplied = request.headers.get("x-csrf-token") ?? "";
    if (
      Buffer.byteLength(supplied) !== Buffer.byteLength(csrf) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(csrf))
    )
      throw new GameError(403, "csrf", "页面已过期，请刷新后继续。");
  } else if (request.headers.get("x-snail-request") !== "1")
    throw new GameError(403, "csrf", "请从本站开始游戏。");
}
