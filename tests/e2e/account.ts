import { expect, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, basename, resolve } from "node:path";

/** Seed the isolated e2e database, never a production account or login endpoint. */
export async function loginOffline(page: Page) {
  const file = process.env.SNAIL_E2E_DB;
  if (
    !file ||
    dirname(resolve(file)) !== resolve(tmpdir()) ||
    !basename(file).startsWith("snail-e2e-")
  )
    throw Error("e2e database required");
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled();
  const db = new DatabaseSync(file);
  try {
    const cookies = await page.context().cookies();
    let owner: string | undefined;
    for (const cookie of cookies) {
      const row = db
        .prepare("SELECT principal_id FROM visitor_sessions WHERE token_hash=?")
        .get(createHash("sha256").update(cookie.value).digest("hex")) as
        | { principal_id: string }
        | undefined;
      if (row) {
        owner = row.principal_id;
        break;
      }
    }
    if (!owner) throw Error("session fixture missing");
    db.prepare("UPDATE principals SET type='zhihu' WHERE id=?").run(owner);
    db.prepare("INSERT OR IGNORE INTO zhihu_accounts VALUES(?,?,?)").run(
      `e2e:${owner}`,
      owner,
      "测试玩家",
    );
  } finally {
    db.close();
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "测试功能", exact: true }),
  ).toBeEnabled();
}
