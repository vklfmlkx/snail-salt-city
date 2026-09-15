import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrowserStorage } from "../src/components/game/browser-storage";
import { cloneGameData } from "../src/domain/clone-game-data";
import { clientId } from "../src/components/game/client-id";
import { playPixel } from "../src/domain/pixel-arcade";

test("blocked/full browser storage falls back to memory without discarding newer values", () => {
  let blocked = false;
  const values: Record<string, string> = {
    "snail:old": "server-save",
    "other-app": "keep",
  };
  const native = {
    getItem(k: string) {
      if (blocked) throw Error("blocked");
      return values[k] ?? null;
    },
    setItem(k: string, v: string) {
      if (blocked) throw Error("full");
      values[k] = v;
    },
    removeItem(k: string) {
      if (blocked) throw Error("blocked");
      delete values[k];
    },
  } as Storage;
  const cache = createBrowserStorage(() => {
    if (blocked) throw Error("SecurityError");
    return native;
  });
  assert.equal(cache.getItem("snail:old"), "server-save");
  blocked = true;
  cache.setItem("snail:old", "newer");
  cache.setItem("snail:pending", "same-id");
  assert.equal(cache.getItem("snail:old"), "newer");
  blocked = false;
  assert.equal(cache.getItem("snail:old"), "newer");
  cache.removeItem("snail:old");
  assert.equal(cache.getItem("snail:old"), null);
  blocked = true;
  cache.clearPrefix("snail:");
  assert.equal(cache.getItem("snail:pending"), null);
  assert.equal(values["other-app"], "keep");
});
test("storage quota during setItem still preserves tab-local drafts and reading position", () => {
  const cache = createBrowserStorage(
    () =>
      ({
        getItem: () => null,
        setItem() {
          throw Error("QuotaExceededError");
        },
        removeItem() {
          throw Error("blocked");
        },
      }) as unknown as Storage,
  );
  cache.setItem("snail:draft", "hello");
  cache.setItem("snail:reading", "12");
  assert.equal(cache.getItem("snail:draft"), "hello");
  assert.equal(cache.getItem("snail:reading"), "12");
  cache.removeItem("snail:draft");
  assert.equal(cache.getItem("snail:draft"), null);
});
test("clone fallback preserves optional fields and identical deterministic minigame state", () => {
  const native = globalThis.structuredClone;
  const expected = ([1, 2, 3] as const).flatMap((rulesVersion) =>
    ["summit", "flight", "roulette", "rally"].map((game) => ({
      rulesVersion,
      game,
      expected: playPixel(game as "summit", 789, [], "normal", rulesVersion),
    })),
  );
  try {
    Object.defineProperty(globalThis, "structuredClone", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const original = {
      nested: [{ x: undefined, y: Infinity, z: NaN }],
      a: null,
    };
    const copy = cloneGameData(original);
    assert.deepEqual(copy, original);
    assert.notEqual(copy.nested, original.nested);
    for (const c of expected)
      assert.deepEqual(
        playPixel(c.game as "summit", 789, [], "normal", c.rulesVersion),
        c.expected,
      );
  } finally {
    Object.defineProperty(globalThis, "structuredClone", {
      value: native,
      configurable: true,
      writable: true,
    });
  }
});
test("mobile UUID fallback remains random and conforms to UUID v4", () => {
  const native = crypto.randomUUID;
  try {
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    const ids = new Set(Array.from({ length: 100 }, clientId));
    assert.equal(ids.size, 100);
    for (const id of ids)
      assert.match(
        id,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      );
  } finally {
    Object.defineProperty(crypto, "randomUUID", {
      value: native,
      configurable: true,
    });
  }
});
