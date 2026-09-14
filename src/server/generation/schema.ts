import { z } from "zod";
import { faces, speakers } from "../../content/script-book";
export const END_IDS = [
  "good_1",
  "good_2",
  "bad_1",
  "bad_2",
  "bad_3",
  "true",
] as const;
export const STATS = ["body", "agility", "mind", "presence"] as const;
export const Line = z.tuple([
  z.enum(speakers),
  z.enum(faces),
  z.string().min(2).max(140),
]);
const factID = z.string().regex(/^f[1-6]$/),
  nodeID = z.string().regex(/^n[1-8]$/);
const ids = z.array(factID).max(6);
const Outcome = z
  .object({
    to: z.union([nodeID, z.enum(END_IDS)]),
    whenAll: ids.optional(),
    otherwise: z.enum(END_IDS).optional(),
    grants: ids,
    dialogue: z.array(Line).min(2).max(4),
  })
  .strict();
const Choice = z
  .object({
    stat: z.enum(STATS),
    goal: z.string().min(4).max(50),
    risk: z.string().min(4).max(180),
    success: Outcome,
    partial: Outcome,
    failure: Outcome,
  })
  .strict();
export const ManuscriptSchema = z
  .object({
    format: z.literal("vn-book-1"),
    title: z.string().min(2).max(40),
    logline: z.string().min(10).max(160),
    bible: z
      .object({
        truth: z.string().min(15).max(700),
        rules: z.array(z.string().min(5).max(180)).min(2).max(6),
        cast: z
          .array(
            z
              .object({
                id: z.enum(speakers),
                name: z.string().min(1).max(16),
                identity: z.string().min(3).max(100),
                voice: z.string().min(3).max(100),
              })
              .strict(),
          )
          .min(3)
          .max(6),
      })
      .strict(),
    facts: z
      .array(
        z.object({ id: factID, text: z.string().min(4).max(100) }).strict(),
      )
      .min(2)
      .max(6),
    nodes: z
      .array(
        z
          .object({
            id: nodeID,
            title: z.string().min(2).max(40),
            time: z.number().int().min(0).max(100),
            when: z.string().min(2).max(50),
            location: z.string().min(2).max(70),
            present: z.array(z.enum(speakers)).min(2).max(6),
            requires: ids,
            reveals: ids,
            dialogue: z.array(Line).min(8).max(14),
            choices: z.array(Choice).length(4),
          })
          .strict(),
      )
      .min(5)
      .max(8),
    endings: z
      .array(
        z
          .object({
            id: z.enum(END_IDS),
            title: z.string().min(2).max(40),
            time: z.number().int().min(0).max(100),
            when: z.string().min(2).max(50),
            location: z.string().min(2).max(70),
            present: z.array(z.enum(speakers)).min(2).max(6),
            requires: ids,
            dialogue: z.array(Line).min(10).max(18),
          })
          .strict(),
      )
      .length(6),
  })
  .strict();
export type Manuscript = z.infer<typeof ManuscriptSchema>;
export type Issue = {
  code: string;
  path: string;
  message: string;
  witness?: string[];
};
export const REVIEW_KEYS = [
  "world_consistency",
  "branch_continuity",
  "character_knowledge",
  "dialogue_flow",
  "meaningful_choices",
  "ending_payoff",
] as const;
export const ReviewSchema = z
  .object({
    verdict: z.enum(["pass", "revise"]),
    checks: z
      .array(
        z
          .object({
            key: z.enum(REVIEW_KEYS),
            score: z.number().int().min(1).max(5),
            evidence: z.string().min(5).max(500),
          })
          .strict(),
      )
      .length(6),
    issues: z
      .array(
        z
          .object({
            code: z.string().min(2).max(60),
            path: z.string().startsWith("/").max(200),
            message: z.string().min(8).max(500),
            fix: z.string().min(8).max(500),
          })
          .strict(),
      )
      .max(16),
  })
  .strict()
  .superRefine((r, c) => {
    if (r.verdict === "revise" && !r.issues.length)
      c.addIssue({
        code: "custom",
        message: "revise requires at least one actionable issue",
      });
    if (new Set(r.checks.map((x) => x.key)).size !== 6)
      c.addIssue({
        code: "custom",
        message: "all six review dimensions required",
      });
    if (
      r.verdict === "pass" &&
      (r.issues.length || r.checks.some((x) => x.score < 4))
    )
      c.addIssue({
        code: "custom",
        message: "pass requires all >=4 and no issues",
      });
  });
export type Review = z.infer<typeof ReviewSchema>;
