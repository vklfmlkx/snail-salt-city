import { scenarios } from "../src/content/registry";
import { validateBranches } from "./branch-validation";
console.log(
  JSON.stringify(
    scenarios.map((s) => ({ scenario: s.version, ...validateBranches(s) })),
    null,
    2,
  ),
);
