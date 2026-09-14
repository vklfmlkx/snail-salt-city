import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Inspect exactly the index to be committed; never print matched secret values.
const files = execFileSync("git", ["ls-files", "--cached", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
if (!files.length)
  throw Error("Stage the public release files before checking.");
const env = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
const secrets = Object.entries(env)
  .filter(
    ([key, value]) =>
      /KEY|TOKEN|SECRET|PASSWORD/.test(key) && value.length >= 12,
  )
  .map(([, value]) => value);
const failures = [];
const required = [
  "README.md",
  "LICENSE",
  "NOTICE.md",
  ".env.example",
  "package-lock.json",
  "docs/PRODUCT_PLAN.md",
  "docs/DEPLOYMENT.md",
  "docs/ATTRIBUTIONS.md",
  "docs/screenshots/home.png",
  "docs/screenshots/story.png",
  "docs/screenshots/arcade.png",
];
for (const file of required)
  if (!files.includes(file)) failures.push(`${file}: required file missing`);
const batch = execFileSync("git", ["cat-file", "--batch"], {
  input: files.map((p) => `:${p}\n`).join(""),
  maxBuffer: 100 * 1024 * 1024,
});
let offset = 0,
  bytes = 0;
for (const file of files) {
  const end = batch.indexOf(10, offset);
  const header = batch.toString("utf8", offset, end).split(" ");
  if (header[1] !== "blob") throw Error("Unexpected index entry");
  const size = Number(header[2]);
  const content = batch.subarray(end + 1, end + 1 + size);
  offset = end + 1 + size + 1;
  bytes += size;
  if (
    /(^|\/)(data|node_modules|\.next|\.release|secrets)(\/|$)|^docs\/(handoff|implementation|sources)\/|_origin\.|\.(db|sqlite|sqlite3|log|zip|pem|key)(-|$)|(^|\/)\.env(\.|$)/.test(
      file,
    ) &&
    file !== ".env.example"
  )
    failures.push(`${file}: private or generated file`);
  if (size > 20 * 1024 * 1024) failures.push(`${file}: unexpected large file`);
  if (/\.(png|jpg|jpeg|webp|ico)$/.test(file)) continue;
  const text = content.toString("utf8");
  if (secrets.some((s) => text.includes(s)))
    failures.push(`${file}: local credential matched`);
  if (
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-[A-Za-z0-9]{24,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
      text,
    )
  )
    failures.push(`${file}: credential-like value`);
}
console.log(
  JSON.stringify(
    {
      files: files.length,
      megabytes: +(bytes / 1024 / 1024).toFixed(2),
      credentialValuesPrinted: false,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
