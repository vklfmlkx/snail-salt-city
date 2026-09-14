import { isFixedScriptAction } from "../../src/domain/script-action";
import { test, expect } from "@playwright/test";
import { curatedBooks } from "../../src/content/curated";
import { readToEnd, finishArcade, chooseStory } from "./reading";
import { join } from "node:path";
import { tmpdir } from "node:os";
const practiceIndex = curatedBooks.findIndex(
  (b) => !!b.stages[0].activity?.game,
);
test("剧情内自然引入小游戏、空格触发、关闭再进、阅读位置与收藏恢复", async ({
  page,
}, info) => {
  const book = curatedBooks[practiceIndex],
    activity = book.stages[0].activity!;
  await page.goto("/");
  await chooseStory(page, practiceIndex);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".action-shortcut")).toBeDisabled();
  const cue = activity.intro.at(-1)!.text;
  for (
    let i = 0;
    i < 70 && (await page.locator(".dialogue-prose").innerText()) !== cue;
    i++
  )
    await page.getByRole("button", { name: "继续对话", exact: true }).click();
  await expect(page.locator(".dialogue-prose")).toHaveText(cue);
  expect(cue).not.toMatch(/猫咪城主|小游戏|节拍应援/);
  await page.locator(".dialogue-box").click({ position: { x: 20, y: 60 } });
  await page.keyboard.press("Space");
  await expect(page.locator(".arcade")).toBeVisible();
  const seed = await page.locator(".arcade").getAttribute("data-seed");
  await page.keyboard.press("Escape");
  await expect(page.locator(".action-shortcut")).toBeDisabled();
  await page.getByRole("button", { name: "继续对话", exact: true }).click();
  await expect(page.locator(".arcade")).toHaveAttribute("data-seed", seed!);
  await finishArcade(page);
  await expect(page.locator(".dialogue-prose")).toHaveText(cue);
  await page.reload();
  await page.getByRole("button", { name: "继续我的故事" }).click();
  await expect(page.locator(".dialogue-prose")).toHaveText(cue);
  await readToEnd(page);
  await page.locator(".action-shortcut").click();
  await expect(page.locator(".recommended button")).toHaveCount(
    book.stages[0].choices.length,
  );
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const me = await (await fetch("/api/me")).json(),
      headers = {
        "Content-Type": "application/json",
        "X-CSRF-Token": me.csrfToken,
        "X-Snail-Request": "1",
      };
    let state = (await (await fetch(`/api/sessions/${me.activeGameId}`)).json())
      .state;
    const post = async (path: string, body: unknown) =>
      await (
        await fetch(`/api/sessions/${state.id}/${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      ).json();
    for (let i = 0; i < 6 && state.status === "playing"; i++) {
      if (state.script?.activity?.game && state.script.activity.status === 0) {
        const q = await post("activity", {
          expectedStateVersion: state.version,
        });
        state = (
          await post("activity", {
            expectedStateVersion: state.version,
            challengeId: q.challenge.id,
            answers: [0],
          })
        ).state;
      }
      const p = await post("proposals", {
        expectedStateVersion: state.version,
        actionOptionId: state.actions.find((a: any) =>
          /^book\.s\d+\.key\.[^.]+$/.test(a.id),
        ).id,
      });
      state = (
        await post("turns", {
          expectedStateVersion: state.version,
          proposalId: p.proposal.id,
          clientTurnId: crypto.randomUUID(),
        })
      ).state;
    }
    if (state.status !== "ended") throw Error("ending_not_reached");
  });
  await page.reload();
  await page.getByRole("button", { name: "查看本局结局" }).click();
  await readToEnd(page);
  await page.locator(".action-shortcut").click();
  await expect(page.locator(".ending")).toContainText(
    /号好结局|号坏结局|真结局/,
  );
  await page.getByRole("button", { name: "回到封面", exact: true }).click();
  await page.getByRole("button", { name: "选择故事" }).click();
  await page.locator(".story-card").nth(practiceIndex).click();
  await expect(page.locator(".ending-shelf .unlocked")).toHaveCount(1);
  await page.locator(".ending-shelf .unlocked").click();
  await expect(page.locator(".ending-recap")).toContainText("最后一幕回顾");
  await page.screenshot({
    path: join(tmpdir(), `curated-${info.project.name}-collection.png`),
  });
});
test("书架每篇列出的选择与剧本一致，要求随故事变化", async ({ page }) => {
  await page.goto("/");
  await chooseStory(page, 18);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".chapter-plaque")).toContainText(
    curatedBooks[18].stages[0].title,
  );
  await readToEnd(page);
  await page.locator(".action-shortcut").click();
  const choices = page.locator(".recommended button");
  await expect(choices).toHaveCount(curatedBooks[18].stages[0].choices.length);
  for (const c of curatedBooks[18].stages[0].choices)
    await expect(page.locator(".recommended")).toContainText(c.label);
});

test("故事对决中途关闭重进继续同一段动画，不重复执行动作", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const index = curatedBooks.findIndex(
    (b) => b.stages[0].activity?.game === "roulette",
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.goto("/");
  await chooseStory(page, index);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  for (let i = 0; i < 80 && !(await page.locator(".arcade-modal").count()); i++)
    await page.getByRole("button", { name: "继续对话", exact: true }).click();
  await expect(page.locator(".arcade-roulette")).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole("button", { name: "开始挑战", exact: true }).click();
  await page.getByRole("button", { name: "朝对手试射", exact: true }).click();
  await page.clock.runFor(600);
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([k]) =>
      k.startsWith("snail:arcade:"),
    ),
  );
  expect(stored.find(([k]) => k.endsWith(":reveal"))?.[1]).toBe("0");
  await page.locator(".arcade-modal .modal-heading button").click();
  await expect(page.locator(".arcade-modal")).toHaveCount(0);
  await page.getByRole("button", { name: "继续对话", exact: true }).click();
  await page.getByRole("button", { name: "继续挑战", exact: true }).click();
  await expect(page.locator(".duel-turn")).toContainText("你");
  const board = page.locator(".arcade-roulette");
  for (
    let i = 0;
    i < 24 && (await board.getAttribute("data-animating")) === "true";
    i++
  )
    await page.clock.runFor(1201);
  await expect(board).toHaveAttribute("data-animating", "false");
  const replay = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([k]) =>
      k.startsWith("snail:arcade:"),
    ),
  );
  expect(replay).toHaveLength(1);
  expect(JSON.parse(replay[0][1])).toEqual([0]);
  expect(errors).toEqual([]);
  await page.clock.resume();
});
