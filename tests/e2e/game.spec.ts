import { curatedBooks } from "../../src/content/curated";
import { readToEnd, chooseStory } from "./reading";
import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
const evidence = process.env.SNAIL_EVIDENCE_DIR ?? tmpdir();
async function enter(page: Page) {
  await page.goto("/");
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.getByRole("region", { name: "剧情对话" })).toBeVisible();
}
async function actions(page: Page) {
  await readToEnd(page);
  await page.getByRole("button", { name: "决定行动", exact: true }).click();
}
async function result(page: Page) {
  const dice = page.getByRole("dialog", { name: "命运的骰子" });
  if (await dice.count()) await dice.locator(".modal-heading button").click();
  await page.getByRole("button", { name: "本回合骰点" }).click();
}
async function close(page: Page) {
  await page.locator("dialog[open] .modal-heading button").click();
}

test("fixed choice survives lost commit response and retries exact saved result", async ({
  page,
}) => {
  await enter(page);
  await actions(page);
  await expect(page.locator(".free-input")).toHaveCount(0);
  await page.locator(".recommended button").first().click();
  let savedDie: number | null = null;
  await page.route(
    "**/api/sessions/*/turns",
    async (route) => {
      const response = await route.fetch();
      savedDie = (await response.json()).turn.result.die;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: /确认并行动/ }).click();
  await expect(
    page.getByRole("button", { name: "重试这次行动" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "重试这次行动" }).click();
  await expect(page.locator(".progress")).toContainText("第1回合");
  await result(page);
  await expect(page.locator(".result-card")).toContainText(`d10 ${savedDie}`);
  await close(page);
  await readToEnd(page);
  await expect(page.getByRole("button", { name: "重试这次行动" })).toHaveCount(
    0,
  );
});

test("cover, visual novel, preview, cancel, commit, refresh, history and offline network", async ({
  page,
}, testInfo) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://localhost:3100") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/蜗牛与盐选城/);
  const cover = page.getByRole("img", { name: /巨型蜗牛/ });
  await expect(cover).toBeVisible();
  expect(
    await cover.evaluate((e: HTMLImageElement) => [
      e.naturalWidth,
      e.naturalHeight,
      e.complete,
    ]),
  ).toEqual([1683, 935, true]);
  expect(await cover.evaluate((e) => getComputedStyle(e).objectFit)).toBe(
    "contain",
  );
  await page.screenshot({
    path: join(evidence, `tabletop-${testInfo.project.name}-cover.png`),
    animations: "disabled",
  });
  await chooseStory(page);
  await expect(page.getByLabel("你的名字")).toHaveCount(0);
  await expect(page.getByLabel("一句背景")).toHaveCount(0);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(
    page.getByRole("heading", { name: curatedBooks[0].stages[0].title }),
  ).toBeVisible();
  await expect(page.locator(".speaker-tag")).toHaveText("猫咪城主");
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((i) => i.decode().catch(() => {})),
    );
  });
  expect(await page.locator(".portrait img").count()).toBe(1);
  expect(
    await page
      .locator(".portrait img")
      .evaluateAll((nodes) =>
        nodes.every((n) => (n as HTMLImageElement).naturalWidth > 0),
      ),
  ).toBe(true);
  await page.screenshot({
    path: join(evidence, `tabletop-${testInfo.project.name}-game.png`),
    animations: "disabled",
  });
  await actions(page);
  await page.locator(".recommended button").first().click();
  await expect(page.getByRole("region", { name: "行动预览" })).toBeVisible();
  await expect(page.locator(".preview")).toBeFocused();
  await page.screenshot({
    path: join(evidence, `tabletop-${testInfo.project.name}-preview.png`),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "取消预览" }).click();
  await expect(page.locator(".progress")).toContainText("第0回合");
  await page.locator(".recommended button").first().click();
  await page.getByRole("button", { name: /确认并行动/ }).click();
  await expect(page.getByRole("dialog", { name: "命运的骰子" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "命运的骰子" })
    .locator(".modal-heading button")
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".progress")).toContainText("第1回合");
  await result(page);
  await expect(page.getByRole("region", { name: "本回合结果" })).toContainText(
    "这个结果已保存",
  );
  const saved = await page.locator(".result-card p").textContent();
  await page.reload();
  // A low roll can legitimately end the book at its first decision.
  await page.getByRole("button", { name: /继续我的故事|查看本局结局/ }).click();
  await result(page);
  expect(await page.locator(".result-card p").textContent()).toEqual(saved);
  await close(page);
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.locator(".dialogue-log article").first()).toBeVisible();
  expect(await page.locator(".dialogue-log article").count()).toBeGreaterThan(
    12,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("reading cursor, keyboard, modal focus, reusable rooms and expressions", async ({
  page,
}, testInfo) => {
  await enter(page);
  const first = await page.locator(".dialogue-prose").textContent();
  await page.getByRole("button", { name: "继续对话" }).click();
  const second = await page.locator(".dialogue-prose").textContent();
  expect(second).not.toEqual(first);
  await page.reload();
  await page.getByRole("button", { name: "继续我的故事" }).click();
  await expect(page.locator(".dialogue-prose")).toHaveText(second!);
  await page.getByRole("button", { name: "上一段" }).click();
  await expect(page.locator(".dialogue-prose")).toHaveText(first!);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".dialogue-prose")).toHaveText(second!);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("加大正文字号").check();
  await page.getByRole("button", { name: "私语角", exact: true }).click();
  await expect(page.locator(".room-art")).toHaveAttribute(
    "src",
    "/assets/tabletop/v1/nook.png",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "设置", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".progress")).toContainText("第0回合");
  const proseBox = await page.locator(".dialogue-prose").boundingBox();
  const footBox = await page.locator(".dialogue-foot").boundingBox();
  expect(proseBox!.y + proseBox!.height).toBeLessThanOrEqual(footBox!.y);
  await page.getByRole("button", { name: "同桌伙伴" }).click();
  for (const actor of ["猫咪城主", "小林", "阿舟"]) {
    await page
      .locator(".cast-selector")
      .first()
      .getByRole("button", { name: actor, exact: true })
      .click();
    for (const expression of ["平静", "微笑", "担心"]) {
      await page.getByRole("button", { name: expression, exact: true }).click();
      expect(
        await page
          .locator(".cast-gallery .sprite-portrait>img")
          .evaluate(async (e: HTMLImageElement) => {
            await e.decode();
            return e.naturalWidth > 0;
          }),
      ).toBe(true);
    }
  }
  await close(page);
  await page.getByRole("button", { name: "欣赏画面" }).click();
  await expect(page.locator(".dialogue-box")).toBeHidden();
  await page.screenshot({
    path: join(evidence, `tabletop-${testInfo.project.name}-nook.png`),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "返回对话" }).click();
  await expect(page.locator(".dialogue-box")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("irreversible ending uses saved rules and cat debrief in lounge", async ({
  page,
}) => {
  await enter(page);
  await page.evaluate(async () => {
    const me = await (await fetch("/api/me")).json();
    const headers = {
      "Content-Type": "application/json",
      "X-CSRF-Token": me.csrfToken,
    };
    let state = (await (await fetch("/api/sessions/" + me.activeGameId)).json())
      .state;
    while (state.status === "playing") {
      if (state.script?.activity?.game && state.script.activity.status === 0) {
        const q = await (
          await fetch(`/api/sessions/${state.id}/activity`, {
            method: "POST",
            headers,
            body: JSON.stringify({ expectedStateVersion: state.version }),
          })
        ).json();
        state = (
          await (
            await fetch(`/api/sessions/${state.id}/activity`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                expectedStateVersion: state.version,
                challengeId: q.challenge.id,
                answers: [0],
              }),
            })
          ).json()
        ).state;
      }
      const action =
        state.actions.find((a: { id: string }) => a.id === "hc.end.return") ??
        state.actions[0];
      const p = await (
        await fetch("/api/sessions/" + state.id + "/proposals", {
          method: "POST",
          headers,
          body: JSON.stringify({
            expectedStateVersion: state.version,
            actionOptionId: action.id,
          }),
        })
      ).json();
      state = (
        await (
          await fetch("/api/sessions/" + state.id + "/turns", {
            method: "POST",
            headers,
            body: JSON.stringify({
              expectedStateVersion: state.version,
              proposalId: p.proposal.id,
              clientTurnId: crypto.randomUUID(),
            }),
          })
        ).json()
      ).state;
    }
  });
  await page.reload();
  await page.getByRole("button", { name: "查看本局结局" }).click();
  await expect(page.locator(".progress")).toContainText("本局结束");
  await expect(page.locator(".room-art")).toHaveAttribute(
    "src",
    "/assets/tabletop/v1/lounge.png",
  );
  await readToEnd(page);
  await page.locator(".action-shortcut").click();
  await expect(page.locator(".ending")).toBeVisible();
  await page.getByRole("button", { name: "回到封面", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看本局结局" }),
  ).toBeVisible();
});

test("HTTP API ownership, CSRF, cache and exactly-once replay", async ({
  request,
}) => {
  const origin = "http://localhost:3100";
  const visitor = await request.post("/api/visitor", {
    headers: { Origin: origin, "X-Snail-Request": "1" },
    data: {},
  });
  expect(visitor.status()).toBe(200);
  expect(visitor.headers()["set-cookie"]).toContain("HttpOnly");
  const me = await visitor.json();
  const headers = { Origin: origin, "X-CSRF-Token": me.csrfToken };
  const c = await request.post("/api/sessions", {
    headers,
    data: {
      name: "API验收",
      background: "合成数据",
      stats: { body: 5, agility: 5, mind: 5, presence: 5 },
    },
  });
  expect(c.status()).toBe(201);
  let game = (await c.json()).state;
  if (game.script?.activity?.status === 0) {
    const q = await (
      await request.post(`/api/sessions/${game.id}/activity`, {
        headers,
        data: { expectedStateVersion: game.version },
      })
    ).json();
    game = (
      await (
        await request.post(`/api/sessions/${game.id}/activity`, {
          headers,
          data: {
            expectedStateVersion: game.version,
            challengeId: q.challenge.id,
            answers: [0],
          },
        })
      ).json()
    ).state;
  }
  expect(
    (
      await request.post(`/api/sessions/${game.id}/proposals`, {
        headers: { ...headers, Origin: "https://evil.example" },
        data: {
          expectedStateVersion: game.version,
          actionOptionId: game.actions[0].id,
        },
      })
    ).status(),
  ).toBe(403);
  const custom = await request.post(`/api/sessions/${game.id}/proposals`, {
    headers,
    data: {
      expectedStateVersion: game.version,
      text: "抢走郑工的房卡，去一楼的房间",
    },
  });
  expect(custom.status()).toBe(400);
  expect((await custom.json()).error.code).toBe("custom_actions_closed");
  const p = await request.post(`/api/sessions/${game.id}/proposals`, {
    headers,
    data: {
      expectedStateVersion: game.version,
      actionOptionId: game.actions[0].id,
    },
  });
  expect(p.status()).toBe(200);
  const proposal = (await p.json()).proposal;
  const data = {
    clientTurnId: crypto.randomUUID(),
    proposalId: proposal.id,
    expectedStateVersion: game.version,
  };
  const [a, b] = await Promise.all([
    request.post(`/api/sessions/${game.id}/turns`, { headers, data }),
    request.post(`/api/sessions/${game.id}/turns`, { headers, data }),
  ]);
  expect(a.status()).toBe(200);
  expect(b.status()).toBe(200);
  expect(await a.json()).toEqual(await b.json());
  const read = await request.get(`/api/sessions/${game.id}`);
  expect(read.headers()["cache-control"]).toContain("no-store");
  const wire = await read.text();
  expect(wire).not.toContain("action_snapshot");
  expect(wire).not.toContain("reasoning_content");
  expect(wire).not.toContain('"flags"');
});
