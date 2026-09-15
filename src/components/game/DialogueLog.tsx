"use client";
import { sessionCache } from "./browser-storage";
import { useEffect, useRef, useState } from "react";
import type { PublicState, PublicTurn } from "@/domain/types";
import { scriptBeats, type Beat } from "./presentation";
import type { ScriptLine } from "@/content/script-book";
export function DialogueLog({
  state,
  request,
}: {
  state: PublicState;
  request: (path: string) => Promise<{
    turns: PublicTurn[];
    activities?: {
      afterTurn: number;
      afterLine: number;
      openingLength: number;
      dialogue: ScriptLine[];
      intro: ScriptLine[];
      introInOpening?: boolean;
    }[];
  }>;
}) {
  const [rows, setRows] = useState<Beat[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    request(`sessions/${state.id}/turns`)
      .then(({ turns, activities = [] }) => {
        if (!active) return;
        const read =
          Number(
            sessionCache.getItem(
              `snail:reading:${state.id}:${state.version}:furthest`,
            ) ??
              sessionCache.getItem(
                `snail:reading:${state.id}:${state.version}`,
              ) ??
              0,
          ) + 1;
        const opening = state.script
          ? scriptBeats(state.script.initialDialogue, state)
          : [];
        const insertPractice = (
          all: Beat[],
          afterTurn: number,
          shown: number,
        ) => {
          const practice = activities.find((a) => a.afterTurn === afterTurn),
            cut = practice
              ? all.length - practice.openingLength + practice.afterLine
              : Infinity;
          const visible = all.slice(0, shown);
          if (practice && shown >= cut)
            visible.splice(
              cut,
              0,
              ...scriptBeats(
                [
                  ...(practice.introInOpening ? [] : practice.intro),
                  ...practice.dialogue,
                ],
                state,
              ),
            );
          return visible;
        };
        const lines = [
          ...insertPractice(opening, 0, turns.length ? opening.length : read),
          ...turns.flatMap((t, i) => {
            const beats = t.result.scriptDialogue
              ? scriptBeats(t.result.scriptDialogue, state)
              : [
                  {
                    speaker: "gm" as const,
                    label: "猫咪城主",
                    text: t.result.fallback,
                    expression: "neutral" as const,
                  },
                ];
            return insertPractice(
              beats,
              t.result.turnNumber,
              i === turns.length - 1 && state.script ? read : beats.length,
            );
          }),
        ];
        setRows(lines);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("对话记录读取失败，请关闭后再试。");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [request, state.id, state.version]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [rows]);
  return (
    <section className="dialogue-history" aria-label="完整对话记录">
      <p className="muted">
        按发生顺序保存，向上滚动查看之前的对白。当前段只显示已读内容。
      </p>
      {loading ? <p role="status">正在翻开记录…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialogue-log" ref={box}>
        {rows.map((d, i) => (
          <article className={d.speaker === "gm" ? "log-gm" : ""} key={i}>
            <strong>{d.label}</strong>
            <p>{d.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
