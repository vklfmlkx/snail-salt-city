import { test, expect } from "@playwright/test";
import { chooseStory, finishArcade } from "./reading";
import { curatedBooks } from "../../src/content/curated";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("宽屏角色卡无需滚动，姓名背景删除，主角对白标注你", async ({
  page,
}, info) => {
  if (info.project.name === "desktop")
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
      [2560, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await chooseStory(page);
      await expect(page.locator(".creation")).toBeVisible();
      await page.screenshot({
        path: join(tmpdir(), `release-${width}-character.png`),
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight - innerHeight,
        ),
      ).toBeLessThanOrEqual(1);
    }
  else {
    await page.goto("/");
    await chooseStory(page);
  }
  await expect(page.getByLabel("你的名字")).toHaveCount(0);
  await expect(page.getByLabel("一句背景")).toHaveCount(0);
  await page.screenshot({
    path: join(tmpdir(), `release-${info.project.name}-character.png`),
  });
  await page.getByRole("button", { name: "男主角", exact: true }).click();
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  for (
    let i = 0;
    i < 30 &&
    !(await page.locator(".speaker-tag").innerText()).includes("（你）");
    i++
  ) {
    await page.getByRole("button", { name: "继续对话", exact: true }).click();
    if (await page.locator(".arcade-modal").count()) await finishArcade(page);
  }
  await expect(page.locator(".speaker-tag")).toContainText("（你）");
});
test("三类书架、完整剧本、分享下架、重生成描述与满栏提示", async ({
  page,
}, info) => {
  const b = curatedBooks[0],
    privateVersion = "generated-aaaaaaaaaaaaaaaaaaaaaaaa",
    sharedVersion = "generated-bbbbbbbbbbbbbbbbbbbbbbbb";
  let shared = false,
    deleted = false,
    calls: string[] = [];
  const own = {
    version: privateVersion,
    title: "我的小故事",
    description: "自己的故事",
    stages: b.stages.length,
    dialogueLines: 80,
    source: { ...b.source, tags: ["悬疑", "脑洞"] },
    endingCategories: b.endings.map((e) => ({
      id: e.id,
      category: e.category,
      label: e.title,
    })),
    category: "personal",
    mine: true,
    canRead: true,
  };
  await page.route("**/api/scenarios", async (route) => {
    const r = await route.fetch(),
      data = await r.json();
    await route.fulfill({
      json: {
        scenarios: [
          ...data.scenarios,
          ...(!deleted ? [own] : []),
          ...(shared
            ? [
                {
                  ...own,
                  version: sharedVersion,
                  title: "社区小故事",
                  category: "community",
                },
              ]
            : []),
        ],
      },
    });
  });
  await page.route("**/api/books/**", async (route) => {
    const p = new URL(route.request().url()).pathname.split("/").at(-1)!;
    calls.push(p);
    if (p === "publish") shared = true;
    if (p === "unpublish") shared = false;
    if (p === "delete") deleted = true;
    await route.fulfill({
      json: p === "manuscript" ? { book: b } : { ok: true },
    });
  });
  await page.route("**/api/generation", async (route) => {
    if (route.request().method() === "POST") {
      const v = route.request().postDataJSON();
      expect(v.description).toBe("希望是轻松的猫咪侦探故事");
      expect(v.replaceVersion).toBe(privateVersion);
      calls.push("regenerate");
      await route.fulfill({ json: { job: { id: v.id } } });
    } else
      await route.fulfill({
        json: {
          tags: ["悬疑", "脑洞", "科幻"],
          enabled: true,
          count: 20,
          jobs: [],
          dailyRemaining: 6,
          dailyLimit: 6,
          requiresLogin: false,
          oauthReady: true,
          slots: [1, 2, 3].map((i) => ({
            slot: i,
            version: i === 1 ? privateVersion : `generated-${i}`,
            title: `私人稿${i}`,
          })),
        },
      });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "选择故事", exact: true }).click();
  await expect(page.locator(".story-card")).toHaveCount(20);
  await page.getByRole("button", { name: "自生成剧本", exact: true }).click();
  await expect(page.locator(".story-card")).toHaveCount(1);
  await page.locator(".story-card").click();
  await page.getByRole("button", { name: "查看完整剧本", exact: true }).click();
  await expect(page.locator(".manuscript")).toBeVisible();
  await page.locator(".manuscript > details > summary").first().click();
  await expect(page.locator(".manuscript")).toContainText(
    b.stages[0].opening[0].text,
  );
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await page.getByRole("button", { name: "社区剧本", exact: true }).click();
  await page.getByRole("button", { name: "上传剧本", exact: true }).click();
  await page
    .locator(".upload-choices")
    .getByRole("button", { name: "我的小故事", exact: true })
    .click();
  expect(calls).not.toContain("publish");
  await page.getByRole("button", { name: "确认分享", exact: true }).click();
  await page.getByRole("button", { name: "社区剧本", exact: true }).click();
  await page.getByRole("button", { name: "上传剧本", exact: true }).click();
  await expect(page.locator(".community-upload")).toContainText("请先下架");
  await page.locator(".story-card").click();
  await expect(
    page.getByRole("button", { name: "重新生成", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "下架社区剧本", exact: true }).click();
  await page.getByRole("button", { name: "确认下架", exact: true }).click();
  await page.getByRole("button", { name: "自生成剧本", exact: true }).click();
  await page.locator(".story-card").click();
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await page.getByLabel("这次想怎样改写？").fill("字".repeat(501));
  await expect(page.getByLabel("这次想怎样改写？")).toHaveValue(
    "字".repeat(500),
  );
  await page.getByLabel("这次想怎样改写？").fill("希望是轻松的猫咪侦探故事");
  await page
    .getByRole("button", { name: "重新生成（消耗1次）", exact: true })
    .click();
  expect(calls).toContain("regenerate");
  await page.getByRole("button", { name: "返回书架", exact: true }).click();
  await page.getByRole("button", { name: "自生成剧本", exact: true }).click();
  await page.getByRole("button", { name: "生成新故事 →", exact: true }).click();
  await expect(page.locator(".generator-page [role=alert]")).toContainText(
    "三个栏位已满",
  );
  await expect(
    page.getByRole("button", { name: "生成故事（消耗1次）", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: join(tmpdir(), `release-${info.project.name}-generator.png`),
  });
});
