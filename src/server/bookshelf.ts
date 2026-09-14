import { createHash, randomUUID } from "node:crypto";
import type { Store } from "./database";
import { GameError } from "../domain/types";
import { ScriptBookSchema, type ScriptBook } from "../content/script-book";
import { scenarios, registerBook } from "../content/registry";
import { endingLabel } from "../engine/script-rules";
export type BookCategory = "curated" | "personal" | "community";
export class Bookshelf {
  constructor(private store: Store) {}
  personal(owner: string) {
    return (
      this.store.db
        .prepare(
          "SELECT b.book_json,s.slot FROM book_slots s JOIN generated_books b ON b.version=s.version WHERE s.principal_id=? ORDER BY s.slot",
        )
        .all(owner) as { book_json: string; slot: number }[]
    ).map((r) => ({
      book: ScriptBookSchema.parse(JSON.parse(r.book_json)),
      slot: r.slot,
    }));
  }
  community() {
    return (
      this.store.db
        .prepare(
          "SELECT * FROM community_books WHERE listed=1 ORDER BY created_at DESC",
        )
        .all() as {
        book_json: string;
        principal_id: string;
        source_version: string;
      }[]
    ).map((r) => ({
      book: ScriptBookSchema.parse(JSON.parse(r.book_json)),
      owner: r.principal_id,
      source: r.source_version,
    }));
  }
  find(owner: string, version: string) {
    const curated = scenarios.find((s) => s.version === version)?.book;
    if (curated)
      return {
        book: curated,
        category: "curated" as BookCategory,
        mine: false,
      };
    const personal = this.personal(owner).find(
      (s) => s.book.version === version,
    );
    if (personal)
      return { ...personal, category: "personal" as BookCategory, mine: true };
    const c = this.community().find((s) => s.book.version === version);
    if (c)
      return {
        ...c,
        category: "community" as BookCategory,
        mine: c.owner === owner,
      };
    throw new GameError(
      404,
      "book_not_found",
      "这篇故事不存在、已删除或已下架。",
    );
  }
  unlocked(owner: string, book: ScriptBook, category: BookCategory) {
    const ids = new Set(
      (
        this.store.db
          .prepare(
            "SELECT ending_id FROM ending_collection WHERE principal_id=? AND scenario_version=?",
          )
          .all(owner, book.version) as { ending_id: string }[]
      ).map((r) => r.ending_id),
    );
    const count = book.endings.filter((e) => ids.has(e.id)).length;
    return category === "curated" ? count === book.endings.length : count > 0;
  }
  list(owner?: string) {
    const entries = [
      ...scenarios.map((s) => ({
        book: s.book!,
        category: "curated" as BookCategory,
        mine: false,
      })),
      ...(owner
        ? this.personal(owner).map((s) => ({
            ...s,
            category: "personal" as BookCategory,
            mine: true,
          }))
        : []),
      ...this.community().map((s) => ({
        ...s,
        category: "community" as BookCategory,
        mine: s.owner === owner,
      })),
    ];
    return entries.map(({ book: b, category, mine, ...extra }) => ({
      version: b.version,
      title: b.title,
      description: b.description,
      source: b.source,
      references: b.references,
      stages: b.stages.length,
      dialogueLines: b.stages.reduce((n, s) => n + s.opening.length, 0),
      endingCategories: b.endings.map((e) => ({
        id: e.id,
        category: e.category,
        label: endingLabel(b, e.id),
      })),
      category,
      mine,
      slot: "slot" in extra ? extra.slot : undefined,
      canRead: owner ? this.unlocked(owner, b, category) : false,
    }));
  }
  manuscript(owner: string, version: string) {
    const item = this.find(owner, version);
    if (!this.unlocked(owner, item.book, item.category))
      throw new GameError(
        403,
        "manuscript_locked",
        item.category === "curated"
          ? "达成所有结局后可查看完整剧本。"
          : "达成一个结局后可查看完整剧本。",
      );
    return item.book;
  }
  private idle(owner: string, version: string) {
    if (
      this.store.db
        .prepare(
          "SELECT id FROM generation_jobs WHERE principal_id=? AND replace_version=? AND status IN ('queued','running')",
        )
        .get(owner, version)
    )
      throw new GameError(
        409,
        "book_busy",
        "这篇故事正在重新生成，请等待完成。",
      );
  }
  remove(owner: string, version: string) {
    return this.store.transaction(() => {
      const item = this.find(owner, version);
      if (item.category !== "personal")
        throw new GameError(403, "not_owner", "只能删除自己的生成剧本。");
      this.idle(owner, version);
      this.store.db
        .prepare("DELETE FROM book_slots WHERE principal_id=? AND version=?")
        .run(owner, version);
      return { ok: true };
    });
  }
  publish(owner: string, version: string) {
    return this.store.transaction(() => {
      const item = this.find(owner, version);
      if (item.category !== "personal")
        throw new GameError(403, "not_owner", "只能分享自己的生成剧本。");
      this.idle(owner, version);
      if (
        this.store.db
          .prepare(
            "SELECT version FROM community_books WHERE principal_id=? AND listed=1",
          )
          .get(owner)
      )
        throw new GameError(
          409,
          "community_full",
          "你已分享一篇故事，请先下架再分享另一篇。",
        );
      const book = structuredClone(item.book);
      book.version = `generated-${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 24)}`;
      this.store.db
        .prepare("INSERT INTO community_books VALUES(?,?,?,?,1,?)")
        .run(book.version, owner, version, JSON.stringify(book), Date.now());
      registerBook(book);
      return { version: book.version };
    });
  }
  unpublish(owner: string, version: string) {
    return this.store.transaction(() => {
      if (
        !this.store.db
          .prepare(
            "UPDATE community_books SET listed=0 WHERE principal_id=? AND version=? AND listed=1",
          )
          .run(owner, version).changes
      )
        throw new GameError(404, "not_owner", "没有找到你分享的这篇故事。");
      return { ok: true };
    });
  }
}
