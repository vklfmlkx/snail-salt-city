import { ScriptBookSchema, type ScriptLine } from "../../content/script-book";
import { compileBook } from "../../engine/script-rules";
import { validateManuscript, manuscriptHash } from "./validate";
import type { Manuscript } from "./schema";
export function compileGenerated(m: Manuscript) {
  const valid = validateManuscript(m);
  if (!valid.ok) throw Error("cannot_compile_unvalidated_manuscript");
  const lines = (d: Manuscript["nodes"][number]["dialogue"]): ScriptLine[] =>
    d.map(([speaker, expression, text]) => ({ speaker, expression, text }));
  const book = ScriptBookSchema.parse({
    version: `generated-${manuscriptHash(m).slice(0, 24)}`,
    structure: "branching",
    title: m.title,
    graphFlags: m.facts.map((f) => f.id),
    flagLabels: Object.fromEntries(m.facts.map((f) => [f.id, f.text])),
    initialFlags: m.nodes[0].reveals,
    roleNames: Object.fromEntries(m.bible.cast.map((c) => [c.id, c.name])),
    stages: m.nodes.map((n) => ({
      title: n.title,
      location: n.location,
      roles: n.present,
      anchor: n.choices
        .map((c) => c.goal)
        .join("；")
        .slice(0, 180),
      knownFacts: [...new Set([...n.requires, ...n.reveals])]
        .map((id) => m.facts.find((f) => f.id === id)!.text)
        .concat([`时间：${n.when}`, `地点：${n.location}`])
        .slice(0, 12),
      landing: "按实际选择播放预写分支",
      sideLimit: 0,
      opening: lines(n.dialogue),
      transition: [],
      choices: n.choices.map((c) => ({
        attribute: c.stat,
        label: c.goal,
        conditions: [c.goal],
        risk: c.risk,
        branches: Object.fromEntries(
          ["success", "partial", "failure"].map((o) => [
            o,
            lines(c[o as "success"].dialogue),
          ]),
        ),
        routes: Object.fromEntries(
          ["success", "partial", "failure"].map((outcome) => {
            const o = c[outcome as "success"],
              next = m.nodes.find((n) => n.id === o.to);
            return [
              outcome,
              {
                ...(next
                  ? { stage: Number(next.id.slice(1)) }
                  : { ending: o.to }),
                ...(o.whenAll?.length
                  ? { requires: o.whenAll, otherwise: o.otherwise }
                  : {}),
                grants: [...new Set([...o.grants, ...(next?.reveals ?? [])])],
                bridge: [],
              },
            ];
          }),
        ),
      })),
    })),
    endings: m.endings.map((e) => ({
      id: e.id,
      category: e.id.startsWith("good")
        ? "good"
        : e.id.startsWith("bad")
          ? "bad"
          : "true",
      title: e.title,
      dialogue: lines(e.dialogue),
    })),
  });
  return compileBook(book);
}
