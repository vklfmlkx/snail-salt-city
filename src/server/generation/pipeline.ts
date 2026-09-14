import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import {
  ManuscriptSchema,
  ReviewSchema,
  type Manuscript,
  type Review,
  type Issue,
} from "./schema";
import {
  validateManuscript,
  manuscriptHash,
  collectRepairIssues,
} from "./validate";
import {
  PROMPT_VERSION,
  generationMessages,
  reviewMessages,
  repairMessages,
  editablePaths,
} from "./prompts";
import type { StorySource } from "../zhihu-stories";
import { provePlayable } from "./playability";
import { normalizeExpressions } from "./normalize";
import { applyManuscriptPatch } from "./patch";
import {
  assembleContentDraft,
  assembleFlatDraft,
  assertTrustedTopology,
  refreshParticipants,
} from "./authoring";
import { recoverDraftJSON } from "./json-syntax";
export type Phase =
  | "generate"
  | "review"
  | "repair"
  | "review_repaired"
  | "repair_second"
  | "review_second";
export interface WholeBookModel {
  call(
    phase: Phase,
    messages: { role: string; content: string }[],
    remainingMs?: number,
  ): Promise<unknown>;
}
export type GenerationResult = {
  status: "published" | "rejected";
  jobId: string;
  calls: number;
  issues: Issue[];
  artifact?: string;
  cached?: boolean;
};
export type Artifact = {
  version: "generated-v6";
  id: string;
  promptVersion: string;
  routingMode: "trusted-six-v1" | "legacy-model-graph";
  source: Omit<StorySource, "content">;
  playerStyle: string;
  manuscript: Manuscript;
  review: Review;
  coverage: NonNullable<ReturnType<typeof validateManuscript>["coverage"]>;
  hash: string;
  createdAt: string;
};
function saveJSON(path: string, value: unknown) {
  const temp = path + ".tmp";
  writeFileSync(temp, JSON.stringify(value, null, 2), { flag: "w" });
  renameSync(temp, path);
}
export async function generateWholeBook(
  source: StorySource,
  prompt: string,
  model: WholeBookModel,
  root = "data/generated-stories",
): Promise<GenerationResult> {
  if (!prompt.trim() || prompt.length > 500)
    throw Error("invalid_style_prompt");
  if (source.content.length > 18000)
    throw Error("source_too_long_for_single_book_job");
  const jobId = manuscriptHash([PROMPT_VERSION, source.sha256, prompt]),
    job = join(root, "jobs", jobId),
    published = join(root, "published", jobId + ".json");
  mkdirSync(job, { recursive: true });
  mkdirSync(join(root, "published"), { recursive: true });
  if (existsSync(published)) {
    const a = readArtifact(published);
    if (a.id !== jobId) throw Error("published_id_mismatch");
    return {
      status: "published",
      jobId,
      calls: 0,
      issues: [],
      artifact: published,
      cached: true,
    };
  }
  const statusFile = join(job, "status.json");
  if (existsSync(statusFile)) {
    const previous = JSON.parse(readFileSync(statusFile, "utf8"));
    if (previous.status === "rejected")
      return { ...previous, calls: 0, cached: true };
  }
  const lock = join(job, "lock");
  let fd: number;
  try {
    fd = openSync(lock, "wx");
  } catch {
    throw Error("generation_job_in_progress_or_interrupted");
  }
  let calls = 0;
  let trustedTopology = false;
  const start = Date.now();
  saveJSON(join(job, "request.json"), {
    sourceId: source.workId,
    sourceHash: source.sha256,
    playerStyle: prompt,
    promptVersion: PROMPT_VERSION,
  });
  const call = async (
    phase: Phase,
    messages: { role: string; content: string }[],
  ) => {
    const remainingMs = 600000 - (Date.now() - start);
    if (remainingMs <= 0) throw Error("generation_job_deadline");
    calls++;
    saveJSON(statusFile, { status: phase, jobId, calls });
    const response = await model.call(phase, messages, remainingMs);
    if (Date.now() - start > 600000) throw Error("generation_job_deadline");
    saveJSON(join(job, phase + ".json"), response);
    let value = recoverDraftJSON(response);
    if (
      phase.startsWith("review") &&
      value &&
      typeof value === "object" &&
      "$schema" in value &&
      value.$schema === "https://json-schema.org/draft/2020-12/schema"
    ) {
      const { $schema, ...reviewValue } = value;
      value = reviewValue;
      saveJSON(join(job, phase + "-normalization.json"), [
        { code: "json_schema_header_ignored" },
      ]);
    }
    if (phase === "generate" || phase.startsWith("repair")) {
      const flat =
        phase === "generate" &&
        value &&
        typeof value === "object" &&
        "format" in value &&
        value.format === "vn-flat-1";
      if (
        phase === "generate" &&
        value &&
        typeof value === "object" &&
        "format" in value &&
        (value.format === "vn-content-1" || flat)
      )
        trustedTopology = true;
      const normalized = normalizeExpressions(
        flat
          ? assembleFlatDraft(value)
          : phase === "generate" && trustedTopology
            ? assembleContentDraft(value)
            : value,
      );
      saveJSON(join(job, phase + "-normalization.json"), normalized.warnings);
      return normalized.value;
    }
    return value;
  };
  const reject = (issues: Issue[]) => {
    const r: GenerationResult = { status: "rejected", jobId, calls, issues };
    saveJSON(statusFile, r);
    return r;
  };
  try {
    let raw = await call("generate", generationMessages(source, prompt)),
      validation = validateManuscript(raw),
      review: Review | null = null;
    if (
      validation.ok ||
      (raw &&
        typeof raw === "object" &&
        "nodes" in raw &&
        Array.isArray(raw.nodes) &&
        "endings" in raw)
    ) {
      const audit = ReviewSchema.safeParse(
        await call(
          "review",
          reviewMessages(raw, {
            coverage: validation.coverage,
            deterministicIssues: collectRepairIssues(raw),
          }),
        ),
      );
      if (!audit.success)
        return reject([
          {
            code: "review_schema",
            path: "/review",
            message: "review must be complete and well-formed; no default pass",
          },
        ]);
      review = audit.data;
    }
    for (
      let round = 0;
      round < 2 && (!validation.ok || review?.verdict !== "pass");
      round++
    ) {
      const revision = await call(
        round === 0 ? "repair" : "repair_second",
        repairMessages(raw, collectRepairIssues(raw), review, trustedTopology),
      );
      raw =
        raw && typeof raw === "object" && "nodes" in raw
          ? normalizeExpressions(
              applyManuscriptPatch(
                raw,
                revision,
                trustedTopology ? new Set(editablePaths(raw)) : undefined,
              ),
            ).value
          : revision;
      saveJSON(join(job, "revised-manuscript.json"), raw);
      if (trustedTopology) raw = refreshParticipants(raw);
      validation = validateManuscript(raw);
      if (!validation.ok) {
        review = null;
        continue;
      }
      if (trustedTopology) assertTrustedTopology(raw);
      const audit = ReviewSchema.safeParse(
        await call(
          round === 0 ? "review_repaired" : "review_second",
          reviewMessages(validation.manuscript!, validation.coverage),
        ),
      );
      if (!audit.success)
        return reject([
          {
            code: "review_schema",
            path: "/review",
            message: "repaired manuscript review was malformed",
          },
        ]);
      review = audit.data;
    }
    if (!validation.ok || !review || review.verdict !== "pass")
      return reject(
        review?.issues.map((i) => ({
          code: i.code,
          path: i.path,
          message: i.message,
        })) ?? validation.issues,
      );
    const m = ManuscriptSchema.parse(raw),
      { content, ...provenance } = source;
    if (trustedTopology) assertTrustedTopology(m);
    provePlayable(m);
    const artifact: Artifact = {
      version: "generated-v6",
      id: jobId,
      promptVersion: PROMPT_VERSION,
      routingMode: trustedTopology ? "trusted-six-v1" : "legacy-model-graph",
      source: provenance,
      playerStyle: prompt,
      manuscript: m,
      review,
      coverage: validation.coverage!,
      hash: manuscriptHash(m),
      createdAt: new Date().toISOString(),
    };
    saveJSON(published, artifact);
    const r: GenerationResult = {
      status: "published",
      jobId,
      calls,
      issues: [],
      artifact: published,
    };
    saveJSON(statusFile, r);
    return r;
  } catch (e) {
    return reject([
      {
        code: "generation_error",
        path: "/job",
        message:
          e instanceof Error
            ? e.message.replace(/sk-[\w-]+/g, "[redacted]").slice(0, 180)
            : "generation_failed",
      },
    ]);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
export function readArtifact(file: string): Artifact {
  const a = JSON.parse(readFileSync(file, "utf8"));
  if (a.version !== "generated-v6" || a.hash !== manuscriptHash(a.manuscript))
    throw Error("artifact_hash_invalid");
  const m = validateManuscript(a.manuscript),
    r = ReviewSchema.safeParse(a.review);
  if (!m.ok || !r.success || r.data.verdict !== "pass")
    throw Error("artifact_not_approved");
  if (a.routingMode === "trusted-six-v1") assertTrustedTopology(m.manuscript);
  return {
    ...a,
    manuscript: m.manuscript,
    review: r.data,
    coverage: m.coverage,
  };
}
