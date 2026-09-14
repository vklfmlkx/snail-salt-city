import { compileGenerated } from "./compile";
import { validateManuscript } from "./validate";
import { initialState, resolveTurn } from "../../engine/rules";
import { parseState } from "../../domain/state-schema";
import type { Manuscript } from "./schema";

/** Replay one proved route per ending through the production rules and save schema. */
export function provePlayable(book: Manuscript) {
  const validation = validateManuscript(book);
  if (!validation.ok) throw Error("playability_invalid_manuscript");
  const scenario = compileGenerated(book);
  const routes = validation.coverage!.endings.map((end) => {
    let state = initialState(
      {
        name: "路线验收",
        background: "自动回放",
        stats: { body: 5, agility: 5, mind: 5, presence: 5 },
      },
      scenario,
    );
    for (const step of end.witness) {
      const [node, stat, outcome] = step.split(".");
      if (state.stage !== Number(node.slice(1)) || state.status !== "playing")
        throw Error("engine_route_mismatch");
      const result = resolveTurn(
        state,
        scenario,
        `book.s${node.slice(1)}.key.${stat}`,
        outcome === "success" ? 10 : outcome === "partial" ? 5 : 1,
      );
      state = parseState(JSON.parse(JSON.stringify(result.state)), scenario);
    }
    if (state.ending !== end.id || state.status !== "ended")
      throw Error("engine_ending_mismatch");
    return { ending: end.id, steps: end.witness.length };
  });
  return { scenario, routes };
}
