import { paidJSON, ResearchBudget } from "../research-budget";
import type { Phase, WholeBookModel } from "./pipeline";
export class WholeBookDeepSeek implements WholeBookModel {
  constructor(
    private key: string,
    private budget: ResearchBudget,
    private jobLabel: string,
    private ceilingYuan = 0.9,
  ) {}
  async call(
    phase: Phase,
    messages: { role: string; content: string }[],
    remainingMs = 600000,
  ) {
    const audit = phase.startsWith("review"),
      maxTokens = audit ? 48000 : phase.startsWith("repair") ? 24000 : 64000;
    const charged = this.budget
      .report()
      .filter((r) => String(r.label).startsWith(this.jobLabel + ":"))
      .reduce((n, r) => n + Number(r.charged), 0);
    const reservation =
      (Buffer.byteLength(JSON.stringify(messages)) + 8192) * 2 + maxTokens * 8;
    if (charged + reservation > this.ceilingYuan * 1e6)
      throw Error("generation_job_budget_exhausted");
    const response = await paidJSON(
      this.budget,
      this.key,
      `${this.jobLabel}:${phase}`,
      messages,
      maxTokens,
      Math.min(
        remainingMs,
        audit ? 180000 : phase.startsWith("repair") ? 150000 : 240000,
      ),
      true,
      true,
      "low",
    );
    return response.value;
  }
}
