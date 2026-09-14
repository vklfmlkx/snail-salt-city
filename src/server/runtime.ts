import "server-only";
import { readConfig } from "./config";
import { Store } from "./database";
import { GameService } from "./service";
import { runtimeProvider } from "./budgeted-provider";
const globalRuntime = globalThis as unknown as {
  snailService?: GameService;
  snailSweep?: number;
};
export function service() {
  if (!globalRuntime.snailService) {
    const c = readConfig();
    globalRuntime.snailService = new GameService(
      new Store(c.SQLITE_FILE),
      c,
      undefined,
      runtimeProvider(c),
    );
  }
  if (
    !globalRuntime.snailSweep ||
    Date.now() - globalRuntime.snailSweep > 3600000
  ) {
    globalRuntime.snailService.store.cleanup();
    globalRuntime.snailSweep = Date.now();
  }
  return globalRuntime.snailService;
}
