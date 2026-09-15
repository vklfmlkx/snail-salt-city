export const dynamic = "force-dynamic";

/** Event-loop liveness only: no identity, database writes or external services. */
export function GET() {
  return new Response("snail-ready", {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}
