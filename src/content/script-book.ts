import { z } from "zod";
import { storedArcadeGames, gamesByAttribute } from "../domain/arcade";
import { viewpointIssues } from "./narration-viewpoint";
export const speakers = [
  "gm",
  "player",
  "student",
  "sister",
  "engineer",
  "visitor",
] as const;
export const faces = [
  "neutral",
  "smile",
  "worried",
  "surprised",
  "angry",
  "sad",
] as const;
export const ScriptLineSchema = z
  .object({
    speaker: z.enum(speakers),
    expression: z.enum(faces),
    text: z.string().min(1).max(180),
  })
  .strict();
export type ScriptLine = z.infer<typeof ScriptLineSchema>;
export const RouteSchema = z
  .object({
    stage: z.number().int().min(1).max(12).optional(),
    ending: z.string().max(60).optional(),
    requires: z.array(z.string()).max(8).optional(),
    otherwise: z.string().max(60).optional(),
    grants: z.array(z.string()).max(8).default([]),
    bridge: z.array(ScriptLineSchema).max(12),
  })
  .strict();
export const BranchesSchema = z
  .object({
    success: z.array(ScriptLineSchema).min(1).max(6),
    partial: z.array(ScriptLineSchema).min(1).max(6),
    failure: z.array(ScriptLineSchema).min(1).max(6),
  })
  .strict();
export const StagePlanSchema = z
  .object({
    title: z.string().max(60),
    location: z.string().max(100),
    roles: z.array(z.enum(speakers)).min(2).max(6),
    anchor: z.string().min(5).max(180),
    knownFacts: z.array(z.string().max(200)).min(2).max(12),
    landing: z.string().max(200),
    sideLimit: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  })
  .strict();
export const ScriptStageSchema = StagePlanSchema.extend({
  opening: z.array(ScriptLineSchema).min(8).max(64),
  activity: z
    .object({
      attribute: z.enum(["body", "agility", "mind", "presence"]),
      game: z.enum(storedArcadeGames).optional(),
      title: z.string().min(2).max(40),
      afterLine: z.number().int().min(4).max(60),
      intro: z.array(ScriptLineSchema).min(1).max(6),
      success: z.array(ScriptLineSchema).min(1).max(6),
      failure: z.array(ScriptLineSchema).min(1).max(6),
    })
    .strict()
    .optional(),
  transition: z.array(ScriptLineSchema).max(12),
  choices: z
    .array(
      z
        .object({
          id: z
            .string()
            .regex(/^[a-z][a-z0-9_-]{0,24}$/)
            .optional(),
          tier: z.enum(["low", "medium", "high"]).optional(),
          attribute: z.enum(["body", "agility", "mind", "presence"]),
          label: z.string().min(2).max(50),
          conditions: z.array(z.string().max(120)).min(1).max(3),
          branches: BranchesSchema,
          risk: z.string().max(220).optional(),
          routes: z
            .object({
              success: RouteSchema,
              partial: RouteSchema,
              failure: RouteSchema,
            })
            .strict()
            .optional(),
        })
        .strict(),
    )
    .min(2)
    .max(4),
}).strict();
export const ScriptBookSchema = z
  .object({
    version: z.union([
      z.enum(["homecoming-script-2.0", "homecoming-branch-3.0"]),
      z.string().regex(/^generated-[a-f0-9]{24}$/),
      z.string().regex(/^curated-[a-z0-9-]+-1\.[0123]$/),
    ]),
    edition: z.enum(["curated-v1", "flex-v1"]).optional(),
    description: z.string().max(240).optional(),
    source: z
      .object({
        workId: z.string(),
        title: z.string(),
        author: z.string(),
        url: z.string(),
        tags: z.array(z.string()),
      })
      .strict()
      .optional(),
    structure: z.literal("branching").optional(),
    references: z
      .array(
        z
          .object({
            workId: z.string(),
            title: z.string(),
            author: z.string(),
            url: z.string(),
            tags: z.array(z.string()),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    graphFlags: z.array(z.string()).max(8).optional(),
    initialFlags: z.array(z.string()).max(8).optional(),
    roleNames: z
      .partialRecord(z.enum(speakers), z.string().min(1).max(30))
      .optional(),
    flagLabels: z.record(z.string(), z.string().max(120)).optional(),
    title: z.string().max(50),
    stages: z.array(ScriptStageSchema).min(3).max(12),
    endings: z
      .array(
        z
          .object({
            id: z.string().min(1).max(60),
            category: z.enum(["good", "bad", "true"]).optional(),
            title: z.string().max(60),
            dialogue: z.array(ScriptLineSchema).min(6).max(24),
          })
          .strict(),
      )
      .min(3)
      .max(6),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (new Set(b.endings.map((e) => e.id)).size !== b.endings.length)
      ctx.addIssue({
        code: "custom",
        message: "three distinct endings required",
      });
    b.stages.forEach((s, i) => {
      if (!b.edition && new Set(s.choices.map((c) => c.attribute)).size !== 4)
        ctx.addIssue({
          code: "custom",
          message: `stage ${i + 1}: four attributes required`,
        });
      if (!s.roles.includes("gm") || !s.roles.includes("player"))
        ctx.addIssue({ code: "custom", message: "GM and player required" });
      for (const d of [
        ...s.opening,
        ...s.transition,
        ...s.choices.flatMap((c) => Object.values(c.branches).flat()),
      ])
        if (!s.roles.includes(d.speaker))
          ctx.addIssue({
            code: "custom",
            message: `stage ${i + 1}: illegal speaker`,
          });
    });
    if (b.edition) {
      const issue = (message: string) =>
        ctx.addIssue({ code: "custom", message });
      if (
        b.structure !== "branching" ||
        b.stages.length < 3 ||
        b.stages.length > 5
      )
        issue("flexible books require 3–5 branching stages");
      if (
        b.endings.length < 4 ||
        b.endings.length > 6 ||
        b.endings.filter((e) => e.category === "true").length !== 1 ||
        !b.endings.some((e) => e.category === "good") ||
        !b.endings.some((e) => e.category === "bad")
      )
        issue("4–6 endings, one true and at least one good and bad required");
      for (const s of b.stages) {
        if (
          s.activity?.game &&
          !gamesByAttribute[s.activity.attribute].includes(s.activity.game)
        )
          issue("minigame must match its attribute");
        if (
          s.choices.length > 3 ||
          s.choices.some((c) => !c.id || !c.tier) ||
          new Set(s.choices.map((c) => c.id)).size !== s.choices.length
        )
          issue(
            "2–3 uniquely identified choices with difficulty bands required",
          );
        if (s.opening.length < 8)
          issue("flexible scene requires at least 8 complete paragraphs");
        if (
          s.activity &&
          (s.activity.afterLine > s.opening.length ||
            [
              ...s.activity.intro,
              ...s.activity.success,
              ...s.activity.failure,
            ].some((l) => !s.roles.includes(l.speaker)))
        )
          issue("activity must occur inside the scene with present speakers");
      }
    }
    if (b.structure === "branching") {
      const issue = (message: string, path: (string | number)[] = []) =>
        ctx.addIssue({ code: "custom", message, path });
      const flags = b.graphFlags ?? [],
        endings = new Set(b.endings.map((e) => e.id));
      if (
        new Set(flags).size !== flags.length ||
        [...(b.initialFlags ?? []), ...Object.keys(b.flagLabels ?? {})].some(
          (f) => !flags.includes(f),
        )
      )
        issue("initial facts and labels must use declared unique flags");
      if (
        !b.edition &&
        (!(
          b.version === "homecoming-branch-3.0" ||
          b.version.startsWith("generated-")
        ) ||
          b.endings.filter((e) => e.category === "good").length !== 2 ||
          b.endings.filter((e) => e.category === "bad").length !== 3 ||
          b.endings.filter((e) => e.category === "true").length !== 1)
      )
        issue("branching book needs 2 good, 3 bad, 1 true endings");
      for (const [i, s] of b.stages.entries()) {
        if (s.sideLimit !== 0) issue("branching book has no side slots");
        for (const [ci, c] of s.choices.entries()) {
          if (!c.routes || !c.risk) {
            issue("every choice needs routes and disclosed risk");
            continue;
          }
          for (const [outcome, r] of Object.entries(c.routes)) {
            const path = ["stages", i, "choices", ci, "routes", outcome];
            if (
              Number(r.stage !== undefined) + Number(r.ending !== undefined) !==
              1
            )
              issue("route needs exactly one destination", path);
            if (
              r.stage !== undefined &&
              (r.stage <= i + 1 || r.stage > b.stages.length)
            )
              issue("route must lead forward to a valid stage", path);
            if (r.ending && !endings.has(r.ending))
              issue(
                `unknown ending '${r.ending}'; declared: ${[...endings].join(", ")}`,
                [...path, "ending"],
              );
            if (
              r.requires?.length &&
              (!r.ending || !r.otherwise || !endings.has(r.otherwise))
            )
              issue("conditional ending needs fallback", path);
            if (
              [...r.grants, ...(r.requires ?? [])].some(
                (f) => !flags.includes(f),
              )
            )
              issue("unknown route flag", path);
            if (r.bridge.some((d) => !s.roles.includes(d.speaker)))
              issue("route bridge has absent speaker", path);
          }
        }
      }
    } else if (
      b.endings.length !== 3 ||
      b.endings.some((e) => !["good", "bad", "true"].includes(e.id))
    )
      ctx.addIssue({
        code: "custom",
        message: "legacy book needs its three endings",
      });
  });
export type ScriptBook = z.infer<typeof ScriptBookSchema>;
export type ScriptStage = z.infer<typeof ScriptStageSchema>;
export const LocalPlanSchema = z
  .object({
    continuity: z
      .object({
        choiceId: z.string().max(60),
        landingIds: z
          .object({
            success: z.string().max(80),
            partial: z.string().max(80),
            failure: z.string().max(80),
          })
          .strict(),
      })
      .strict()
      .optional(),
    adjudication: z
      .object({
        reason: z.string().min(8).max(220),
        evidenceQuote: z.string().max(180),
        limitation: z.string().min(4).max(180),
      })
      .strict()
      .optional(),
    conditions: z.array(z.string().min(1).max(120)).min(1).max(3),
    branches: BranchesSchema,
    rejoins: BranchesSchema.optional(),
  })
  .strict();
export type LocalPlan = z.infer<typeof LocalPlanSchema>;
export function validateLocalLines(plan: LocalPlan, stage: ScriptStage) {
  if (viewpointIssues(plan).length) throw Error("local_gm_viewpoint");
  for (const line of [
    ...Object.values(plan.branches).flat(),
    ...Object.values(plan.rejoins ?? {}).flat(),
  ]) {
    if (!stage.roles.includes(line.speaker))
      throw Error("local_illegal_speaker");
    if (
      /竹马.{0,8}(醒来了|睁开眼|开口说)|复活竹马|新增.{0,3}(属性|道具)|下一阶段已/.test(
        line.text,
      )
    )
      throw Error("local_changes_canon");
  }
  return plan;
}
