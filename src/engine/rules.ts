import {
  CharacterSchema,
  GameError,
  type Action,
  type Character,
  type Effect,
  type Event,
  type Outcome,
  type PublicAction,
  type PublicResult,
  type PublicState,
  type RenderState,
  type Scenario,
  type State,
} from "../domain/types";
import {
  condition,
  validateCondition,
  validateEffect,
} from "../domain/conditions";
import catalog from "../content/assets.v1.json";
import {
  initialScriptState,
  scriptOptions,
  scriptPublicAction,
  scriptProject,
  resolveScript,
} from "./script-rules";
import { ScriptBookSchema } from "../content/script-book";
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function validateScenario(s: Scenario) {
  if (s.book) {
    ScriptBookSchema.parse(s.book);
    return {
      stages: s.stages.length,
      actions: s.actions.length,
      facts: Object.keys(s.facts).length,
      plannedLayers: 0,
    };
  }
  if (
    s.stages.length !== 6 ||
    new Set(s.actions.map((a) => a.id)).size !== s.actions.length
  )
    throw Error("scenario shape");
  if (new Set(s.endings.map((e) => e.priority)).size !== 4)
    throw Error("ending priorities");
  s.stages.forEach((st, i) => {
    if (
      st.id !== `s${i + 1}` ||
      st.budget < 4 ||
      st.budget > 10 ||
      !st.timeout.length
    )
      throw Error("stage/timeout");
    st.timeout.forEach((e) => validateEffect(e, s));
    for (let n = 0; n < 4; n++)
      if (s.actions.filter((a) => a.stage === i + 1 && a.step === n).length < 2)
        throw Error("node alternatives");
  });
  s.endings.forEach((e) => validateCondition(e.condition, s));
  s.actions.forEach((a) => {
    validateCondition(a.condition, s);
    if (
      !s.stages[a.stage - 1] ||
      a.maxAttempts !== (a.stageCost === 0 ? 8 : 1) ||
      !a.label ||
      !a.risk ||
      (a.attribute === null) !== (a.difficulty === null)
    )
      throw Error("action");
    for (const [k, v] of Object.entries(a.cost)) {
      if (k === "items") {
        for (const [id, n] of Object.entries(v as Record<string, number>))
          if (!s.items[id] || !Number.isInteger(n) || n < 1 || n > 10)
            throw Error("item cost");
      } else if (
        !["hp", "supplies"].includes(k) ||
        !Number.isInteger(v) ||
        Number(v) < 0 ||
        Number(v) > 10
      )
        throw Error("cost");
    }
    for (const o of ["success", "partial", "failure"] as const) {
      if (!a.text[o]) throw Error("missing fallback");
      a.effects[o].forEach((e) => validateEffect(e, s));
    }
  });
  for (const c of s.cast) {
    if (
      s.drama &&
      c.lookId === "tabletop" &&
      ["hero_f", "hero_m", "zhou", "tang", "lin", "yan"].includes(c.actorId)
    )
      continue;
    const look = catalog.looks.find((l) => l.id === c.lookId);
    if (
      !look ||
      look.actorId !== c.actorId ||
      (c.accessoryId && !look.allowedAccessoryIds.includes(c.accessoryId))
    )
      throw Error("cast");
  }
  return {
    stages: s.stages.length,
    actions: s.actions.length,
    facts: Object.keys(s.facts).length,
    plannedLayers: catalog.assets.length,
  };
}
export function initialState(character: Character, s: Scenario): State {
  if (s.book) return initialScriptState(character, s);
  return {
    rulesVersion: s.rulesVersion,
    scenarioVersion: s.version,
    assetCatalogVersion: s.assetVersion,
    character: CharacterSchema.parse(character),
    stage: 1,
    remaining: s.stages[0].budget,
    turn: 0,
    version: 0,
    status: "playing",
    hp: 10,
    supplies: 3,
    prepared: false,
    flags: {},
    counters: { step: 0 },
    items: {},
    facts: ["danger"],
    attempts: {},
    ending: null,
    castSnapshot: structuredClone(s.cast),
  };
}
export function checkVersion(st: State, s: Scenario) {
  if (
    st.rulesVersion !== s.rulesVersion ||
    st.scenarioVersion !== s.version ||
    st.assetCatalogVersion !== s.assetVersion
  )
    throw new GameError(
      409,
      "version_unsupported",
      "此存档版本暂不支持，请明确放弃后新开局。",
    );
}
export function modifier(st: State, a: Action) {
  const support = a.id === "s5.3.obstacle" || a.id === "s5.3.detour";
  return clamp(
    (st.prepared ? 1 : 0) +
      (st.hp <= 4 && ["body", "agility"].includes(a.attribute ?? "") ? -1 : 0) +
      (support && (st.flags.support || st.flags.mechanic_support) ? 1 : 0) +
      (a.stage === 6 && st.flags.maintained ? 1 : 0),
    -2,
    2,
  );
}
export function compileActionOptions(st: State, s: Scenario): Action[] {
  checkVersion(st, s);
  if (s.book) return scriptOptions(st, s);
  if (st.status !== "playing") return [];
  return s.actions.filter(
    (a) =>
      a.stage === st.stage &&
      (a.step === null || a.step === st.counters.step) &&
      condition(a.condition, st) &&
      (st.attempts[a.id] ?? 0) < a.maxAttempts &&
      (!a.id.endsWith(".prepare") || !st.prepared) &&
      st.hp >= (a.cost.hp ?? 0) &&
      st.supplies >= (a.cost.supplies ?? 0) &&
      Object.entries(a.cost.items ?? {}).every(
        ([id, n]) => (st.items[id] ?? 0) >= n,
      ),
  );
}
export function publicAction(st: State, a: Action): PublicAction {
  if (a.id.startsWith("book.")) return scriptPublicAction(st, a);
  const costs = (["hp", "supplies"] as const).flatMap((resource) => {
    const losses = Object.values(a.effects).map((effects) =>
      effects
        .filter((e) => e.kind === "resource_delta" && e.resource === resource)
        .reduce(
          (total, e) =>
            total + (e.kind === "resource_delta" ? Math.min(0, e.value) : 0),
          0,
        ),
    );
    const loss = Math.min(...losses);
    return loss < 0
      ? [
          `本次后果最多损失${-loss}点${resource === "hp" ? "生命" : "物资"}（不足扣至0）`,
        ]
      : [];
  });
  const relationship =
    a.stage === 5 && a.step === 2
      ? st.flags.support || st.flags.mechanic_support
        ? "已有协助额外回补1物资。"
        : st.flags.forced
          ? "此前强行通行额外损失1物资。"
          : ""
      : "";
  return {
    id: a.id,
    stageCost: a.stageCost ?? 1,
    label: a.label,
    intent: a.intent,
    target: a.target,
    keywords: a.keywords,
    attribute: a.attribute,
    difficulty: a.difficulty,
    cost: a.cost,
    risk: [a.risk, ...costs, relationship].filter(Boolean).join(" "),
    modifier: a.attribute ? modifier(st, a) : 0,
  };
}
export function renderState(st: State, s: Scenario): RenderState {
  if (s.book) return scriptProject(st, s).render;
  const scene = s.stages[st.stage - 1];
  const dramaPlace = !s.drama
    ? null
    : st.ending === "return"
      ? "异世界 · 返回学院"
      : st.stage === 1
        ? st.facts.includes("chapter1_point3")
          ? "未来地球 · 荒废城市"
          : st.facts.includes("chapter1_point2")
            ? "异世界 · 法师塔"
            : "异世界 · 院长办公室"
        : st.stage === 2
          ? "未来地球 · 临时住处（前三个月）"
          : st.stage === 3
            ? "未来地球 · 姐妹们的新家（第四至九个月）"
            : st.stage === 4
              ? "未来地球 · 竹马房间（第十至十二个月）"
              : "未来地球 · 新家与探测船（两年后）";
  const props: string[] = [];
  if (st.stage <= 2 && st.facts.includes("barrier_visible"))
    props.push("prop.barrier");
  if (st.stage <= 4 && st.stage >= 3 && st.items.box)
    props.push("prop.box_closed");
  if (st.stage === 4 && st.facts.includes("records_visible"))
    props.push("prop.record_folder");
  if (st.stage >= 5 && st.facts.includes("deployed"))
    props.push("prop.barricade");
  return {
    version: st.version,
    scene: scene.scene,
    sceneLabel:
      dramaPlace ??
      { apartment_lobby: "公寓大堂", warehouse: "维修仓库", dock: "临港码头" }[
        scene.scene
      ] ??
      scene.scene,
    props,
    characters: st.castSnapshot
      .filter((c) => scene.roles.includes(c.roleId))
      .map((c) => ({
        ...c,
        actorId:
          c.roleId === "player" ? (st.character.avatar ?? "hero_f") : c.actorId,
        name:
          c.roleId === "player"
            ? "青梅（你）"
            : (s.drama?.roleNames[c.roleId] ??
              (c.roleId === "keeper" ? "物业老许" : "维修员阿岑")),
        expressionId: `${c.actorId}.face.${st.hp <= 4 ? "worried" : "neutral"}`,
      })),
    snail: st.remaining <= 2 ? "snail.approaching" : "snail.neutral",
  };
}
export function project(st: State, s: Scenario, id = ""): PublicState {
  if (s.book) return scriptProject(st, s, id);
  checkVersion(st, s);
  const stage = s.stages[st.stage - 1],
    ending = s.endings.find((e) => e.id === st.ending);
  const routeSummary = ending
    ? [
        `本局用去${st.turn}次行动，最后保有${st.hp}点生命、${st.supplies}份物资。`,
        st.flags.support
          ? "你争取到了老许的有限合作。"
          : st.flags.forced
            ? "你经自行处理的侧口通行，承担了失去物业合作的代价。"
            : st.flags.access
              ? "你取得了通行安排，但没有获得额外物业支持。"
              : "",
        st.flags.mechanic_support
          ? "阿岑承诺的有限协助在后续处理中发挥了作用。"
          : "",
        st.ending === "narrow_escape"
          ? st.attempts["s6.4.drive"]
            ? "这一次，你使用实际取得的钥匙驾车驶离。"
            : "这一次，你沿步行退路离开，没有把缺失的车辆算作成果。"
          : "",
        st.ending === "contract_released"
          ? "两项材料都已查证，奖金兑现权也已经明确放弃。"
          : "",
      ]
        .filter(Boolean)
        .join("")
    : "";
  return {
    id,
    scenarioVersion: s.version,
    version: st.version,
    turn: st.turn,
    status: st.status,
    character: st.character,
    ...(s.drama
      ? {
          progress: {
            community: st.counters.community ?? 0,
            readiness: st.counters.readiness ?? 0,
          },
        }
      : {}),
    stage: {
      id: stage.id,
      number: st.stage,
      title: stage.title,
      intro: stage.intro,
      budget: stage.budget,
    },
    remaining: st.remaining,
    hp: st.hp,
    supplies: st.supplies,
    prepared: st.prepared,
    injured: st.hp <= 4,
    items: Object.entries(st.items)
      .filter(([, n]) => n > 0)
      .map(([id, quantity]) => ({ id, label: s.items[id], quantity })),
    facts: st.facts.map((id) => ({ id, text: s.facts[id] })),
    actions: compileActionOptions(st, s).map((a) => publicAction(st, a)),
    ending: ending
      ? {
          id: ending.id,
          title: ending.title,
          text: (s.drama ? "" : routeSummary + "\n\n") + ending.text,
        }
      : null,
    render: renderState(st, s),
  };
}
export function outcomeFromMargin(m: number): Outcome {
  return m >= 0 ? "success" : m >= -2 ? "partial" : "failure";
}
export function resolveTurn(
  before: State,
  s: Scenario,
  actionId: string,
  die: number | null,
): { state: State; result: PublicResult } {
  if (s.book) return resolveScript(before, s, actionId, die);
  const a = compileActionOptions(before, s).find((x) => x.id === actionId);
  if (!a)
    throw new GameError(
      422,
      "illegal_action",
      "该行动当前不可用，请刷新可选行动。",
    );
  if (
    a.attribute
      ? die === null || !Number.isInteger(die) || die < 1 || die > 10
      : die !== null
  )
    throw Error("die contract");
  const st = structuredClone(before),
    events: Event[] = [];
  let dead = st.hp === 0;
  function apply(e: Effect) {
    switch (e.kind) {
      case "resource_delta": {
        const old = st[e.resource];
        st[e.resource] = clamp(old + e.value, 0, e.resource === "hp" ? 10 : 5);
        if (st.hp === 0) dead = true;
        if (dead) st.hp = 0;
        if (old !== st[e.resource])
          events.push({
            type: "resource",
            resource: e.resource,
            before: old,
            after: st[e.resource],
          });
        break;
      }
      case "flag_set":
        st.flags[e.id] = e.value;
        break;
      case "counter_delta": {
        const b = s.counters[e.id];
        st.counters[e.id] = clamp(
          (st.counters[e.id] ?? 0) + e.value,
          b.min,
          b.max,
        );
        break;
      }
      case "grant_item":
      case "remove_item": {
        st.items[e.id] = clamp(
          (st.items[e.id] ?? 0) +
            (e.kind === "grant_item" ? e.quantity : -e.quantity),
          0,
          10,
        );
        events.push({
          type: "item",
          id: e.id,
          label: s.items[e.id],
          quantity: st.items[e.id],
        });
        break;
      }
      case "reveal_fact":
        if (!st.facts.includes(e.id)) {
          st.facts.push(e.id);
          events.push({ type: "fact", id: e.id, text: s.facts[e.id] });
        }
        break;
      case "set_prepared":
        st.prepared = e.value;
        events.push({ type: "prepared", value: e.value });
        break;
    }
  }
  const mod = a.attribute ? modifier(before, a) : 0;
  const margin = a.attribute
    ? die! + before.character.stats[a.attribute] + mod - a.difficulty!
    : null;
  const outcome = margin === null ? "success" : outcomeFromMargin(margin);
  if (a.cost.hp)
    apply({ kind: "resource_delta", resource: "hp", value: -a.cost.hp });
  if (a.cost.supplies)
    apply({
      kind: "resource_delta",
      resource: "supplies",
      value: -a.cost.supplies,
    });
  for (const [id, quantity] of Object.entries(a.cost.items ?? {}))
    apply({ kind: "remove_item", id, quantity });
  if (a.attribute && st.prepared) apply({ kind: "set_prepared", value: false });
  a.effects[outcome].forEach(apply);
  // Prior relationships change material cost as well as the fixed check modifier.
  if (a.stage === 5 && a.step === 2) {
    if (before.flags.support || before.flags.mechanic_support)
      apply({ kind: "resource_delta", resource: "supplies", value: 1 });
    else if (before.flags.forced)
      apply({ kind: "resource_delta", resource: "supplies", value: -1 });
  }
  st.attempts[a.id] = (st.attempts[a.id] ?? 0) + 1;
  st.remaining -= a.stageCost ?? 1;
  st.turn++;
  st.version++;
  events.unshift({ type: "action", id: a.id, outcome });
  function end() {
    if (dead) st.hp = 0;
    const e = [...s.endings]
      .sort((x, y) => y.priority - x.priority)
      .find((e) => condition(e.condition, st));
    if (e) {
      st.status = "ended";
      st.ending = e.id;
      events.push({ type: "ending", id: e.id });
      return true;
    }
    return false;
  }
  let timeoutText = "";
  if (!end()) {
    const normal = st.counters.step === 4 && st.stage < 6;
    const timeout = !normal && st.remaining === 0;
    if (timeout) {
      timeoutText = s.stages[st.stage - 1].timeoutText;
      s.stages[st.stage - 1].timeout.forEach(apply);
    }
    if (!(timeout && end()) && (normal || timeout) && st.stage < 6) {
      const from = st.stage;
      st.stage++;
      st.counters.step = 0;
      st.remaining = s.stages[st.stage - 1].budget;
      st.prepared = false;
      events.push({ type: "stage", from, to: st.stage, timeout });
    }
  }
  const result: PublicResult = {
    ...(s.drama
      ? {
          dialogueRoles: renderState(before, s).characters.map(
            ({ roleId, name, actorId }) => ({ roleId, name, actorId }),
          ),
        }
      : {}),
    turnNumber: st.turn,
    beforeVersion: before.version,
    afterVersion: st.version,
    actionLabel: a.label,
    die,
    attribute: a.attribute,
    attributeValue: a.attribute ? before.character.stats[a.attribute] : null,
    difficulty: a.difficulty,
    modifier: mod,
    margin,
    outcome,
    events,
    fallback: a.text[outcome] + (timeoutText ? "\n\n" + timeoutText : ""),
    beforeScene: s.drama
      ? renderState(before, s).sceneLabel
      : s.stages[before.stage - 1].title,
    afterScene: s.drama
      ? renderState(st, s).sceneLabel
      : s.stages[st.stage - 1].title,
    render: renderState(st, s),
  };
  return { state: st, result };
}
