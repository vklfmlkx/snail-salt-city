import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
 INSERT OR IGNORE INTO schema_version VALUES(1);
 CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY,type TEXT NOT NULL DEFAULT 'guest',created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS visitor_sessions(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,token_hash TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,rules_version TEXT NOT NULL,scenario_version TEXT NOT NULL,asset_version TEXT NOT NULL,state_version INTEGER NOT NULL,status TEXT NOT NULL,state_json TEXT NOT NULL,cast_snapshot TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_playing ON games(principal_id) WHERE status='playing';
 CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,state_version INTEGER NOT NULL,action_id TEXT NOT NULL,action_hash TEXT NOT NULL,action_snapshot TEXT NOT NULL,original_input TEXT NOT NULL,intent TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,client_turn_id TEXT NOT NULL,turn_number INTEGER NOT NULL,request_hash TEXT NOT NULL,proposal_id TEXT NOT NULL,before_version INTEGER NOT NULL,after_version INTEGER NOT NULL,die INTEGER,outcome TEXT NOT NULL,events TEXT NOT NULL,public_result TEXT NOT NULL,fallback_narration TEXT NOT NULL,narration_status TEXT NOT NULL,narration_lease_until INTEGER,narration_attempt_count INTEGER NOT NULL DEFAULT 0,narration TEXT,error_code TEXT,context_json TEXT NOT NULL, UNIQUE(game_id,client_turn_id),UNIQUE(game_id,turn_number),UNIQUE(game_id,proposal_id));
 CREATE TABLE IF NOT EXISTS ending_summaries(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,ending_id TEXT NOT NULL,title TEXT NOT NULL,turns INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS quota_ledger(day TEXT NOT NULL,scope TEXT NOT NULL,calls INTEGER NOT NULL,PRIMARY KEY(day,scope));
 CREATE TABLE IF NOT EXISTS model_leases(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS preview_limits(principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,minute INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(principal_id,minute));`);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS ending_collection(principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,scenario_version TEXT NOT NULL,ending_id TEXT NOT NULL,title TEXT NOT NULL,label TEXT NOT NULL,recap TEXT NOT NULL,achieved_at INTEGER NOT NULL,PRIMARY KEY(principal_id,scenario_version,ending_id));
    CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,stage INTEGER NOT NULL,after_turn INTEGER NOT NULL,challenge_json TEXT NOT NULL,result_json TEXT,created_at INTEGER NOT NULL,UNIQUE(game_id,stage));`);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS generated_books(version TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,book_json TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,tags_json TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL,book_version TEXT,error_code TEXT,created_at INTEGER NOT NULL,deadline INTEGER NOT NULL);`);
    if (
      !(
        this.db.prepare("PRAGMA table_info(generation_jobs)").all() as {
          name: string;
        }[]
      ).some((c) => c.name === "draft_json")
    )
      this.db.exec("ALTER TABLE generation_jobs ADD COLUMN draft_json TEXT");
    if (
      !(
        this.db.prepare("PRAGMA table_info(generation_jobs)").all() as {
          name: string;
        }[]
      ).some((c) => c.name === "diagnostic")
    )
      this.db.exec("ALTER TABLE generation_jobs ADD COLUMN diagnostic TEXT");
    const columns = this.db.prepare("PRAGMA table_info(proposals)").all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "local_plan"))
      this.db.exec("ALTER TABLE proposals ADD COLUMN local_plan TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS book_slots(principal_id TEXT NOT NULL REFERENCES principals(id),slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3),version TEXT NOT NULL,PRIMARY KEY(principal_id,slot));
      CREATE TABLE IF NOT EXISTS community_books(version TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES principals(id),source_version TEXT NOT NULL,book_json TEXT NOT NULL,listed INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_published_book ON community_books(principal_id) WHERE listed=1;
      CREATE TABLE IF NOT EXISTS zhihu_accounts(uid TEXT PRIMARY KEY,principal_id TEXT UNIQUE NOT NULL REFERENCES principals(id),name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,principal_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
    `);
    for (const [name, type] of [
      ["description", "TEXT NOT NULL DEFAULT ''"],
      ["replace_version", "TEXT"],
      ["slot", "INTEGER"],
    ]) {
      if (
        !(
          this.db.prepare("PRAGMA table_info(generation_jobs)").all() as {
            name: string;
          }[]
        ).some((c) => c.name === name)
      )
        this.db.exec(`ALTER TABLE generation_jobs ADD COLUMN ${name} ${type}`);
    }
    if (
      !this.db
        .prepare("SELECT version FROM schema_version WHERE version=2")
        .get()
    )
      this.transaction(() => {
        this.db.exec(
          `INSERT OR IGNORE INTO book_slots SELECT principal_id,n,version FROM (SELECT principal_id,version,ROW_NUMBER() OVER(PARTITION BY principal_id ORDER BY created_at DESC,version) n FROM generated_books) WHERE n<=3; INSERT INTO schema_version VALUES(2);`,
        );
      });
  }
  transaction<T>(f: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = f();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  cleanup(now = Date.now()) {
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM principals WHERE expires_at<=? AND type='guest' AND id NOT IN (SELECT principal_id FROM community_books) AND id NOT IN (SELECT principal_id FROM book_slots)",
        )
        .run(now);
      this.db.prepare("DELETE FROM oauth_states WHERE expires_at<=?").run(now);
      this.db.prepare("DELETE FROM proposals WHERE expires_at<=?").run(now);
      this.db
        .prepare("DELETE FROM games WHERE status<>? AND updated_at<?")
        .run("playing", now - 7 * 86400000);
      this.db
        .prepare("DELETE FROM preview_limits WHERE minute<?")
        .run(Math.floor(now / 60000) - 2);
      this.db.prepare("DELETE FROM model_leases WHERE expires_at<=?").run(now);
      this.db
        .prepare("DELETE FROM quota_ledger WHERE day<?")
        .run(new Date(now - 32 * 86400000).toISOString().slice(0, 10));
    });
  }
  close() {
    this.db.close();
  }
}
