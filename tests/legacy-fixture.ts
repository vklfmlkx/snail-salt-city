import { randomUUID } from "node:crypto";
import type { Character } from "../src/domain/types";
import { scenario } from "../src/content/legacy/snail-scenario";
import { initialState } from "../src/engine/rules";
import type { GameService } from "../src/server/service";
// Fixture for saved games created before the original scenario was retired.
export function legacyGame(
  service: GameService,
  owner: string,
  character: Character,
) {
  const st = initialState(character, scenario),
    id = randomUUID(),
    now = Date.now();
  service.store.db
    .prepare("INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      id,
      owner,
      st.rulesVersion,
      st.scenarioVersion,
      st.assetCatalogVersion,
      0,
      "playing",
      JSON.stringify(st),
      JSON.stringify(st.castSnapshot),
      now,
      now,
    );
  return service.read(owner, id);
}
