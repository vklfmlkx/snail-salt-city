import type { Manuscript, Review } from "../src/server/generation/schema";
import { REVIEW_KEYS } from "../src/server/generation/schema";
import type { StorySource } from "../src/server/zhihu-stories";
export const sourceFixture: StorySource = {
  workId: "synthetic",
  title: "合成素材",
  author: "测试",
  labels: ["脑洞"],
  introduction: "离线合成数据",
  content: "用于离线流程验证，不是网络故事。".repeat(20),
  sourceUrl: "https://example.invalid/synthetic",
  fetchedAt: "2026-09-13T00:00:00.000Z",
  sha256: "a".repeat(64),
};
export const goodReview: Review = {
  verdict: "pass",
  checks: REVIEW_KEYS.map((key) => ({
    key,
    score: 5,
    evidence: "/nodes/0 已检查合成测试结构",
  })),
  issues: [],
};
export function fixtureBook(): Manuscript {
  const dialogue = (
    prefix: string,
    n: number,
  ): Manuscript["nodes"][number]["dialogue"] =>
    Array.from({ length: n }, (_, i) => [
      i === 0 ? "gm" : i % 2 ? "player" : "student",
      "neutral",
      `${prefix}：第${i + 1}句完整的合成对白，大家讨论眼前应该如何行动。`,
    ]);
  const book: Manuscript = {
    format: "vn-book-1",
    title: "合成分支剧本",
    logline: "这是自动管线的离线合成故事，不使用付费服务。",
    bible: {
      truth: "两条线索共同揭示谜题，玩家决定是离开还是留下。",
      rules: ["线索只能通过检查发现。", "角色必须在场才能说话。"],
      cast: [
        {
          id: "gm",
          name: "猫咪城主",
          identity: "桌外主持人",
          voice: "简洁地交代环境",
        },
        {
          id: "player",
          name: "小雨",
          identity: "来访的侦探",
          voice: "认真发问",
        },
        {
          id: "student",
          name: "阿墨",
          identity: "图书管理员",
          voice: "务实地回答",
        },
      ],
    },
    facts: [
      { id: "f1", text: "旧账本记载了钥匙去向。" },
      { id: "f2", text: "暗门上的标记对应旧账本。" },
    ],
    nodes: [],
    endings: [],
  };
  const outcome = (to: string, name: string, grants: string[] = []) => ({
    to,
    grants,
    dialogue: dialogue(name, 2),
  });
  for (let i = 1; i <= 6; i++)
    book.nodes.push({
      id: `n${i}`,
      title: `合成节点${i}`,
      time: i,
      when: `第${i}刻`,
      location: "旧图书馆",
      present: ["gm", "player", "student"],
      requires: [],
      reveals: [],
      dialogue: dialogue(`节点${i}`, 10),
      choices: ["body", "agility", "mind", "presence"].map((stat) => ({
        stat,
        goal: `用${stat}调查眼前的线索`,
        risk: "失败可能走向补救或提前结束。",
        success: outcome(`n${Math.min(i + 1, 6)}`, `${i}${stat}成功`),
        partial: outcome(`n${Math.min(i + 1, 6)}`, `${i}${stat}部分`),
        failure: outcome(`n${Math.min(i + 1, 6)}`, `${i}${stat}失败`),
      })) as Manuscript["nodes"][number]["choices"],
    });
  book.nodes[0].choices[1].success.to = "n3";
  book.nodes[0].choices[2].failure.to = "bad_1";
  book.nodes[1].choices.forEach((c) => {
    c.success.to = "n4";
    c.success.grants = ["f1"];
  });
  book.nodes[2].choices.forEach((c) => {
    c.success.to = "n4";
    c.success.grants = ["f1"];
  });
  book.nodes[2].choices[2].failure.to = "bad_2";
  book.nodes[3].choices.forEach((c) => (c.success.grants = ["f2"]));
  for (const [i, c] of book.nodes[5].choices.entries())
    for (const o of [c.success, c.partial, c.failure])
      o.to = i === 0 ? "good_1" : i === 1 ? "good_2" : "bad_3";
  book.nodes[5].choices[2].success = {
    ...outcome("true", "读出完整真相"),
    whenAll: ["f1", "f2"],
    otherwise: "good_1",
  };
  for (const id of [
    "good_1",
    "good_2",
    "bad_1",
    "bad_2",
    "bad_3",
    "true",
  ] as const)
    book.endings.push({
      id,
      title: `合成结局${id}`,
      time: 10,
      when: "当天傍晚",
      location: "旧图书馆",
      present: ["gm", "player", "student"],
      requires: id === "true" ? ["f1", "f2"] : [],
      dialogue: dialogue(id, 12),
    });
  return book;
}
