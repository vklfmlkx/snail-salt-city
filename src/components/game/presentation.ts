import type { PublicState, PublicTurn } from "@/domain/types";
import type { ScriptLine } from "@/content/script-book";

// Tabletop identities are separate from the immutable saved cast.
export const actors = {
  gm: {
    name: "猫咪城主",
    role: "主持 / 旁白",
    description: "负责描述世界、宣读结果。皇冠只是跑团道具。",
  },
  lin: {
    name: "小林",
    role: "常驻玩家",
    description: "细心的观察者，擅长扮演务实的工匠与伙伴。",
  },
  zhou: {
    name: "阿舟",
    role: "常驻玩家",
    description: "喜欢接梗的老团友，擅长扮演热情又冒失的年轻人。",
  },
  tang: {
    name: "阿棠",
    role: "常驻玩家",
    description: "行动派，笑声和吐槽都很有感染力。可扮演伙伴、旅人和队长。",
  },
  yan: {
    name: "老严",
    role: "常驻玩家",
    description: "爱考据的老团友，擅长扮演学者、长辈和来访者。",
  },
  hero_f: {
    name: "女主角",
    role: "你的席位",
    description: "由你决定行动的主角形象；剧中身份随剧本变化。",
  },
  hero_m: {
    name: "男主角",
    role: "你的席位",
    description: "由你决定行动的主角形象；剧中身份随剧本变化。",
  },
} as const;
export type ActorId = keyof typeof actors;
export const expressions = [
  "neutral",
  "smile",
  "worried",
  "surprised",
  "angry",
  "sad",
] as const;
export type Expression = (typeof expressions)[number];
export const expressionLabels = [
  "平静",
  "微笑",
  "担心",
  "惊讶",
  "生气",
  "难过",
];
export type Room = "table" | "nook" | "lounge";
export const rooms: Record<Room, string> = {
  table: "跑团主桌",
  nook: "私语角",
  lounge: "散场休息区",
};
export const portrait = (id: ActorId, expression: Expression) =>
  `/assets/tabletop/v2/${id}.png`;
export const roleActor: Record<string, ActorId> = {
  gm: "gm",
  keeper: "zhou",
  mechanic: "lin",
  student: "zhou",
  sister: "tang",
  engineer: "lin",
  visitor: "yan",
  player: "hero_f",
};
export interface Beat {
  speaker: ActorId;
  label: string;
  text: string;
  expression: Expression;
}
export function scriptBeats(lines: ScriptLine[], state: PublicState): Beat[] {
  const names: Record<string, string> = {
    gm: "猫咪城主",
    player: "青梅（你）",
    student: "阿瑟斯",
    sister: "七叶",
    engineer: "双子",
    visitor: "天降",
  };
  return lines.flatMap((d) =>
    (state.script?.edition ? [d.text] : paginate(d.text)).map((text) => ({
      speaker:
        d.speaker === "player"
          ? (state.character.avatar ?? "hero_f")
          : roleActor[d.speaker],
      label:
        d.speaker === "player"
          ? `${(state.script?.roleNames?.player ?? "主角").replace(/（你）|\(你\)/g, "")}（你）`
          : (state.script?.roleNames?.[d.speaker] ?? names[d.speaker]),
      text,
      expression: d.expression,
    })),
  );
}

// Punctuation-sized pages preserve the prose; no timed reading gate.
export function paginate(text: string, max = 108): string[] {
  const pieces = text.match(/[^。！？\n]+[。！？]?[”」]?|\n+/gu) ?? [];
  const pages: string[] = [];
  let page = "";
  for (const piece of pieces) {
    if (/^\n+$/.test(piece)) {
      if (page.trim()) pages.push(page.trim());
      page = "";
      continue;
    }
    if (page && Array.from(page + piece).length > max) {
      pages.push(page.trim());
      page = "";
    }
    const chars = Array.from(piece);
    while (chars.length > max) {
      if (page) {
        pages.push(page.trim());
        page = "";
      }
      pages.push(chars.splice(0, max).join(""));
    }
    page += chars.join("");
  }
  if (page.trim()) pages.push(page.trim());
  return pages;
}
const gm = (text: string, expression: Expression): Beat[] =>
  paginate(text).map((text) => ({
    speaker: "gm",
    label: "猫咪城主",
    text,
    expression,
  }));

// Only explicit speech is reassigned. Quoted contracts/signs stay with the GM.
export function authoredBeats(text: string, expression: Expression): Beat[] {
  const pattern = /阿岑说：“[^”]+”|“漏水、门禁、邻里纠纷？”他问。/gu;
  const beats: Beat[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    beats.push(...gm(text.slice(end, match.index), expression));
    const isLin = match[0].startsWith("阿岑");
    if (isLin) beats.push(...gm("阿岑说：", expression));
    beats.push({
      speaker: isLin ? "lin" : "zhou",
      label: isLin ? "阿岑 · 小林饰" : "老许 · 阿舟饰",
      text: isLin ? match[0].slice(4) : "“漏水、门禁、邻里纠纷？”",
      expression,
    });
    if (!isLin) beats.push(...gm("他问。", expression));
    end = match.index! + match[0].length;
  }
  beats.push(...gm(text.slice(end), expression));
  return beats;
}
export function makeBeats(
  state: PublicState,
  turn?: PublicTurn,
  live = false,
): Beat[] {
  if (state.script)
    return scriptBeats(
      turn?.result.scriptDialogue ?? state.script.opening,
      state,
    );
  const expression: Expression =
    turn?.result.outcome === "failure"
      ? "worried"
      : turn?.result.outcome === "success"
        ? "smile"
        : "neutral";
  let beats: Beat[];
  if (!turn)
    beats = [
      ...gm(
        "欢迎入座。我是这桌的猫咪城主。同桌伙伴会扮演故事里的人，你负责决定自己的行动。现在，翻开第一幕。",
        "smile",
      ),
      ...gm(state.facts.find((f) => f.id === "danger")?.text ?? "", "neutral"),
      ...authoredBeats(state.stage.intro, "neutral"),
    ];
  else if (
    (live || state.scenarioVersion?.startsWith("homecoming")) &&
    turn.narrationStatus === "ready" &&
    turn.narration
  ) {
    beats = [
      ...gm(turn.narration.reaction, expression),
      ...gm(turn.narration.description, expression),
    ];
    for (const line of turn.narration.dialogue) {
      const actor =
        line.roleId === "player"
          ? (state.character.avatar ?? "hero_f")
          : roleActor[line.roleId];
      const role = (
        turn.result.dialogueRoles ?? turn.result.render.characters
      ).find((c) => c.roleId === line.roleId);
      if (!actor || !role) {
        beats.push(...gm(line.text, expression));
        continue;
      }
      const tag = line.expressionId?.split(".").at(-1);
      const face: Expression = expressions.includes(tag as Expression)
        ? (tag as Expression)
        : expression;
      beats.push(
        ...paginate(line.text).map((text) => ({
          speaker: actor,
          label: `${role.name} · ${actors[actor].name}饰`,
          text,
          expression: face,
        })),
      );
    }
    if (state.scenarioVersion?.startsWith("homecoming"))
      for (const event of turn.result.events)
        if (event.type === "fact") beats.push(...gm(event.text, "neutral"));
  } else beats = authoredBeats(turn.result.fallback, expression);
  if (turn?.result.events.some((e) => e.type === "stage") && !state.ending)
    beats.push(
      ...gm(`下一幕，${state.stage.title}。${state.stage.intro}`, "neutral"),
    );
  if (state.ending)
    beats.push(
      ...gm(`这一局的答案：${state.ending.title}。`, expression),
      ...gm(state.ending.text, expression),
    );
  return beats.length
    ? beats
    : gm("故事已经保存。接下来，轮到你决定。", "neutral");
}
