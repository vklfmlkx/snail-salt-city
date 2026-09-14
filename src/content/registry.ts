import { scenario } from "./legacy/snail-scenario";
import generated from "./generated/homecoming.json";
import { compileFramework } from "./compile-framework";
import { FrameworkSchema } from "./framework-schema";
import { GameError } from "../domain/types";
import branching from "./generated/homecoming-branch.json";
import scripted from "./generated/homecoming-script.json";
import { compileBook } from "../engine/script-rules";
import { ScriptBookSchema } from "./script-book";
import {
  curatedScenarios,
  originalCuratedScenarios,
  previousCuratedScenarios,
} from "./curated";
export const homecoming = compileFramework(FrameworkSchema.parse(generated));
// The old framework is retained only to decode existing save files.
export const fixedScenario = compileBook(ScriptBookSchema.parse(scripted));
export const currentScenario = compileBook(ScriptBookSchema.parse(branching));
export const scenarios = curatedScenarios;
const generatedScenarios = new Map<string, ReturnType<typeof compileBook>>();
export function registerBook(book: import("./script-book").ScriptBook) {
  generatedScenarios.set(
    book.version,
    compileBook(ScriptBookSchema.parse(book)),
  );
}
export function getScenario(version: string) {
  const s =
    [
      scenario,
      homecoming,
      fixedScenario,
      currentScenario,
      ...scenarios,
      ...originalCuratedScenarios,
      ...previousCuratedScenarios,
    ].find((s) => s.version === version) ?? generatedScenarios.get(version);
  if (!s)
    throw new GameError(
      409,
      "version_unsupported",
      "此剧本版本暂不可用，存档仍保留。",
    );
  return s;
}
