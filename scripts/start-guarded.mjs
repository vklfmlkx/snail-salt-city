import { runGuardedServer } from "./process-supervisor.mjs";
const index = process.argv.indexOf("--port");
const port = index === -1 ? "3002" : process.argv[index + 1];
if (!/^\d{4,5}$/.test(port ?? "") || Number(port) > 65535)
  throw Error("invalid_port");
// Next reads .env.local itself; this launcher never enables paid services.
await runGuardedServer({ port });
