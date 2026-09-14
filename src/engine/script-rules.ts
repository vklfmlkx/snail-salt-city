import {
  CharacterSchema,
  GameError,
  attributes,
  attributeLabels,
  type Action,
  type Character,
  type PublicAction,
  type PublicResult,
  type PublicState,
  type Scenario,
  type State,
} from "../domain/types";
import {
  ScriptBookSchema,
  type ScriptBook,
  type LocalPlan,
  type ScriptLine,
} from "../content/script-book";
const cast = [
  {
    roleId: "player",
    actorId: "hero_f",
    lookId: "tabletop",
    accessoryId: null,
  },
  { roleId: "student", actorId: "zhou", lookId: "tabletop", accessoryId: null },
  { roleId: "sister", actorId: "tang", lookId: "tabletop", accessoryId: null },
  { roleId: "engineer", actorId: "lin", lookId: "tabletop", accessoryId: null },
  { roleId: "visitor", actorId: "yan", lookId: "tabletop", accessoryId: null },
];
export const scriptNames: Record<string, string> = {
  gm: "猫咪城主",
  player: "青梅（你）",
  student: "阿瑟斯",
  sister: "七叶",
  engineer: "双子",
  visitor: "天降",
};
export const tierDifficulty = { low: 10, medium: 12, high: 14 } as const;
export function endingLabel(book: ScriptBook, id: string) {
  const end = book.endings.find((e) => e.id === id);
  if (!end?.category) return "结局";
  if (end.category === "true") return "真结局";
  const number =
    book.endings
      .filter((e) => e.category === end.category)
      .findIndex((e) => e.id === id) + 1;
  return `${number}号${end.category === "good" ? "好" : "坏"}结局`;
}
export function compileBook(input: ScriptBook): Scenario {
  const b = ScriptBookSchema.parse(input);
  const s: Scenario = {
    book: b,
    version: b.version,
    rulesVersion: b.edition ? "4.0.0" : b.structure ? "3.0.0" : "2.0.0",
    assetVersion: "tabletop-v2",
    cast,
    stages: b.stages.map((s, i) => ({
      id: `s${i + 1}`,
      title: s.title,
      scene: s.location,
      roles: s.roles,
      budget: 1,
      intro: s.anchor,
      timeoutText: "",
      timeout: [],
    })),
    actions: [],
    facts: {},
    items: {},
    flags: b.graphFlags ?? [],
    counters: {
      step: { min: 0, max: 4 },
      score: { min: 0, max: 24 },
      sideUsed: { min: 0, max: 2 },
      trainingTotal: { min: 0, max: 2 },
      ...Object.fromEntries(
        b.stages.map((_, i) => [`activity_${i + 1}`, { min: 0, max: 2 }]),
      ),
      ...Object.fromEntries(
        attributes.map((a) => [`buff_${a}`, { min: -2, max: 2 }]),
      ),
    },
    endings: b.endings.map((e, i) => ({
      id: e.id,
      title: e.title,
      text: e.dialogue
        .map(
          (d) =>
            `${b.roleNames?.[d.speaker] ?? scriptNames[d.speaker]}：${d.text}`,
        )
        .join("\n\n"),
      priority: 3 - i,
      condition: { kind: "always" },
    })),
  };
  for (const [id, text] of Object.entries(b.flagLabels ?? {}))
    s.facts[`flag.${id}`] = text;
  b.stages.forEach((stage, i) => {
    stage.knownFacts.forEach((f, j) => (s.facts[`book.${i + 1}.${j}`] = f));
    function action(
      id: string,
      attribute: (typeof attributes)[number],
      tier: number,
      label: string,
      side = false,
    ): Action {
      return {
        id,
        stage: i + 1,
        step: 0,
        stageCost: side ? 0 : 1,
        label,
        intent: side ? "在当前场景尝试一件小事" : stage.anchor,
        target: side ? "支线不改变主线，只影响一项属性" : stage.anchor,
        keywords: [label],
        attribute,
        difficulty: 8 + tier,
        condition: { kind: "always" },
        cost: {},
        effects: { success: [], partial: [], failure: [] },
        text: { success: "", partial: "", failure: "" },
        risk: side
          ? `${attributeLabels[attribute]}：成功+1、部分成功不变、失败−1；累计修正限制在−2至+2。只消耗1次本阶段支线。`
          : "消耗本阶段唯一关键行动。无论结果如何进入下一阶段；完成质量影响最终结局。",
        maxAttempts: side ? 2 : 1,
        core: !side,
      };
    }
    stage.choices.forEach((c) =>
      s.actions.push(
        action(
          `book.s${i + 1}.key.${c.id ?? c.attribute}`,
          c.attribute,
          0,
          c.label,
        ),
      ),
    );
    if (b.structure === "branching") {
      for (const c of stage.choices) {
        const fixed = s.actions.find(
          (a) => a.id === `book.s${i + 1}.key.${c.id ?? c.attribute}`,
        )!;
        fixed.risk = c.risk!;
        fixed.difficulty = c.tier ? tierDifficulty[c.tier] : 12;
        fixed.target = c.label;
        fixed.intent = c.label;
        for (const a of attributes)
          for (const [tier, n] of [
            ["simple", -1],
            ["standard", 0],
            ["demanding", 1],
          ] as const) {
            const custom = action(
              `book.s${i + 1}.custom.${c.id ?? c.attribute}.${a}.${tier}`,
              a,
              n,
              `自定做法 · ${c.label}`,
            );
            custom.difficulty = b.edition
              ? Math.max(10, Math.min(14, fixed.difficulty + n * 2))
              : 12 + n;
            custom.intent = c.label;
            custom.target = c.label;
            custom.risk = c.risk!;
            s.actions.push(custom);
          }
      }
      return;
    }
    for (const a of attributes)
      for (const [tier, n] of [
        ["simple", -1],
        ["standard", 0],
        ["demanding", 1],
      ] as const)
        for (const mode of ["side", "custom"] as const)
          s.actions.push(
            action(
              `book.s${i + 1}.${mode}.${a}.${tier}`,
              a,
              n,
              `${mode === "side" ? "自由支线" : "自定关键行动"} · ${attributeLabels[a]}`,
              mode === "side",
            ),
          );
  });
  return s;
}
export function initialScriptState(character: Character, s: Scenario): State {
  return {
    rulesVersion: s.rulesVersion,
    scenarioVersion: s.version,
    assetCatalogVersion: s.assetVersion,
    character: CharacterSchema.parse(character),
    stage: 1,
    remaining: 1,
    turn: 0,
    version: 0,
    status: "playing",
    hp: 10,
    supplies: 3,
    prepared: false,
    flags: Object.fromEntries(
      (s.book!.initialFlags ?? []).map((f) => [f, true]),
    ),
    counters: {
      step: 0,
      score: 0,
      sideUsed: 0,
      ...Object.fromEntries(attributes.map((a) => [`buff_${a}`, 0])),
    },
    items: {},
    facts: Object.keys(s.facts).filter(
      (f) =>
        f.startsWith("book.1.") ||
        (f.startsWith("flag.") && s.book!.initialFlags?.includes(f.slice(5))),
    ),
    attempts: {},
    ending: null,
    castSnapshot: structuredClone(cast),
  };
}
export function effectiveStats(st: State) {
  return Object.fromEntries(
    attributes.map((a) => [
      a,
      Math.max(
        1,
        Math.min(10, st.character.stats[a] + (st.counters[`buff_${a}`] ?? 0)),
      ),
    ]),
  ) as Record<(typeof attributes)[number], number>;
}
export function scriptOptions(st: State, s: Scenario) {
  if (st.status !== "playing") return [];
  return s.actions.filter(
    (a) =>
      a.stage === st.stage &&
      (a.stageCost !== 0 ||
        st.counters.sideUsed < s.book!.stages[st.stage - 1].sideLimit),
  );
}
export function scriptPublicAction(st: State, a: Action): PublicAction {
  return {
    ...(st.rulesVersion === "4.0.0"
      ? {
          requirement:
            a.difficulty! <= 10
              ? ("low" as const)
              : a.difficulty! >= 14
                ? ("high" as const)
                : ("medium" as const),
        }
      : {}),
    id: a.id,
    stageCost: a.stageCost,
    label: a.label,
    intent: a.intent,
    target: a.target,
    keywords: a.keywords,
    attribute: a.attribute,
    difficulty:
      a.difficulty! +
      (st.rulesVersion === "4.0.0"
        ? { story: -3, normal: 0, hard: 2 }
        : st.rulesVersion === "3.0.0"
          ? { story: -4, normal: 0, hard: 2 }
          : { story: -2, normal: 0, hard: 3 })[
        st.character.difficulty ?? "normal"
      ],
    cost: a.cost,
    risk: a.risk,
    modifier: 0,
  };
}
export function scriptProject(st: State, s: Scenario, id = ""): PublicState {
  const book = s.book!,
    stage = book.stages[st.stage - 1],
    ending = book.endings.find((e) => e.id === st.ending);
  const characters = st.castSnapshot
    .filter((c) => stage.roles.includes(c.roleId as never))
    .map((c) => ({
      ...c,
      actorId:
        c.roleId === "player" ? (st.character.avatar ?? "hero_f") : c.actorId,
      expressionId: `${c.actorId}.face.neutral`,
      name:
        book.roleNames?.[c.roleId as keyof typeof book.roleNames] ??
        scriptNames[c.roleId],
    }));
  return {
    id,
    scenarioVersion: s.version,
    version: st.version,
    turn: st.turn,
    status: st.status,
    character: st.character,
    stage: {
      id: `s${st.stage}`,
      number: st.stage,
      title: stage.title,
      intro: stage.anchor,
      budget: 1,
    },
    remaining: st.remaining,
    hp: st.hp,
    supplies: st.supplies,
    prepared: false,
    injured: false,
    items: [],
    facts: st.facts.map((id) => ({ id, text: s.facts[id] })),
    actions: scriptOptions(st, s).map((a) => scriptPublicAction(st, a)),
    ending: ending
      ? {
          id: ending.id,
          label: endingLabel(book, ending.id),
          title: ending.title,
          text: ending.dialogue
            .map(
              (d) =>
                `${s.book!.roleNames?.[d.speaker] ?? scriptNames[d.speaker]}：${d.text}`,
            )
            .join("\n\n"),
        }
      : null,
    render: {
      version: st.version,
      scene: stage.location,
      sceneLabel: stage.location,
      props: [],
      characters,
      snail: "snail.neutral",
    },
    script: {
      branching: book.structure === "branching",
      title: book.title,
      edition: book.edition,
      endingCount: book.endings.length,
      activity:
        st.status === "playing" && stage.activity
          ? {
              ...stage.activity,
              status: st.counters[`activity_${st.stage}`] ?? 0,
              rewardAvailable:
                (st.counters.trainingTotal ?? 0) < 2 &&
                (st.counters[`buff_${stage.activity.attribute}`] ?? 0) < 1,
            }
          : undefined,
      roleNames: book.roleNames,
      milestones: book.structure
        ? Object.entries(st.flags)
            .filter(([, v]) => v)
            .map(([id]) => ({
              id,
              label:
                book.flagLabels?.[id] ??
                (id === "community_voice" ? "姐妹自主分工" : "口信来源核验"),
            }))
        : [],
      stageCount: book.stages.length,
      opening: stage.opening,
      initialDialogue: book.stages[0].opening,
      sideRemaining:
        st.status === "playing" ? stage.sideLimit - st.counters.sideUsed : 0,
      effectiveStats: effectiveStats(st),
      difficulty: st.character.difficulty ?? "normal",
    },
  };
}
export function resolveScript(
  st: State,
  s: Scenario,
  actionId: string,
  die: number | null,
  plan?: LocalPlan,
) {
  const a = scriptOptions(st, s).find((a) => a.id === actionId);
  if (!a) throw new GameError(422, "illegal_action", "本阶段没有这个行动。");
  if (!Number.isInteger(die) || die! < 1 || die! > 10)
    throw new GameError(400, "die", "骰点不合法。");
  const next = structuredClone(st),
    book = s.book!,
    stage = book.stages[st.stage - 1],
    pub = scriptPublicAction(st, a),
    value = effectiveStats(st)[a.attribute!],
    margin = die! + value - pub.difficulty!;
  const outcome =
    margin >= 0 ? "success" : margin >= -2 ? "partial" : "failure";
  const result: PublicResult = {
    turnNumber: st.turn + 1,
    beforeVersion: st.version,
    afterVersion: st.version + 1,
    actionLabel: a.label,
    die,
    attribute: a.attribute,
    attributeValue: value,
    difficulty: pub.difficulty,
    modifier: 0,
    margin,
    outcome,
    events: [{ type: "action", id: a.id, outcome }],
    fallback: "",
    beforeScene: stage.location,
    afterScene: stage.location,
    render: scriptProject(st, s).render,
    dialogueRoles: scriptProject(st, s).render.characters,
  };
  let lines: ScriptLine[];
  if (a.stageCost === 0) {
    next.counters.sideUsed++;
    const key = `buff_${a.attribute}`,
      delta = outcome === "success" ? 1 : outcome === "failure" ? -1 : 0;
    next.counters[key] = Math.max(
      -2,
      Math.min(2, (next.counters[key] ?? 0) + delta),
    );
    result.events.push({
      type: "attribute",
      attribute: a.attribute!,
      before: value,
      after: effectiveStats(next)[a.attribute!],
    });
    lines = plan?.branches[outcome] ?? [
      {
        speaker: "gm",
        expression: "neutral",
        text: "这次小尝试已经结束，大家还在原来的场景中。",
      },
      {
        speaker: "player",
        expression: "neutral",
        text: "我整理一下思路，再决定关键时刻怎么做。",
      },
    ];
  } else if (book.structure === "branching") {
    const choice = stage.choices.find(
      (c) => (c.id ?? c.attribute) === a.id.split(".")[3],
    )!;
    const route = choice.routes![outcome];
    for (const flag of route.grants) {
      next.flags[flag] = true;
      if (s.facts[`flag.${flag}`] && !next.facts.includes(`flag.${flag}`))
        next.facts.push(`flag.${flag}`);
    }
    lines = [
      ...(plan?.branches[outcome] ?? choice.branches[outcome]),
      ...route.bridge,
    ];
    if (route.stage) {
      next.stage = route.stage;
      next.facts.push(
        ...Object.keys(s.facts).filter(
          (f) => f.startsWith(`book.${next.stage}.`) && !next.facts.includes(f),
        ),
      );
      result.events.push({
        type: "stage",
        from: st.stage,
        to: next.stage,
        timeout: false,
      });
      lines.push(...book.stages[next.stage - 1].opening);
    } else {
      next.status = "ended";
      next.remaining = 0;
      next.ending = route.requires?.some((f) => !next.flags[f])
        ? route.otherwise!
        : route.ending!;
      lines.push(...book.endings.find((e) => e.id === next.ending)!.dialogue);
      result.events.push({ type: "ending", id: next.ending });
    }
  } else {
    next.counters.score +=
      outcome === "success" ? 2 : outcome === "partial" ? 1 : 0;
    lines = [
      ...(plan?.branches[outcome] ??
        stage.choices.find((c) => c.attribute === a.attribute)!.branches[
          outcome
        ]),
      ...stage.transition,
    ];
    if (st.stage < book.stages.length) {
      next.stage++;
      next.counters.sideUsed = 0;
      next.facts.push(
        ...Object.keys(s.facts).filter((f) =>
          f.startsWith(`book.${next.stage}.`),
        ),
      );
      result.events.push({
        type: "stage",
        from: st.stage,
        to: next.stage,
        timeout: false,
      });
      lines = [...lines, ...book.stages[next.stage - 1].opening];
    } else {
      next.status = "ended";
      next.remaining = 0;
      next.ending =
        next.counters.score >= book.stages.length * 2 - 1
          ? "true"
          : next.counters.score >= book.stages.length
            ? "good"
            : "bad";
      const end = book.endings.find((e) => e.id === next.ending)!;
      lines = [...lines, ...end.dialogue];
      result.events.push({ type: "ending", id: next.ending });
    }
  }
  next.turn++;
  next.version++;
  next.attempts[a.id] = (next.attempts[a.id] ?? 0) + 1;
  result.scriptDialogue = structuredClone(lines);
  result.fallback = lines
    .map(
      (d) =>
        `${s.book!.roleNames?.[d.speaker] ?? scriptNames[d.speaker]}：${d.text}`,
    )
    .join("\n\n");
  result.afterScene = book.stages[next.stage - 1].location;
  result.render = scriptProject(next, s).render;
  return { state: next, result };
}
