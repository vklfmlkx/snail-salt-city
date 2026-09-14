import { test, expect } from "@playwright/test";
import { arcadeGames, gameNames } from "../../src/domain/arcade";
import { solveArcade } from "../helpers/arcade";
import { FRAME_MS } from "../../src/domain/pixel-arcade";
import { playPixel } from "../../src/domain/pixel-arcade";
import { join } from "node:path";
import { tmpdir } from "node:os";
for (const game of arcadeGames)
  test(`像素试玩 ${game}：真实操作、结果和重新生成`, async ({ page }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install();
    await page.goto("/");
    await expect(page).toHaveTitle(/蜗牛/);
    await page.getByRole("button", { name: "小游戏广场", exact: true }).click();
    await page
      .getByRole("button", { name: gameNames[game], exact: true })
      .click();
    const board = page.locator(`.arcade-${game}`);
    await expect(board.locator("canvas")).toBeVisible();
    const seed = Number(await board.getAttribute("data-seed"));
    const moves = solveArcade({
      game,
      seed,
      difficulty: "normal",
      rulesVersion: 3,
    });
    await board.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(tmpdir(), `pixel-${info.project.name}-${game}.png`),
    });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.getByRole("button", { name: "开始挑战", exact: true }).click();
    await expect(board.locator(".arcade-instruction")).toHaveCount(0);
    if (game === "summit" || game === "flight") {
      let previous = 0;
      for (const code of moves) {
        const input = Math.floor(code / 64),
          count = (code % 64) + 1;
        if (game === "summit") {
          for (const [bit, key] of [
            [1, "ArrowLeft"],
            [2, "ArrowRight"],
          ] as const) {
            if (input & bit && !(previous & bit)) await page.keyboard.down(key);
            if (!(input & bit) && previous & bit) await page.keyboard.up(key);
          }
          if (input & 4) await page.keyboard.press("KeyZ");
          if (input & 8) await page.keyboard.press("ShiftLeft");
        } else if (input)
          await page
            .getByRole("button", { name: "拍动翅膀", exact: true })
            .click();
        previous = input;
        await page.clock.runFor(count * FRAME_MS + 0.001);
      }
      await page.keyboard.up("ArrowRight");
      await page.clock.resume();
    } else
      for (const move of moves) {
        if (game === "rally") {
          await page
            .getByRole("button", {
              name:
                move === 4
                  ? /^呼哨/
                  : ["↑ 上移", "右移 →", "↓ 下移", "← 左移"][move],
              exact: move !== 4,
            })
            .click();
        } else if (move < 2)
          await page
            .getByRole("button", {
              name: move === 0 ? "朝对手试射" : "朝自己试射",
              exact: true,
            })
            .click();
        else {
          await page.getByRole("button", { name: /^道具 / }).click();
          await page
            .locator(".duel-controls .pixel-controls")
            .nth(1)
            .getByRole("button")
            .nth(move - 2)
            .click();
        }
        while ((await board.getAttribute("data-animating")) === "true")
          await page.clock.runFor(1201);
      }
    await page.clock.resume();
    await expect(board.getByRole("status")).toBeVisible();
    if (game !== "roulette")
      await expect(board.getByRole("status")).toContainText("成功");
    await page.screenshot({
      path: join(tmpdir(), `pixel-${info.project.name}-${game}-result.png`),
    });
    await page.getByRole("button", { name: /查看成绩|结束这局/ }).click();
    await expect(page.getByRole("status")).toContainText("再来一局");
    await page.getByRole("button", { name: "重新开一局", exact: true }).click();
    await expect(board).toHaveAttribute("data-tick", "0");
    expect(
      await page.evaluate(() => localStorage.getItem("snail:last-game")),
    ).toBeNull();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

test("飞行暂停、失败反馈；方向操作不会翻过剧情", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "小游戏广场", exact: true }).click();
  await page.getByRole("button", { name: "穿云信使", exact: true }).click();
  await page.getByRole("button", { name: "开始挑战", exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.locator(".pixel-arcade").getAttribute("data-tick")),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const tick = await page.locator(".pixel-arcade").getAttribute("data-tick");
  await page.waitForTimeout(250);
  await expect(page.locator(".pixel-arcade")).toHaveAttribute(
    "data-tick",
    tick!,
  );
  await page.getByRole("button", { name: "继续挑战", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("下次再来");
});

test("触屏双指可一边移动一边跳跃，松手后不继续横移", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "小游戏广场", exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole("button", { name: "开始挑战", exact: true }).click();
  const right = page.getByRole("button", { name: "右移 →", exact: true });
  await right.scrollIntoViewIfNeeded();
  const r = (await right.boundingBox())!,
    j = (await page
      .getByRole("button", { name: "跳跃 Z", exact: true })
      .boundingBox())!;
  const a = { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 },
    b = { x: j.x + j.width / 2, y: j.y + j.height / 2, id: 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [a],
  });
  await page.clock.runFor(FRAME_MS * 6 + 0.001);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [a, b],
  });
  await page.clock.runFor(FRAME_MS * 3 + 0.001);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.clock.runFor(FRAME_MS * 6 + 0.001);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const moves = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) =>
      k.startsWith("snail:arcade:playground-"),
    )!;
    return JSON.parse(sessionStorage.getItem(key)!);
  });
  expect(
    moves.some((code: number) => Math.floor(code / 64) === 6),
    JSON.stringify({ r, j, moves }),
  ).toBe(true);
  const seed = Number(
    await page.locator(".pixel-arcade").getAttribute("data-seed"),
  );
  const state = playPixel("summit", seed, moves, "normal");
  expect(state.x).toBeGreaterThan(25);
  expect(state.vx).toBe(0);
  expect(state.y).toBeLessThan(215);
  await page.clock.resume();
});

test("广场三档难度、独立说明和画面内按键", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator(".start-panel")).toContainText("小游戏广场");
  await expect(page.getByText("无需登录", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "小游戏广场", exact: true }).click();
  await expect(
    page.getByText("这里是故事中的小游戏。挑一款，单独玩一局。"),
  ).toBeVisible();
  for (const [name, value] of [
    ["体验剧情", "story"],
    ["命运掷骰", "normal"],
    ["逆风跑团", "hard"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".pixel-arcade")).toHaveAttribute(
      "data-difficulty",
      value,
    );
  }
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  for (const game of arcadeGames) {
    await page
      .getByRole("button", { name: gameNames[game], exact: true })
      .click();
    await expect(page.locator(".arcade-instruction")).toBeVisible();
    await page.getByRole("button", { name: "开始挑战", exact: true }).click();
    await expect(page.locator(".arcade-instruction")).toHaveCount(0);
    const screen = (await page.locator(".pixel-screen").boundingBox())!;
    for (const button of await page.locator(".pixel-screen button").all()) {
      if (!(await button.isVisible())) continue;
      const b = (await button.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(screen.x);
      expect(b.y).toBeGreaterThanOrEqual(screen.y);
      expect(b.x + b.width).toBeLessThanOrEqual(screen.x + screen.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(screen.y + screen.height + 1);
    }
    await page.screenshot({
      path: join(tmpdir(), `pixel-${info.project.name}-${game}-playing.png`),
    });
  }
  await page.clock.resume();
});

test("对决按顺序展示动作，动画中禁止操作并支持暂停", async ({ page }, info) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "小游戏广场", exact: true }).click();
  await page.getByRole("button", { name: "弹仓对决", exact: true }).click();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole("button", { name: "开始挑战", exact: true }).click();
  const board = page.locator(".arcade-roulette");
  const seed = Number(await board.getAttribute("data-seed")),
    expected = playPixel("roulette", seed, [0], "normal");
  await page.getByRole("button", { name: "朝对手试射", exact: true }).click();
  await expect(board).toHaveAttribute("data-animating", "true");
  await expect(
    page.getByRole("button", { name: "朝对手试射", exact: true }),
  ).toBeDisabled();
  await page.clock.runFor(300);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = await board
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.clock.runFor(5000);
  expect(
    await board
      .locator("canvas")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).toBe(paused);
  await page.getByRole("button", { name: "继续挑战", exact: true }).click();
  await page.clock.runFor(910);
  await expect(page.locator(".duel-turn")).toContainText("对手");
  await page.clock.runFor(800);
  await page.screenshot({
    path: join(tmpdir(), `pixel-${info.project.name}-opponent-action.png`),
  });
  for (
    let i = 0;
    i < 24 && (await board.getAttribute("data-animating")) === "true";
    i++
  )
    await page.clock.runFor(1201);
  await expect(board).toHaveAttribute("data-animating", "false");
  await expect(board).toHaveAttribute("data-tick", String(expected.tick));
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([k]) =>
      k.startsWith("snail:arcade:"),
    ),
  );
  expect(stored).toHaveLength(1);
  expect(JSON.parse(stored[0][1])).toEqual([0]);
  await page.clock.resume();
});
