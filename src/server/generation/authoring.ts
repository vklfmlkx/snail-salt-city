import { z } from "zod";
import { ManuscriptSchema, Line } from "./schema";
import { referenceTopology } from "./topology";
const scene = ManuscriptSchema.shape.nodes.element;
const choice = scene.shape.choices.element;
const branch = z.object({ dialogue: z.array(Line).min(2).max(4) }).strict();
export const ContentDraftSchema = ManuscriptSchema.extend({
  format: z.literal("vn-content-1"),
  facts: ManuscriptSchema.shape.facts.length(2),
  nodes: z
    .array(
      scene.omit({ present: true, requires: true, reveals: true }).extend({
        choices: z
          .array(
            choice.extend({
              success: branch,
              partial: branch,
              failure: branch,
            }),
          )
          .length(4),
      }),
    )
    .length(6),
  endings: z
    .array(
      ManuscriptSchema.shape.endings.element.omit({
        present: true,
        requires: true,
      }),
    )
    .length(6),
});
const metadata = scene.pick({
  title: true,
  time: true,
  when: true,
  location: true,
});
export const FlatDraftSchema = z
  .object({
    format: z.literal("vn-flat-1"),
    title: ManuscriptSchema.shape.title,
    logline: ManuscriptSchema.shape.logline,
    bible: ManuscriptSchema.shape.bible,
    facts: ManuscriptSchema.shape.facts.length(2),
    nodes: z.record(z.string(), metadata),
    endings: z.record(z.string(), metadata),
    choices: z.record(z.string(), choice.pick({ goal: true, risk: true })),
    segments: z.record(z.string(), z.array(Line).min(2).max(18)),
  })
  .strict();
export function requiredSegments() {
  return [
    ...referenceTopology().nodes.flatMap((n) => [
      `${n.id}.open`,
      ...n.choices.flatMap((c) =>
        ["success", "partial", "failure"].map((o) => `${n.id}.${c.stat}.${o}`),
      ),
    ]),
    ...referenceTopology().endings.map((e) => `end.${e.id}`),
  ];
}
export function assembleFlatDraft(raw: unknown): unknown {
  const b = z
    .object({
      format: z.literal("vn-flat-1"),
      nodes: z.record(z.string(), z.unknown()),
      endings: z.record(z.string(), z.unknown()),
      choices: z.record(z.string(), z.unknown()),
      segments: z.record(z.string(), z.unknown()),
    })
    .passthrough()
    .parse(raw);
  const topology = referenceTopology(),
    { segments, choices, ...base } = b;
  const result = {
    ...base,
    format: "vn-book-1",
    nodes: topology.nodes.map((n) => ({
      ...(b.nodes[n.id] as object),
      id: n.id,
      requires: n.requires,
      reveals: n.reveals,
      dialogue: segments[n.id + ".open"] ?? [],
      choices: n.choices.map((c) => ({
        ...(choices[`${n.id}.${c.stat}`] as object),
        stat: c.stat,
        ...Object.fromEntries(
          ["success", "partial", "failure"].map((o) => [
            o,
            {
              ...((c as Record<string, unknown>)[o] as object),
              dialogue: segments[`${n.id}.${c.stat}.${o}`] ?? [],
            },
          ]),
        ),
      })),
    })),
    endings: topology.endings.map((e) => ({
      ...(b.endings[e.id] as object),
      ...e,
      dialogue: segments[`end.${e.id}`] ?? [],
    })),
  };
  return refreshParticipants(result);
}
function participants(lines: unknown[]) {
  return [
    ...new Set([
      "gm",
      "player",
      ...lines.filter(Array.isArray).map((l) => l[0]),
    ]),
  ];
}
export function refreshParticipants(raw: unknown) {
  const b = structuredClone(raw) as Record<string, unknown>;
  if (!b || !Array.isArray(b.nodes) || !Array.isArray(b.endings)) return raw;
  for (const n of b.nodes) {
    if (!n || !Array.isArray(n.dialogue) || !Array.isArray(n.choices)) continue;
    n.present = participants([
      ...n.dialogue,
      ...n.choices.flatMap((c: Record<string, unknown>) =>
        ["success", "partial", "failure"].flatMap((o) => {
          const branch = c[o] as { dialogue?: unknown[] } | undefined;
          return branch?.dialogue ?? [];
        }),
      ),
    ]);
  }
  for (const e of b.endings)
    if (e && Array.isArray(e.dialogue)) e.present = participants(e.dialogue);
  return b;
}
/** The model authors all prose; trusted routing is assembled, never improvised. */
export function assembleContentDraft(raw: unknown): unknown {
  const base = z
    .object({
      format: z.literal("vn-content-1"),
      nodes: z.array(z.record(z.string(), z.unknown())).length(6),
      endings: z.array(z.record(z.string(), z.unknown())).length(6),
    })
    .passthrough()
    .parse(raw);
  const topology = referenceTopology();
  const result = {
    ...base,
    format: "vn-book-1",
    nodes: base.nodes.map((node, i) => {
      const route = topology.nodes[i];
      if (node.id !== route.id || !Array.isArray(node.choices))
        throw Error("authoring_node_order");
      return {
        ...node,
        requires: route.requires,
        reveals: route.reveals,
        choices: node.choices.map((c: Record<string, unknown>) => {
          const fixed = route.choices.find((r) => r.stat === c.stat) as
            | Record<string, unknown>
            | undefined;
          if (!fixed) throw Error("authoring_attribute");
          return {
            ...c,
            ...Object.fromEntries(
              ["success", "partial", "failure"].map((o) => [
                o,
                { ...(c[o] as object), ...(fixed[o] as object) },
              ]),
            ),
          };
        }),
      };
    }),
    endings: base.endings.map((e) => ({
      ...e,
      requires: topology.endings.find((x) => x.id === e.id)?.requires ?? [],
    })),
  };
  return refreshParticipants(result);
}
export function assertTrustedTopology(raw: unknown) {
  const b = ManuscriptSchema.parse(raw),
    topology = referenceTopology();
  if (
    b.facts.length !== 2 ||
    !b.facts.some((f) => f.id === "f1") ||
    !b.facts.some((f) => f.id === "f2") ||
    b.nodes.length !== 6
  )
    throw Error("trusted_topology_changed");
  for (const [i, n] of b.nodes.entries()) {
    const expected = topology.nodes[i];
    if (
      JSON.stringify(n.requires) !== JSON.stringify(expected.requires) ||
      JSON.stringify(n.reveals) !== JSON.stringify(expected.reveals)
    )
      throw Error("trusted_topology_changed");
    for (const c of n.choices)
      for (const o of ["success", "partial", "failure"] as const) {
        const { dialogue, ...actual } = c[o];
        const fixed = expected.choices.find((x) => x.stat === c.stat) as Record<
          string,
          unknown
        >;
        if (JSON.stringify(actual) !== JSON.stringify(fixed[o])) {
          // Property order is irrelevant; compare the controlled fields individually.
          const target = fixed[o] as Record<string, unknown>;
          if (
            ["to", "whenAll", "otherwise", "grants"].some(
              (k) =>
                JSON.stringify((actual as Record<string, unknown>)[k]) !==
                JSON.stringify(target[k]),
            )
          )
            throw Error("trusted_topology_changed");
        }
      }
  }
  for (const e of b.endings)
    if (
      JSON.stringify(e.requires) !==
      JSON.stringify(topology.endings.find((x) => x.id === e.id)!.requires)
    )
      throw Error("trusted_topology_changed");
}
