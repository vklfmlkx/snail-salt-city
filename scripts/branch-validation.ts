import assert from "node:assert/strict";
import { initialState, resolveTurn } from "../src/engine/rules";
import type { Scenario, State } from "../src/domain/types";
import { scriptOptions } from "../src/engine/script-rules";
import { isFixedScriptAction } from "../src/domain/script-action";
export function validateBranches(s: Scenario) {
  const visited = new Set<string>(),
    endings = new Map<string, { min: number; max: number; path: string[] }>();
  function visit(state: State, path: string[]) {
    if (state.status === "ended") {
      const previous = endings.get(state.ending!);
      endings.set(state.ending!, {
        min: Math.min(previous?.min ?? Infinity, state.turn),
        max: Math.max(previous?.max ?? 0, state.turn),
        path: previous?.path ?? path,
      });
      return;
    }
    const key = JSON.stringify([state.stage, state.flags, state.turn]);
    if (visited.has(key)) return;
    visited.add(key);
    assert.ok(
      state.turn < 8,
      "forward-only graph must terminate within 8 actions",
    );
    for (const option of scriptOptions(state, s).filter((a) =>
      isFixedScriptAction(a.id),
    )) {
      for (const die of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const action = option.id;
        const result = resolveTurn(state, s, action, die);
        assert.ok(
          result.state.status === "ended" || result.state.stage > state.stage,
        );
        assert.ok(
          result.result.scriptDialogue!.length >= (s.book?.edition ? 1 : 12),
        );
        visit(result.state, [...path, `${action}:${die}`]);
      }
    }
  }
  visit(
    initialState(
      {
        name: "青梅",
        background: "分支验收",
        stats: { body: 5, agility: 5, mind: 5, presence: 5 },
        difficulty: "normal",
      },
      s,
    ),
    [],
  );
  assert.deepEqual(
    [...endings.keys()].sort(),
    s.book!.endings.map((e) => e.id).sort(),
  );
  return {
    states: visited.size,
    routes: [...endings].map(([ending, r]) => ({ ending, ...r })),
    modelRequests: 0,
  };
}
