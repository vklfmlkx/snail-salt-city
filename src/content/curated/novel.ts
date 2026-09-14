import type { ScriptBook, ScriptLine } from "../script-book";
import { gameNames } from "../../domain/arcade";
const gamesByAttribute = {
  body: ["sokoban", "hanoi"],
  agility: ["dodge", "catch"],
  mind: ["pipes", "slide"],
  presence: ["rhythm", "groups"],
} as const;
import { novelSpeech } from "./novel-speech";
export type NovelNotes = {
  prologue: [string, string, string];
  scenes: [string, string, string][];
};
const gm = (text: string): ScriptLine => ({
  speaker: "gm",
  expression: "neutral",
  text,
});
/** Authored revision. Keep the old edition immutable for existing saves. */
export function novelEdition(
  base: ScriptBook,
  notes: NovelNotes,
  bookIndex: number,
): ScriptBook {
  if (notes.scenes.length !== base.stages.length)
    throw Error("missing_scene_revision");
  const book = structuredClone(base);
  book.version = base.version.replace(/1\.0$/, "1.1");
  book.stages = book.stages.map((stage, i) => {
    if (bookIndex === 18 && i === 1)
      stage.activity = structuredClone(base.stages[0].activity!);
    const [entry, intent, middle] = notes.scenes[i];
    const original = stage.opening.slice(1).map((l) => ({ ...l }));
    const firstPlayer = original.find((l) => l.speaker === "player")!;
    firstPlayer.text = intent;
    for (const [j, role] of ["student", "sister"].entries()) {
      const speech = original.find((l) => l.speaker === role);
      if (!speech || !novelSpeech[bookIndex]?.[i]?.[j])
        throw Error("missing_character_revision");
      speech.text += novelSpeech[bookIndex][i][j];
    }
    const opening = [
      ...(i === 0 ? notes.prologue.map(gm) : []),
      gm(entry),
      ...original.slice(0, 9),
      gm(middle),
    ];
    if (stage.activity) {
      const game =
        gamesByAttribute[stage.activity.attribute][(bookIndex + i) % 2];
      // These are explicitly tabletop interludes; no crates or arcade machines materialize in the fictional world.
      const intro = [
        gm(
          `讲到这里，猫咪城主把故事暂时停在“${stage.title}”这一刻，将${gameNames[game]}的小棋盘放到桌上。你将用一局小游戏体验眼前行动需要的${{ body: "稳妥搬运", agility: "灵活反应", mind: "观察与规划", presence: "配合与节奏" }[stage.activity.attribute]}。`,
        ),
        gm(
          "同桌的伙伴为你让出位置。向前翻页就进入小游戏；完成这一局后，故事会从这里接着讲，输掉也不会让处境变坏。",
        ),
      ];
      opening.push(...intro);
      stage.activity = {
        ...stage.activity,
        game,
        title: gameNames[game],
        intro,
        afterLine: opening.length,
        success: [
          gm(
            `这一局${gameNames[game]}顺利完成。猫咪城主收起棋盘，你把刚才找到的手感记了下来，准备回到故事里的抉择。`,
          ),
          {
            speaker: "player",
            expression: "smile",
            text: "找到诀窍以后，确实比一开始顺手多了。继续吧，眼前的事情还等着我们决定。",
          },
        ],
        failure: [
          gm(
            `这一局${gameNames[game]}没能完成目标。猫咪城主把棋盘收回盒里，没有改动角色卡上的属性，故事中的人物仍在原处等着你。`,
          ),
          {
            speaker: "player",
            expression: "neutral",
            text: "这次没做好，不过我知道哪里容易出错了。我们接着讲，不用为了这一局一直停在这里。",
          },
        ],
      };
    }
    stage.opening = [...opening, ...original.slice(9)];
    stage.knownFacts = [
      ...stage.knownFacts,
      entry,
      ...(i === 0 ? notes.prologue : []),
    ];
    return stage;
  });
  return book;
}
