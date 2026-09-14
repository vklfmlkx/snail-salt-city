import { test } from "node:test";
import assert from "node:assert/strict";
import { curatedBooks } from "../src/content/curated";
import {
  unquotedNarration,
  viewpointIssues,
} from "../src/content/narration-viewpoint";
import { validateProse } from "../src/server/generation/colloquial";
import { validateLocalLines } from "../src/content/script-book";

test("20篇精选的全部旁白分支、结局和小游戏反馈保持第二人称叙述", () => {
  assert.equal(curatedBooks.length, 20);
  for (const book of curatedBooks) {
    assert.ok(book.version.endsWith("1.3"));
    assert.deepEqual(viewpointIssues(book), [], book.title);
    validateProse(book);
    assert.ok(
      book.stages[0].opening
        .slice(0, 3)
        .every((l) => l.speaker === "gm" && l.text.includes("你")),
      book.title,
    );
  }
});

test("人物直接发言与嵌套原话保留我，不得机械替换", () => {
  assert.deepEqual(
    viewpointIssues([
      { speaker: "player", text: "我去看看，你留在这里。" },
      { speaker: "sister", text: "我妹妹还在屋里。" },
      {
        speaker: "gm",
        text: "你看见妹妹举起纸条：“上面写着『我回来了』。”你把纸条收好。",
      },
      { speaker: "gm", text: "妹妹走了过来，她看起来有些担心。你收起手机。" },
    ]),
    [],
  );
  assert.equal(
    unquotedNarration("你听见“他说「我来」。”然后开门。"),
    "你听见然后开门。",
  );
  assert.ok(
    viewpointIssues({ speaker: "gm", text: "我走到窗边，想起刚才的话。" })
      .length,
  );
  assert.ok(
    viewpointIssues({ speaker: "gm", text: "“半截引号。然后我走到窗边。" })
      .length,
  );
});

test("生成稿的远端结局和路由衔接也参与人称检查", () => {
  for (const part of ["ending", "bridge", "activity"]) {
    const book = structuredClone(curatedBooks[2]);
    const wrong = {
      speaker: "gm" as const,
      expression: "neutral" as const,
      text: "我走出门，回头看了一眼。",
    };
    if (part === "ending") book.endings[0].dialogue.push(wrong);
    if (part === "bridge")
      book.stages[0].choices[0].routes!.success.bridge.push(wrong);
    if (part === "activity") book.stages[0].activity!.failure.push(wrong);
    assert.throws(() => validateProse(book), /gm_viewpoint/);
  }
});

test("自由行动城主偏离人称时拒收，不改写人物原话", () => {
  const stage = curatedBooks[2].stages[0];
  const lines = [
    {
      speaker: "gm" as const,
      expression: "neutral" as const,
      text: "你轻轻推开门。李宇说：“我听见你了。”",
    },
  ];
  const plan = {
    conditions: ["门未上锁"],
    branches: { success: lines, partial: lines, failure: lines },
  };
  assert.equal(validateLocalLines(plan, stage), plan);
  const bad = structuredClone(plan);
  bad.branches.failure[0].text = "我推门的时候碰翻了杯子。";
  assert.throws(() => validateLocalLines(bad, stage), /local_gm_viewpoint/);
});
