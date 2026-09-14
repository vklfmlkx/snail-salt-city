import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
/** Local, durable budget for the explicitly authorized editorial experiment. Units: micro-yuan. */
export class ResearchBudget {
  db: DatabaseSync;
  constructor(
    path: string,
    readonly ceiling = 10_000_000,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, label TEXT, reserved INTEGER, charged INTEGER, status TEXT, input INTEGER, output INTEGER)",
    );
  }
  reserve(label: string, body: string, maxTokens: number) {
    // UTF-8 bytes conservatively upper-bound input tokens; include protocol overhead.
    const amount = (Buffer.byteLength(body) + 4096) * 2 + maxTokens * 8;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const used = Number(
        (
          this.db
            .prepare("SELECT COALESCE(SUM(charged),0) n FROM requests")
            .get() as { n: number }
        ).n,
      );
      if (used + amount > this.ceiling)
        throw Error("research_budget_exhausted");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO requests VALUES(?,?,?,?,?,NULL,NULL)")
        .run(id, label, amount, amount, "reserved");
      this.db.exec("COMMIT");
      return id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  settle(
    id: string,
    usage: { prompt_tokens?: number; completion_tokens?: number },
  ) {
    const input = usage.prompt_tokens,
      output = usage.completion_tokens;
    if (
      !Number.isSafeInteger(input) ||
      !Number.isSafeInteger(output) ||
      input! < 0 ||
      output! < 0
    )
      return;
    this.db
      .prepare(
        "UPDATE requests SET charged=?,status='measured',input=?,output=? WHERE id=? AND status='reserved'",
      )
      .run(input! * 2 + output! * 8, input!, output!, id);
  }
  report() {
    return this.db
      .prepare(
        "SELECT label,reserved,charged,status,input,output FROM requests",
      )
      .all();
  }
  close() {
    this.db.close();
  }
}
export async function paidJSON(
  budget: ResearchBudget,
  key: string,
  label: string,
  messages: { role: string; content: string }[],
  maxTokens = 12000,
  timeoutMs = 60000,
  editorialThinking = false,
  preserveInvalidDraft = false,
  reasoningEffort: "low" | "high" | "max" = "high",
) {
  const body = JSON.stringify({
    model: "deepseek-flash",
    thinking: { type: editorialThinking ? "enabled" : "disabled" },
    ...(editorialThinking ? { reasoning_effort: reasoningEffort } : {}),
    stream: false,
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    messages,
  });
  const id = budget.reserve(label, body, maxTokens);
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body,
  });
  if (!response.ok) throw Error(`provider_http_${response.status}`);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 512000) {
      await reader.cancel();
      throw Error("response_too_large");
    }
    chunks.push(r.value);
  }
  const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (raw.usage) budget.settle(id, raw.usage);
  if (raw.choices?.[0]?.finish_reason !== "stop")
    throw Error("generation_incomplete");
  const content = raw.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw Error("empty_content");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    if (!preserveInvalidDraft) throw Error("invalid_json");
    value = { unparsedDraft: content };
  }
  return {
    value,
    usage: raw.usage,
    model: raw.model,
  };
}
