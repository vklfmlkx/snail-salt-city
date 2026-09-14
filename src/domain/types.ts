import { z } from "zod";
import {
  LocalPlanSchema,
  type ScriptBook,
  type ScriptLine,
} from "../content/script-book";
export const attributes = ["body", "agility", "mind", "presence"] as const;
export type Attribute = (typeof attributes)[number];
export const attributeLabels: Record<Attribute, string> = {
  body: "体魄",
  agility: "身手",
  mind: "头脑",
  presence: "气场",
};
export const StatsSchema = z
  .object({
    body: z.number().int().min(2).max(8),
    agility: z.number().int().min(2).max(8),
    mind: z.number().int().min(2).max(8),
    presence: z.number().int().min(2).max(8),
  })
  .strict()
  .refine(
    (s) => Object.values(s).reduce((a, b) => a + b, 0) === 20,
    "四项合计必须为20",
  );
export const CharacterSchema = z
  .object({
    name: z.string().trim().min(1).max(24),
    background: z.string().trim().max(160),
    stats: StatsSchema,
    avatar: z.enum(["hero_f", "hero_m"]).optional(),
    difficulty: z.enum(["story", "normal", "hard"]).optional(),
  })
  .strict();
export type Character = z.infer<typeof CharacterSchema>;
export type Outcome = "success" | "partial" | "failure";
export type Ending = string;
export type Condition =
  | { kind: "always" }
  | { kind: "all" | "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition }
  | {
      kind: "compare";
      field: string;
      op: "eq" | "ne" | "gte" | "lte";
      value: number | boolean;
    }
  | { kind: "has_item"; itemId: string; quantity: number };
export type Effect =
  | { kind: "resource_delta"; resource: "hp" | "supplies"; value: number }
  | { kind: "counter_delta"; id: string; value: number }
  | { kind: "flag_set"; id: string; value: boolean }
  | { kind: "grant_item" | "remove_item"; id: string; quantity: number }
  | { kind: "reveal_fact"; id: string }
  | { kind: "set_prepared"; value: boolean };
export interface Action {
  stageCost?: 0 | 1;
  id: string;
  stage: number;
  step: number | null;
  label: string;
  intent: string;
  target: string;
  keywords: string[];
  attribute: Attribute | null;
  difficulty: number | null;
  condition: Condition;
  cost: { hp?: number; supplies?: number; items?: Record<string, number> };
  effects: Record<Outcome, Effect[]>;
  text: Record<Outcome, string>;
  risk: string;
  maxAttempts: number;
  core: boolean;
}
export interface Stage {
  id: string;
  title: string;
  scene: string;
  roles: string[];
  budget: number;
  intro: string;
  timeoutText: string;
  timeout: Effect[];
}
export interface Cast {
  roleId: string;
  actorId: string;
  lookId: string;
  accessoryId: string | null;
}
export interface State {
  rulesVersion: string;
  scenarioVersion: string;
  assetCatalogVersion: string;
  character: Character;
  stage: number;
  remaining: number;
  turn: number;
  version: number;
  status: "playing" | "ended" | "abandoned";
  hp: number;
  supplies: number;
  prepared: boolean;
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  items: Record<string, number>;
  facts: string[];
  attempts: Record<string, number>;
  ending: Ending | null;
  castSnapshot: Cast[];
}
export interface Scenario {
  book?: ScriptBook;
  drama?: {
    title: string;
    roleNames: Record<string, string>;
    voices: Record<string, string>;
  };
  version: string;
  rulesVersion: string;
  assetVersion: string;
  stages: Stage[];
  actions: Action[];
  facts: Record<string, string>;
  items: Record<string, string>;
  flags: string[];
  counters: Record<string, { min: number; max: number }>;
  endings: {
    id: Ending;
    priority: number;
    condition: Condition;
    title: string;
    text: string;
  }[];
  cast: Cast[];
}
export type Event =
  | { type: "attribute"; attribute: Attribute; before: number; after: number }
  | {
      type: "resource";
      resource: "hp" | "supplies";
      before: number;
      after: number;
    }
  | { type: "fact"; id: string; text: string }
  | { type: "item"; id: string; label: string; quantity: number }
  | { type: "prepared"; value: boolean }
  | { type: "stage"; from: number; to: number; timeout: boolean }
  | { type: "ending"; id: Ending }
  | { type: "action"; id: string; outcome: Outcome };
export interface PublicAction {
  requirement?: "low" | "medium" | "high";
  stageCost?: 0 | 1;
  id: string;
  label: string;
  intent: string;
  target: string;
  keywords: string[];
  attribute: Attribute | null;
  difficulty: number | null;
  cost: Action["cost"];
  risk: string;
  modifier: number;
}
export interface RenderState {
  version: number;
  scene: string;
  sceneLabel: string;
  props: string[];
  characters: (Cast & { expressionId: string; name: string })[];
  snail: "snail.neutral" | "snail.approaching";
}
export interface PublicState {
  script?: {
    title?: string;
    edition?: "curated-v1" | "flex-v1";
    endingCount?: number;
    activity?: NonNullable<ScriptBook["stages"][number]["activity"]> & {
      status: number;
      rewardAvailable: boolean;
    };
    branching?: boolean;
    roleNames?: Partial<Record<string, string>>;
    milestones?: { id: string; label: string }[];
    stageCount: number;
    opening: ScriptLine[];
    initialDialogue: ScriptLine[];
    sideRemaining: number;
    effectiveStats: Record<Attribute, number>;
    difficulty: "story" | "normal" | "hard";
  };
  progress?: { community: number; readiness: number };
  scenarioVersion?: string;
  id: string;
  version: number;
  turn: number;
  status: State["status"];
  character: Character;
  stage: {
    id: string;
    number: number;
    title: string;
    intro: string;
    budget: number;
  };
  remaining: number;
  hp: number;
  supplies: number;
  prepared: boolean;
  injured: boolean;
  items: { id: string; label: string; quantity: number }[];
  facts: { id: string; text: string }[];
  actions: PublicAction[];
  ending: { id: Ending; title: string; text: string; label?: string } | null;
  render: RenderState;
}
export interface PublicResult {
  scriptDialogue?: ScriptLine[];
  dialogueRoles?: { roleId: string; name: string; actorId: string }[];
  turnNumber: number;
  beforeVersion: number;
  afterVersion: number;
  actionLabel: string;
  die: number | null;
  attribute: Attribute | null;
  attributeValue: number | null;
  difficulty: number | null;
  modifier: number;
  margin: number | null;
  outcome: Outcome;
  events: Event[];
  fallback: string;
  beforeScene: string;
  afterScene: string;
  render: RenderState;
}
export const InterpreterSchema = z
  .object({
    kind: z.enum(["act", "view", "clarify", "unsupported"]),
    actionOptionId: z.string().max(120).nullable(),
    intent: z.string().max(160),
    inputSpan: z.string().max(500).nullable(),
    message: z.string().max(300).nullable(),
    localPlan: LocalPlanSchema.optional(),
  })
  .strict();
export type Interpretation = z.infer<typeof InterpreterSchema>;
export const NarratorSchema = z
  .object({
    reaction: z.string().max(120),
    description: z.string().max(600),
    dialogue: z
      .array(
        z
          .object({
            roleId: z.string().max(80),
            text: z.string().max(200),
            expressionId: z.string().max(120).nullable(),
          })
          .strict(),
      )
      .max(10),
    usedFactIds: z.array(z.string().max(120)).max(16),
  })
  .strict();
export type Narration = z.infer<typeof NarratorSchema>;
export interface PublicTurn {
  id: string;
  result: PublicResult;
  narrationStatus: "pending" | "running" | "ready" | "fallback";
  narration: Narration | null;
  errorCode: string | null;
}
export class GameError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
