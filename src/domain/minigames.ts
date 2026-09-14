import type { Attribute } from "./types";
import type { ArcadeDifficulty } from "./arcade-difficulty";
import {
  gameNames,
  gamesByAttribute,
  playArcade,
  type ArcadeGame,
} from "./arcade";
export type Challenge = {
  difficulty?: ArcadeDifficulty;
  rulesVersion?: number;
  id: string;
  game?: ArcadeGame;
  seed?: number;
  kind: Attribute;
  prompt: string;
  values: number[];
  target: number;
  questions?: { text: string; options: string[] }[];
};
const questions = [
  {
    text: "同伴说“我怕拖累大家”。你先怎样回应？",
    options: [
      "保证绝对不会失败",
      "问清担心哪一步，再一起分工",
      "替他答应所有任务",
    ],
    answer: 1,
  },
  {
    text: "有人打断你的说明。怎样把话说完整？",
    options: [
      "具体请求让我先说完这一点",
      "立刻提高音量压过他",
      "什么也不说并默认同意",
    ],
    answer: 0,
  },
  {
    text: "对方提出超过能力的请求。你怎样回答？",
    options: [
      "先答应，以后再说",
      "责怪对方不体谅",
      "说明做不到的部分，提出能做的替代",
    ],
    answer: 2,
  },
  {
    text: "朋友说“我现在不想讲”。怎样回应？",
    options: [
      "给空间，说明需要时可以来找我",
      "继续追问直到得到答案",
      "替他猜一个原因并公开",
    ],
    answer: 0,
  },
  {
    text: "讨论里有两种不同意见。下一步是什么？",
    options: ["选声音最大的", "先复述各自目的，确认分歧", "直接宣布双方都不对"],
    answer: 1,
  },
];
export function makeChallenge(
  id: string,
  kind: Attribute,
  seed: number,
  game?: ArcadeGame,
  difficulty?: ArcadeDifficulty,
): Challenge {
  if (game) {
    if (!gamesByAttribute[kind].includes(game))
      throw Error("wrong_game_attribute");
    return {
      id,
      kind,
      game,
      ...(difficulty ? { difficulty, rulesVersion: 3 } : {}),
      seed,
      values: [],
      target: 0,
      prompt: gameNames[game],
    };
  }
  if (kind === "body") {
    const values = Array.from({ length: 6 }, (_, i) => i + 1 + (seed % 3));
    return {
      id,
      kind,
      values,
      target: values[0] + values[2] + values[5],
      prompt: "配重训练：选择恰好3只砝码，使总重量等于目标。每只只能用一次。",
    };
  }
  if (kind === "agility")
    return {
      id,
      kind,
      values: Array.from(
        { length: 5 },
        (_, i) => Math.floor(seed / 4 ** i) % 4,
      ),
      target: 5,
      prompt:
        "步法训练：记住5个方向。点击“开始回忆”隐藏路线，再按顺序点击方向。",
    };
  if (kind === "mind") {
    const step = 2 + (seed % 4),
      start = 1 + (seed % 9);
    return {
      id,
      kind,
      values: [start, start + step, start + 2 * step, start + 3 * step],
      target: 0,
      prompt: "推理训练：这组数遵循固定的相同增量。填出下一个数。",
    };
  }
  const selected = [0, 1, 2].map(
    (i) => questions[(seed + i) % questions.length],
  );
  return {
    id,
    kind,
    values: [seed % questions.length],
    target: 3,
    prompt: "沟通训练：3个小情境，选择既尊重自己也尊重同伴的回应。",
    questions: selected.map(({ text, options }) => ({ text, options })),
  };
}
export function gradeChallenge(c: Challenge, answers: number[]) {
  if (c.game) {
    const s = playArcade(
      {
        game: c.game,
        seed: c.seed ?? 0,
        difficulty: c.difficulty,
        rulesVersion: c.rulesVersion,
      },
      answers,
    );
    return s.valid && s.finished && s.success;
  }
  if (!Array.isArray(answers) || answers.some((n) => !Number.isSafeInteger(n)))
    return false;
  if (c.kind === "body")
    return (
      answers.length === 3 &&
      new Set(answers).size === 3 &&
      answers.every((i) => i >= 0 && i < c.values.length) &&
      answers.reduce((n, i) => n + c.values[i], 0) === c.target
    );
  if (c.kind === "agility")
    return answers.length === 5 && answers.every((x, i) => x === c.values[i]);
  if (c.kind === "mind")
    return (
      answers.length === 1 &&
      answers[0] === c.values[3] + c.values[1] - c.values[0]
    );
  return (
    answers.length === 3 &&
    answers.every(
      (x, i) => x === questions[(c.values[0] + i) % questions.length].answer,
    )
  );
}
