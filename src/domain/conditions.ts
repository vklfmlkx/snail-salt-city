import type { Condition, Effect, Scenario, State } from "./types";
const ops = ["eq", "ne", "gte", "lte"];
export function validateCondition(
  c: Condition,
  s: Scenario,
  depth = 1,
  count = { n: 0 },
): void {
  if (++count.n > 30 || depth > 5 || !c || typeof c !== "object")
    throw Error("condition bounds");
  switch (c.kind) {
    case "always":
      return;
    case "all":
    case "any":
      if (!c.conditions.length) throw Error("empty condition");
      c.conditions.forEach((x) => validateCondition(x, s, depth + 1, count));
      return;
    case "not":
      return validateCondition(c.condition, s, depth + 1, count);
    case "has_item":
      if (
        !s.items[c.itemId] ||
        !Number.isInteger(c.quantity) ||
        c.quantity < 1 ||
        c.quantity > 10
      )
        throw Error("item condition");
      return;
    case "compare": {
      const bool =
        c.field.startsWith("flag:") && s.flags.includes(c.field.slice(5));
      const numeric =
        ["hp", "supplies", "stage", "remaining", "turn"].includes(c.field) ||
        (c.field.startsWith("counter:") &&
          Object.hasOwn(s.counters, c.field.slice(8)));
      if (
        !ops.includes(c.op) ||
        (!bool && !numeric) ||
        typeof c.value !== (bool ? "boolean" : "number") ||
        (bool && !["eq", "ne"].includes(c.op)) ||
        (numeric &&
          (!Number.isInteger(c.value) || Math.abs(c.value as number) > 100))
      )
        throw Error("unregistered/typed field");
      return;
    }
    default:
      throw Error("unknown condition");
  }
}
export function condition(c: Condition, s: State): boolean {
  switch (c.kind) {
    case "always":
      return true;
    case "all":
      return c.conditions.every((x) => condition(x, s));
    case "any":
      return c.conditions.some((x) => condition(x, s));
    case "not":
      return !condition(c.condition, s);
    case "has_item":
      return (s.items[c.itemId] ?? 0) >= c.quantity;
    case "compare": {
      const v = c.field.startsWith("flag:")
        ? (s.flags[c.field.slice(5)] ?? false)
        : c.field.startsWith("counter:")
          ? (s.counters[c.field.slice(8)] ?? 0)
          : s[c.field as "hp"];
      switch (c.op) {
        case "eq":
          return v === c.value;
        case "ne":
          return v !== c.value;
        case "gte":
          return v >= c.value;
        case "lte":
          return v <= c.value;
      }
    }
  }
}
export function validateEffect(e: Effect, s: Scenario) {
  const bounded = (v: number) => Number.isInteger(v) && Math.abs(v) <= 10;
  switch (e.kind) {
    case "resource_delta":
      if (!["hp", "supplies"].includes(e.resource) || !bounded(e.value))
        throw Error("resource effect");
      break;
    case "counter_delta":
      if (!s.counters[e.id] || !bounded(e.value)) throw Error("counter effect");
      break;
    case "flag_set":
      if (!s.flags.includes(e.id) || typeof e.value !== "boolean")
        throw Error("flag effect");
      break;
    case "grant_item":
    case "remove_item":
      if (!s.items[e.id] || !bounded(e.quantity) || e.quantity < 1)
        throw Error("item effect");
      break;
    case "reveal_fact":
      if (!s.facts[e.id]) throw Error("fact effect");
      break;
    case "set_prepared":
      if (typeof e.value !== "boolean") throw Error("prepared effect");
      break;
    default:
      throw Error("unknown effect");
  }
}
export const always: Condition = { kind: "always" };
export const flag = (id: string, value = true): Condition => ({
  kind: "compare",
  field: `flag:${id}`,
  op: "eq",
  value,
});
export const all = (...conditions: Condition[]): Condition => ({
  kind: "all",
  conditions,
});
export const has = (itemId: string): Condition => ({
  kind: "has_item",
  itemId,
  quantity: 1,
});
