"use client";
import type { ScriptBook, ScriptLine } from "@/content/script-book";
import { attributeLabels } from "@/domain/types";
export function Manuscript({ book }: { book: ScriptBook }) {
  const name = (id: string) =>
    id === "gm"
      ? "猫咪城主"
      : id === "player"
        ? `${(book.roleNames?.player ?? "主角").replace(/（你）/g, "")}（你）`
        : (book.roleNames?.[id as keyof typeof book.roleNames] ?? id);
  const lines = (ls: ScriptLine[]) =>
    ls.map((l, i) => (
      <p key={i}>
        <b>{name(l.speaker)}：</b>
        {l.text}
      </p>
    ));
  const label = (flag: string) => book.flagLabels?.[flag] ?? flag;
  const ending = (id: string) =>
    book.endings.find((e) => e.id === id)?.title ?? id;
  return (
    <article className="manuscript">
      <h2>完整剧本 · {book.title}</h2>
      <p>包含全部路线和结局。展开章节即可阅读。</p>
      {book.stages.map((stage, i) => (
        <details key={i}>
          <summary>
            第{i + 1}幕 · {stage.title}
          </summary>
          {lines(stage.opening)}
          {stage.activity ? (
            <details>
              <summary>小游戏结果</summary>
              <h4>完成</h4>
              {lines(stage.activity.success)}
              <h4>未完成</h4>
              {lines(stage.activity.failure)}
            </details>
          ) : null}
          {stage.choices.map((c, j) => (
            <details key={j}>
              <summary>
                选择：{c.label} · {attributeLabels[c.attribute]}
              </summary>
              <p>要求：{c.conditions.join("；")}</p>
              {(["success", "partial", "failure"] as const).map((outcome) => {
                const r = c.routes?.[outcome];
                return (
                  <section key={outcome}>
                    <h4>
                      {
                        {
                          success: "成功",
                          partial: "部分成功",
                          failure: "失败",
                        }[outcome]
                      }
                    </h4>
                    {lines(c.branches[outcome])}
                    {r ? (
                      <>
                        {lines(r.bridge)}
                        <p>
                          {r.stage
                            ? `进入第${r.stage}幕`
                            : r.ending
                              ? `结局：${ending(r.ending)}`
                              : ""}
                        </p>
                        {r.requires?.length ? (
                          <p>
                            需要：{r.requires.map(label).join("、")}
                            ；未满足则进入「{ending(r.otherwise ?? "")}」。
                          </p>
                        ) : null}
                        {r.grants?.length ? (
                          <p>获得线索：{r.grants.map(label).join("、")}</p>
                        ) : null}
                      </>
                    ) : null}
                  </section>
                );
              })}
            </details>
          ))}
          {lines(stage.transition)}
        </details>
      ))}
      {book.endings.map((e) => (
        <details key={e.id}>
          <summary>
            {
              { good: "好结局", bad: "坏结局", true: "真结局" }[
                e.category ?? "good"
              ]
            }{" "}
            · {e.title}
          </summary>
          {lines(e.dialogue)}
        </details>
      ))}
    </article>
  );
}
