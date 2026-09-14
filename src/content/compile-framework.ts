import type { Scenario, Action, Effect, Condition } from "../domain/types";
import { FrameworkSchema, type Framework } from "./framework-schema";
const eq = (field: string, value: number | boolean): Condition => ({
  kind: "compare",
  field,
  op: "eq",
  value,
});
export const HOMECOMING_VERSION = "homecoming-1.0";
export function compileFramework(input: Framework): Scenario {
  const f = FrameworkSchema.parse(input);
  const s: Scenario = {
    version: HOMECOMING_VERSION,
    rulesVersion: "1.0.0",
    assetVersion: "tabletop-v2",
    drama: {
      title: f.title,
      roleNames: Object.fromEntries(f.roles.map((r) => [r.id, r.name])),
      voices: Object.fromEntries(f.roles.map((r) => [r.id, r.voice])),
    },
    stages: f.chapters.map((c, i) => ({
      id: `s${i + 1}`,
      title: c.title,
      scene: c.time,
      roles: ["player", ...c.roles],
      budget: 4,
      intro: c.checkpoints[0].goal,
      timeoutText: "这一幕结束了，带着已知的线索继续。",
      timeout: [{ kind: "counter_delta", id: "step", value: 4 }],
    })),
    actions: [],
    facts: { danger: f.premise },
    items: {},
    flags: ["return", "home", "stars", "shelter"],
    counters: {
      step: { min: 0, max: 4 },
      community: { min: 0, max: 10 },
      readiness: { min: 0, max: 10 },
      interactions: { min: 0, max: 8 },
    },
    endings: f.endings.map((e, i) => ({
      id: e.id,
      priority: 4 - i,
      condition: eq(`flag:${e.id}`, true),
      title: e.title,
      text: e.text,
    })),
    cast: [
      {
        roleId: "player",
        actorId: "hero_f",
        lookId: "tabletop",
        accessoryId: null,
      },
      ...f.roles.map((r, i) => ({
        roleId: r.id,
        actorId: ["zhou", "tang", "lin", "yan"][i],
        lookId: "tabletop",
        accessoryId: null,
      })),
    ],
  };
  for (const [i, ch] of f.chapters.entries())
    for (const [j, node] of ch.checkpoints.entries()) {
      const fact = `chapter${i + 1}_point${j + 1}`;
      s.facts[fact] = node.reveal;
      for (const [k, o] of node.options.entries()) {
        const effects = (
          outcome: "success" | "partial" | "failure",
        ): Effect[] => [
          { kind: "counter_delta", id: "step", value: 1 },
          { kind: "reveal_fact", id: fact },
          ...(outcome !== "failure"
            ? [
                {
                  kind: "counter_delta" as const,
                  id: k === 0 ? "readiness" : "community",
                  value: 1,
                },
              ]
            : []),
          {
            kind: "resource_delta",
            resource: "supplies",
            value: outcome === "success" ? 1 : outcome === "failure" ? -1 : 0,
          },
        ];
        s.actions.push({
          id: `hc.s${i + 1}.${j + 1}.${k}`,
          stage: i + 1,
          step: j,
          label: o.label,
          intent: node.goal,
          target: node.goal,
          keywords: [o.label],
          attribute: o.attribute,
          difficulty: 11,
          condition: { kind: "always" },
          cost: {},
          effects: {
            success: effects("success"),
            partial: effects("partial"),
            failure: effects("failure"),
          },
          text: { success: o.success, partial: o.partial, failure: o.failure },
          risk: `判定影响过程与物资；${k === 0 ? "筹备" : "伙伴协作"}在成功或部分成功时增加1，关键线索始终获得。`,
          maxAttempts: 1,
          core: true,
        });
      }
    }
  // Broad, server-owned checks let the interpreter accept new methods without
  // granting it control over effects. Irreversible decisions require explicit choices.
  for (const [i, ch] of f.chapters.entries())
    for (const [j, node] of ch.checkpoints.entries()) {
      if ((i === 1 || i === 5) && j === 3) continue;
      for (const [attribute, label, channel] of [
        ["mind", "自行调查、分析或准备", 0],
        ["presence", "与在场的人交谈、询问或协商", 1],
        ["body", "动手操作、搬运或处理现场问题", 0],
        ["agility", "小心探索、观察或灵巧操作", 0],
      ] as const) {
        const base = s.actions.find(
          (a) => a.id === `hc.s${i + 1}.${j + 1}.${channel}`,
        )!;
        s.actions.push({
          ...structuredClone(base),
          id: `hc.s${i + 1}.${j + 1}.free.${attribute}`,
          attribute,
          label,
          keywords: [],
          intent: node.goal,
          text: {
            success: `你的做法取得了进展。${node.reveal}`,
            partial: `过程不完全顺利，但你获得了关键线索。${node.reveal}`,
            failure: `这次尝试遇到了阻碍，耗去一些物资；关键线索仍然得到确认。${node.reveal}`,
          },
        });
      }
    }
  for (const [i, ch] of f.chapters.entries())
    for (const [j, node] of ch.checkpoints.entries())
      for (const attribute of [
        "mind",
        "presence",
        "body",
        "agility",
      ] as const) {
        s.actions.push({
          id: `hc.s${i + 1}.${j + 1}.side.${attribute}`,
          stage: i + 1,
          step: j,
          stageCost: 0,
          label: `留在当前场景继续${attribute === "presence" ? "交谈" : "调查与尝试"}`,
          intent: "继续交流或检查，不完成当前主线目标",
          target: node.goal,
          keywords: [],
          attribute,
          difficulty: 11,
          condition: {
            kind: "compare",
            field: "counter:interactions",
            op: "lte",
            value: 7,
          },
          cost: {},
          effects: {
            success: [{ kind: "counter_delta", id: "interactions", value: 1 }],
            partial: [{ kind: "counter_delta", id: "interactions", value: 1 }],
            failure: [{ kind: "counter_delta", id: "interactions", value: 1 }],
          },
          text: {
            success:
              "这次交流或尝试顺利进行。你仍在原处，没有执行主线目标，也没有发现新的关键线索。",
            partial:
              "你的尝试有一些阻碍。你仍在原处，没有执行主线目标，也没有发现新的关键线索。",
            failure:
              "你的尝试没有达到预期。你仍在原处，没有执行主线目标，也没有发现新的关键线索。",
          },
          risk: "留在当前场景，不推进主线、不消耗本幕主线行动，不会自动出发或选择结局。消耗1次自由互动，本局最多8次。",
          maxAttempts: 8,
          core: false,
        });
      }
  const endingAction = (
    id: string,
    stage: number,
    label: string,
    cond: Condition,
  ): Action => ({
    id: `hc.end.${id}`,
    stage,
    step: 3,
    label,
    intent: label,
    target: "决定自己的去向",
    keywords: [label],
    attribute: null,
    difficulty: null,
    condition: cond,
    cost: {},
    effects: Object.fromEntries(
      ["success", "partial", "failure"].map((o) => [
        o,
        [{ kind: "flag_set", id, value: true }],
      ]),
    ) as Action["effects"],
    text: {
      success: s.endings.find((e) => e.id === id)!.text,
      partial: "决定已记录。",
      failure: "决定已记录。",
    },
    risk: "这会结束本局；伙伴各自选择，不强迫所有人同行。",
    maxAttempts: 1,
    core: true,
  });
  for (const a of s.actions.filter((a) => a.stage === 2 && a.step === 3)) {
    a.label = "留下 · " + a.label;
    a.risk += " 确认后选择留在地球，返程窗口将关闭。";
  }
  s.actions.push(
    endingAction("return", 2, "趁窗口尚在，返回学院", { kind: "always" }),
  );
  // The final checkpoint is a deliberate choice, never a random ending.
  s.actions = s.actions.filter((a) => !(a.stage === 6 && a.step === 3));
  s.actions.push(
    endingAction("home", 6, "留下，一起建设家园", {
      kind: "compare",
      field: "counter:community",
      op: "gte",
      value: 4,
    }),
    endingAction("stars", 6, "与愿意同行的伙伴去星际", {
      kind: "compare",
      field: "counter:readiness",
      op: "gte",
      value: 4,
    }),
    endingAction("shelter", 6, "接受帮助，暂缓远行", { kind: "always" }),
  );
  return s;
}
