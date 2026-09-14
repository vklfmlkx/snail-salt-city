import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ManuscriptSchema,
  END_IDS,
  STATS,
  Line,
  type Manuscript,
  type Issue,
} from "./schema";
export function manuscriptHash(m: unknown) {
  return createHash("sha256").update(JSON.stringify(m)).digest("hex");
}
export function validateManuscript(raw: unknown) {
  return inspect(raw, ManuscriptSchema);
}
const diagnosticSchema = ManuscriptSchema.extend({
  nodes: z
    .array(
      ManuscriptSchema.shape.nodes.element.extend({
        dialogue: z.array(Line).max(100),
      }),
    )
    .min(5)
    .max(8),
  endings: z
    .array(
      ManuscriptSchema.shape.endings.element.extend({
        dialogue: z.array(Line).max(100),
      }),
    )
    .length(6),
});
export function collectRepairIssues(raw: unknown) {
  const strict = validateManuscript(raw);
  if (strict.ok) return strict.issues;
  const diagnostic = inspect(raw, diagnosticSchema);
  return [
    ...strict.issues,
    ...diagnostic.issues.filter((i) => i.code !== "schema"),
  ].slice(0, 48);
}
function inspect(
  raw: unknown,
  schema: Pick<typeof ManuscriptSchema, "safeParse">,
) {
  const parsed = schema.safeParse(raw);
  const issues: Issue[] = [];
  if (!parsed.success)
    return {
      ok: false as const,
      issues: parsed.error.issues.slice(0, 30).map((e) => ({
        code: "schema",
        path: "/" + e.path.join("/"),
        message: e.message,
      })),
      coverage: null,
      manuscript: null,
    };
  const m = parsed.data;
  const add = (
    code: string,
    path: string,
    message: string,
    witness?: string[],
  ) => issues.push({ code, path, message, ...(witness ? { witness } : {}) });
  const cast = new Set<string>(m.bible.cast.map((c) => c.id)),
    facts = new Set(m.facts.map((f) => f.id)),
    nodes = new Map(m.nodes.map((n) => [n.id, n])),
    ends = new Map(m.endings.map((e) => [e.id, e]));
  if (
    cast.size !== m.bible.cast.length ||
    !cast.has("gm") ||
    !cast.has("player")
  )
    add(
      "cast",
      "/bible/cast",
      "unique GM and player plus recurring roles required",
    );
  if (facts.size !== m.facts.length)
    add("facts", "/facts", "duplicate fact IDs");
  if (ends.size !== 6 || END_IDS.some((id) => !ends.has(id)))
    add("endings", "/endings", "exactly 2 good, 3 bad and 1 true endings");
  const checkFacts = (list: string[], path: string) => {
    if (new Set(list).size !== list.length || list.some((f) => !facts.has(f)))
      add("fact_reference", path, "facts must be unique declared IDs");
  };
  const checkLines = (
    lines: Manuscript["nodes"][number]["dialogue"],
    present: string[],
    path: string,
  ) => {
    if (
      !present.includes("gm") ||
      !present.includes("player") ||
      new Set(present).size !== present.length ||
      present.some((id) => !cast.has(id))
    )
      add("present", path, "only declared cast; GM and player required");
    lines.forEach((l, i) => {
      if (!present.includes(l[0]))
        add("absent_speaker", `${path}/${i}`, "speaker absent from this scene");
      if (
        /(?:additionalProperties|next_stage|schema|需要行动：|player低头)/i.test(
          l[2],
        )
      )
        add(
          "instruction_leak",
          `${path}/${i}`,
          "authoring/implementation text leaked into dialogue",
        );
    });
    if (
      lines.filter((l) => l[0] === "gm").length > Math.ceil(lines.length * 0.45)
    )
      add(
        "too_much_narration",
        path,
        `GM lines=${lines.filter((l) => l[0] === "gm").length}, allowed maximum=${Math.ceil(lines.length * 0.45)}; replace narration with meaningful direct dialogue, target only 2 GM lines per opening/ending`,
      );
    if (new Set(lines.map((l) => l[2])).size < lines.length * 0.8)
      add("repeated_lines", path, "too many duplicated dialogue lines");
  };
  let splitNodes = 0;
  m.nodes.forEach((n, i) => {
    const p = `/nodes/${i}`;
    if (n.id !== `n${i + 1}`)
      add("node_order", p, "node IDs must be consecutive n1..nK");
    checkFacts(n.requires, p + "/requires");
    checkFacts(n.reveals, p + "/reveals");
    checkLines(n.dialogue, n.present, p + "/dialogue");
    if (
      new Set(n.choices.map((c) => c.stat)).size !== 4 ||
      STATS.some((a) => !n.choices.some((c) => c.stat === a))
    )
      add(
        "attributes",
        p + "/choices",
        "exactly one direction for each of four stats",
      );
    const next = new Set<string>();
    n.choices.forEach((c, j) => {
      for (const result of ["success", "partial", "failure"] as const) {
        const o = c[result],
          q = `${p}/choices/${j}/${result}`;
        checkFacts(o.grants, q + "/grants");
        checkFacts(o.whenAll ?? [], q + "/whenAll");
        if (o.to.startsWith("n")) {
          next.add(o.to);
          if (!nodes.has(o.to) || Number(o.to.slice(1)) <= i + 1)
            add("cycle_or_missing", q, "next node must exist and be forward");
          if (o.whenAll?.length || o.otherwise)
            add(
              "conditional_node",
              q,
              "conditional destinations allowed only for endings",
            );
        } else if (!ends.has(o.to as never))
          add("unknown_end", q, "unknown ending");
        if (o.whenAll?.length && !o.otherwise)
          add("missing_fallback", q, "conditional ending needs otherwise");
        if (o.otherwise && !o.whenAll?.length)
          add("unused_fallback", q, "otherwise requires nonempty whenAll");
        checkLines(o.dialogue, n.present, q + "/dialogue");
      }
    });
    if (next.size >= 2) splitNodes++;
  });
  if (!splitNodes)
    add(
      "linear_graph",
      "/nodes",
      "at least one real split to different next story nodes, not only different rolls",
    );
  m.endings.forEach((e, i) => {
    checkFacts(e.requires, `/endings/${i}/requires`);
    checkLines(e.dialogue, e.present, `/endings/${i}/dialogue`);
  });
  if (issues.length)
    return { ok: false as const, issues, manuscript: m, coverage: null };
  const commonKnowledge = new Map<string, Set<string>>();
  const seen = new Set<string>(),
    reachedNodes = new Set<string>(),
    terminal = new Map<
      string,
      { min: number; max: number; witness: string[] }
    >();
  function visit(
    id: string,
    known: Set<string>,
    time: number,
    trail: string[],
  ) {
    const e = ends.get(id as never);
    if (e) {
      const missing = e.requires.filter((f) => !known.has(f));
      if (missing.length)
        add(
          "ending_missing_facts",
          `/endings/${m.endings.indexOf(e)}`,
          `unknown facts ${missing.join(",")}`,
          trail,
        );
      if (e.time < time)
        add(
          "time_reversal",
          `/endings/${m.endings.indexOf(e)}`,
          "ending goes backwards in time",
          trail,
        );
      const previous = terminal.get(id);
      terminal.set(id, {
        min: Math.min(previous?.min ?? Infinity, trail.length),
        max: Math.max(previous?.max ?? 0, trail.length),
        witness: previous?.witness ?? trail,
      });
      return;
    }
    const n = nodes.get(id)!;
    if (!n) return;
    if (n.time < time)
      add(
        "time_reversal",
        `/nodes/${m.nodes.indexOf(n)}`,
        "incoming route goes backwards in time",
        trail,
      );
    const missing = n.requires.filter((f) => !known.has(f));
    if (missing.length)
      add(
        "merge_missing_facts",
        `/nodes/${m.nodes.indexOf(n)}`,
        `not every incoming route establishes ${missing.join(",")}`,
        trail,
      );
    const available = new Set([...known, ...n.reveals]);
    const previousKnown = commonKnowledge.get(id);
    commonKnowledge.set(
      id,
      previousKnown
        ? new Set([...previousKnown].filter((f) => available.has(f)))
        : new Set(available),
    );
    const key = JSON.stringify([id, [...available].sort(), trail.length]);
    if (seen.has(key)) return;
    seen.add(key);
    reachedNodes.add(id);
    for (const c of n.choices)
      for (const outcome of ["success", "partial", "failure"] as const) {
        const o = c[outcome],
          after = new Set([...available, ...o.grants]);
        const target = o.whenAll?.some((f) => !after.has(f))
          ? o.otherwise!
          : o.to;
        visit(target, after, n.time, [...trail, `${id}.${c.stat}.${outcome}`]);
      }
  }
  visit("n1", new Set(), 0, []);
  for (const n of m.nodes)
    if (!reachedNodes.has(n.id))
      add(
        "unreachable_node",
        `/nodes/${m.nodes.indexOf(n)}`,
        "node is unreachable",
      );
  for (const id of END_IDS)
    if (!terminal.has(id))
      add("unreachable_ending", "/endings", `ending ${id} is unreachable`);
  if ((terminal.get("true")?.min ?? 0) < 4)
    add(
      "short_true_route",
      "/endings",
      "true ending needs at least 4 meaningful choices",
    );
  if (![...terminal].some(([id, e]) => id.startsWith("bad_") && e.min <= 2))
    add(
      "no_early_ending",
      "/endings",
      "include an explicitly warned early bad ending within 2 choices",
    );
  return {
    ok: issues.length === 0,
    issues: issues.slice(0, 40),
    manuscript: m,
    coverage: {
      states: seen.size,
      nodes: reachedNodes.size,
      splitNodes,
      nodeIndex: m.nodes.map((n, i) => ({
        id: n.id,
        path: `/nodes/${i}`,
        title: n.title,
        location: n.location,
        alwaysKnownAfterOpening: [...(commonKnowledge.get(n.id) ?? [])],
        reveals: n.reveals,
        outcomes: n.choices.map((c) => ({
          stat: c.stat,
          ...Object.fromEntries(
            ["success", "partial", "failure"].map((o) => {
              const { dialogue, ...route } = c[o as "success"];
              return [o, route];
            }),
          ),
        })),
      })),
      endingIndex: m.endings.map((e, i) => ({
        id: e.id,
        path: `/endings/${i}`,
        title: e.title,
        location: e.location,
        requires: e.requires,
      })),
      endings: [...terminal].map(([id, r]) => ({ id, ...r })),
    },
  };
}
