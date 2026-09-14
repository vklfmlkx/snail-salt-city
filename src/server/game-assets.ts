import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { actors, rooms } from "../components/game/presentation";

// Only active artwork: unused earlier editions are deliberately excluded.
export function gameAssets() {
  const paths = [
    "/assets/brand/cover.v1.png",
    ...Object.keys(rooms).map((room) => `/assets/tabletop/v1/${room}.png`),
    ...Object.keys(actors).map((actor) => `/assets/tabletop/v2/${actor}.png`),
    "/assets/tabletop/v1/gm-smile.png",
  ];
  return paths.map((path) => {
    const bytes = readFileSync(join(process.cwd(), "public", path));
    const version = createHash("sha256")
      .update(bytes)
      .digest("hex")
      .slice(0, 16);
    return { path, url: `${path}?v=${version}`, bytes: bytes.length };
  });
}
