import { backup, DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
async function main() {
  const dir = resolve("data/backups");
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, `snail-${Date.now()}.db`);
  const db = new DatabaseSync(process.env.SQLITE_FILE ?? "./data/snail.db");
  await backup(db, target);
  db.close();
  console.log(
    "SQLite一致性备份完成，保存在data/backups下；其中包含访客数据，请勿提交或公开。",
  );
}
main().catch(() => {
  console.error("备份失败，请确认数据库存在且可写；未输出数据库内容。");
  process.exitCode = 1;
});
