import { scenario } from "../src/content/legacy/snail-scenario";
import {
  compileActionOptions,
  initialState,
  resolveTurn,
} from "../src/engine/rules";
import type { Ending, State } from "../src/domain/types";
export const character = {
  name: "测试访客",
  background: "只用于离线验收",
  stats: { body: 5, agility: 5, mind: 5, presence: 5 },
};
export function routeAction(st: State, ending: Ending) {
  const n = st.counters.step + 1;
  const choices: Record<string, string> = {
    "1.1": "notice",
    "1.2": "observe",
    "1.3": "barrier",
    "1.4": "counter",
    "2.1": "ask",
    "2.2": "persuade",
    "2.3": "avoid",
    "2.4": "leave",
    "3.1": "inventory",
    "3.2": ending === "temporary_containment" ? "box" : "car",
    "3.3": "test",
    "3.4": "secure",
    "4.1": "records",
    "4.2": "compare",
    "4.3": "cooperate",
    "4.4": "dock",
    "5.1": "position",
    "5.2":
      ending === "contract_released"
        ? "release"
        : ending === "temporary_containment"
          ? "container"
          : "vehicle",
    "5.3": "detour",
    "5.4": "confirm",
    "6.1": "measure",
    "6.2": ending === "contract_released" ? "waive" : "start",
    "6.3": "stabilize",
    "6.4":
      ending === "contract_released"
        ? "release"
        : ending === "temporary_containment"
          ? "seal"
          : "drive",
  };
  return `s${st.stage}.${n}.${choices[`${st.stage}.${n}`]}`;
}
export function walk(ending: Ending, explore = false, die = 10) {
  let state = initialState(character, scenario);
  const trace: {
    actionOptionId: string;
    stage: number;
    die: number | null;
    outcome: string;
    events: unknown[];
    hp: number;
    supplies: number;
    facts: string[];
    endingId: Ending | null;
    text: string;
  }[] = [];
  let rendered = scenario.stages[0].intro;
  while (state.status === "playing" && trace.length < 33) {
    let id = routeAction(state, ending);
    if (ending === "caught") id = `s${state.stage}.opt.touch`;
    else if (
      ending === "contract_released" &&
      state.stage === 2 &&
      !state.attempts["s2.opt.clause"]
    )
      id = "s2.opt.clause";
    else if (
      ending === "contract_released" &&
      state.stage === 4 &&
      !state.attempts["s4.opt.signature"]
    )
      id = "s4.opt.signature";
    else if (
      explore &&
      [1, 3].includes(state.stage) &&
      !state.attempts[`s${state.stage}.opt.prepare`]
    )
      id = `s${state.stage}.opt.prepare`;
    else if (
      explore &&
      ending !== "contract_released" &&
      [2, 4].includes(state.stage) &&
      !state.attempts[`s${state.stage}.opt.prepare`]
    )
      id = `s${state.stage}.opt.prepare`;
    const options = compileActionOptions(state, scenario);
    const a =
      options.find((a) => a.id === id) ??
      options.find((a) => a.core) ??
      options[0];
    if (!a) throw Error("softlock");
    const from = state.stage;
    const r = resolveTurn(state, scenario, a.id, a.attribute ? die : null);
    state = r.state;
    rendered += r.result.fallback;
    if (from !== state.stage)
      rendered += scenario.stages[state.stage - 1].intro;
    trace.push({
      actionOptionId: a.id,
      stage: from,
      die: r.result.die,
      outcome: r.result.outcome,
      events: r.result.events,
      hp: state.hp,
      supplies: state.supplies,
      facts: [...state.facts],
      endingId: state.ending,
      text: r.result.fallback,
    });
  }
  if (state.ending)
    rendered += scenario.endings.find((e) => e.id === state.ending)!.text;
  return {
    state,
    trace,
    chineseCharacters: (rendered.match(/\p{Script=Han}/gu) ?? []).length,
  };
}
