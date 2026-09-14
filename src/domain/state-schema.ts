import { z } from "zod";
import { CharacterSchema, type State, type Scenario } from "./types";
const bounded = z.number().int().min(0).max(10);
const stateSchema = z
  .object({
    rulesVersion: z.string(),
    scenarioVersion: z.string(),
    assetCatalogVersion: z.string(),
    character: CharacterSchema,
    stage: z.number().int().min(1).max(12),
    remaining: z.number().int().min(0).max(10),
    turn: z.number().int().min(0).max(64),
    version: z.number().int().min(0).max(65),
    status: z.enum(["playing", "ended", "abandoned"]),
    hp: bounded,
    supplies: z.number().int().min(0).max(5),
    prepared: z.boolean(),
    flags: z.record(z.string(), z.boolean()),
    counters: z.record(z.string(), z.number().int().min(-10).max(64)),
    items: z.record(z.string(), bounded),
    facts: z.array(z.string()).max(100),
    attempts: z.record(z.string(), z.number().int().min(0).max(8)),
    ending: z.string().max(80).nullable(),
    castSnapshot: z
      .array(
        z
          .object({
            roleId: z.string(),
            actorId: z.string(),
            lookId: z.string(),
            accessoryId: z.string().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(7),
  })
  .strict();
export function parseState(raw: unknown, s: Scenario): State {
  const st = stateSchema.parse(raw);
  if (
    st.stage > s.stages.length ||
    st.turn > (s.book ? s.stages.length * 3 : 32) ||
    (st.ending !== null && !s.endings.some((e) => e.id === st.ending)) ||
    Object.keys(st.flags).some((id) => !s.flags.includes(id)) ||
    Object.entries(st.counters).some(
      ([id, value]) =>
        !s.counters[id] ||
        value < s.counters[id].min ||
        value > s.counters[id].max,
    ) ||
    Object.keys(st.items).some((id) => !s.items[id]) ||
    st.facts.some((id) => !s.facts[id]) ||
    Object.entries(st.attempts).some(
      ([id, count]) =>
        !s.actions.some((a) => a.id === id && count <= a.maxAttempts),
    ) ||
    JSON.stringify(st.castSnapshot) !== JSON.stringify(s.cast) ||
    st.counters.step > 4 ||
    (st.status === "playing" &&
      (st.hp === 0 || st.ending !== null || st.remaining === 0)) ||
    (st.status === "ended" && st.ending === null)
  )
    throw Error("invalid persisted state");
  return st;
}
