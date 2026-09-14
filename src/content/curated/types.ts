import type { ScriptBook, ScriptLine } from "../script-book";
export type Attr = "body" | "agility" | "mind" | "presence";
export type ChoiceSeed = [
  label: string,
  attribute: Attr,
  tier: "low" | "medium" | "high",
  success: string,
  partial: string,
  failure: string,
  successRoute: string,
  partialRoute: string,
  failureRoute: string,
];
export type SceneSeed = {
  title: string;
  location: string;
  dialogue: string;
  choices: ChoiceSeed[];
  activity?: [Attr, string, string, string, string];
};
export type BookSeed = {
  id: string;
  sourceIndex: number;
  title: string;
  description: string;
  names: [string, string, string];
  clue: string;
  scenes: SceneSeed[];
  endings: [id: string, title: string, dialogue: string][];
};
// Editorial shorthand only: each line is written in the source files, never generated at runtime.
// P = player, A/B = the two named participants, G = the tabletop GM.
export function dialogue(text: string): ScriptLine[] {
  const roles = { P: "player", A: "student", B: "sister", G: "gm" } as const;
  return text
    .trim()
    .split("\n")
    .filter((x) => x.trim())
    .map((row) => {
      const role = row[0] as keyof typeof roles;
      if (!roles[role]) throw Error("unknown_editorial_speaker");
      const raw = row.slice(2).trim();
      const face = raw.startsWith("!")
        ? "angry"
        : raw.startsWith("?")
          ? "worried"
          : raw.startsWith("+")
            ? "smile"
            : raw.startsWith("~")
              ? "sad"
              : "neutral";
      return {
        speaker: roles[role],
        expression: face,
        text: /^[!?+~]/.test(raw) ? raw.slice(1) : raw,
      };
    });
}
export function buildCurated(
  seed: BookSeed,
  source: NonNullable<ScriptBook["source"]>,
): ScriptBook {
  const route = (code: string) => {
    const [destination, grant] = code.split("+");
    return {
      ...(destination === "true"
        ? { ending: "true", requires: ["clue"], otherwise: "good1" }
        : /^\d+$/.test(destination)
          ? { stage: Number(destination) }
          : { ending: destination }),
      grants: grant ? ["clue"] : [],
      bridge: [],
    };
  };
  return {
    version: `curated-${seed.id}-1.0`,
    edition: "curated-v1",
    structure: "branching",
    title: seed.title,
    description: seed.description,
    source,
    graphFlags: ["clue"],
    flagLabels: { clue: seed.clue },
    roleNames: {
      gm: "猫咪城主",
      player: seed.names[0],
      student: seed.names[1],
      sister: seed.names[2],
    },
    stages: seed.scenes.map((s, i) => ({
      title: s.title,
      location: s.location,
      roles: ["gm", "player", "student", "sister"],
      anchor: `${s.title}：${s.choices.map((c) => c[0]).join("，或")}`,
      knownFacts: [`当前地点：${s.location}`, `当前目标：${s.title}`],
      landing: "完成眼前抉择，按实际路线继续。",
      sideLimit: 0,
      opening: dialogue(s.dialogue),
      transition: [],
      ...(s.activity
        ? {
            activity: {
              attribute: s.activity[0],
              title: s.activity[1],
              afterLine: 10,
              intro: dialogue(s.activity[2]),
              success: dialogue(s.activity[3]),
              failure: dialogue(s.activity[4]),
            },
          }
        : {}),
      choices: s.choices.map((c, j) => ({
        id: `c${j + 1}`,
        label: c[0],
        attribute: c[1],
        tier: c[2],
        conditions: [s.title],
        risk: /bad/.test(c[8])
          ? "失败可能直接进入坏结局；确认前请留意属性与成功率。"
          : "这条路线允许受挫后继续，但可能错过另一条路线的线索。",
        branches: {
          success: dialogue(c[3]),
          partial: dialogue(c[4]),
          failure: dialogue(c[5]),
        },
        routes: {
          success: route(c[6]),
          partial: route(c[7]),
          failure: route(c[8]),
        },
      })),
    })),
    endings: seed.endings.map(([id, title, text]) => ({
      id,
      title,
      category: id === "true" ? "true" : id.startsWith("good") ? "good" : "bad",
      dialogue: dialogue(text),
    })),
  };
}
