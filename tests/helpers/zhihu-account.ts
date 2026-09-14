import type { Store } from "../../src/server/database";
// Offline authenticated identity fixture; never uses production credentials.
export function linkTestAccount(db: Store, owner: string) {
  db.db.prepare("UPDATE principals SET type='zhihu' WHERE id=?").run(owner);
  db.db
    .prepare("INSERT INTO zhihu_accounts VALUES(?,?,?)")
    .run(`fixture:${owner}`, owner, "测试玩家");
  return owner;
}
