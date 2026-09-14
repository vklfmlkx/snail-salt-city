import { test } from "node:test";
import assert from "node:assert/strict";
import { paidJSON, ResearchBudget } from "../src/server/research-budget";

test("editorial low thinking is explicit, usage is charged, reasoning is discarded", async () => {
  const original = globalThis.fetch,
    budget = new ResearchBudget(":memory:");
  try {
    let payload: Record<string, unknown> = {};
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      payload = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          model: "deepseek-flash",
          usage: { prompt_tokens: 100, completion_tokens: 200 },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: '{"verdict":"pass"}',
                reasoning_content: "private chain",
              },
            },
          ],
        }),
      );
    };
    const result = await paidJSON(
      budget,
      "fake-test-key",
      "test:review",
      [{ role: "user", content: "synthetic JSON test" }],
      1000,
      1000,
      true,
      true,
      "low",
    );
    assert.deepEqual(payload.thinking, { type: "enabled" });
    assert.equal(payload.reasoning_effort, "low");
    assert.deepEqual(payload.response_format, { type: "json_object" });
    assert.equal(payload.tools, undefined);
    assert.equal(JSON.stringify(result).includes("private chain"), false);
    assert.equal(budget.report()[0].charged, 1800);
    await paidJSON(
      budget,
      "fake-test-key",
      "test:disabled",
      [{ role: "user", content: "synthetic JSON test" }],
      1000,
      1000,
      false,
      true,
      "low",
    );
    assert.equal(payload.reasoning_effort, undefined);
  } finally {
    globalThis.fetch = original;
    budget.close();
  }
});

test("unfinished editorial output is never treated as a usable manuscript", async () => {
  const original = globalThis.fetch,
    budget = new ResearchBudget(":memory:");
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          usage: { prompt_tokens: 100, completion_tokens: 200 },
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"format":"vn-flat-1"}' },
            },
          ],
        }),
      );
    await assert.rejects(
      paidJSON(
        budget,
        "fake-test-key",
        "test:cutoff",
        [],
        1000,
        1000,
        true,
        true,
        "low",
      ),
      /generation_incomplete/,
    );
    assert.equal(budget.report()[0].status, "measured");
  } finally {
    globalThis.fetch = original;
    budget.close();
  }
});
