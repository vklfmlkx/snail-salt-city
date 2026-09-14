"use client";
import { useEffect, useState } from "react";
import type { PublicTurn } from "@/domain/types";
import { Modal } from "./Modal";
export function DiceReveal({
  turn,
  reduce,
  onClose,
}: {
  turn: PublicTurn;
  reduce: boolean;
  onClose: () => void;
}) {
  const [done, setDone] = useState(reduce);
  useEffect(() => {
    if (reduce || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDone(true);
      return;
    }
    const t = setTimeout(() => setDone(true), 1100);
    return () => clearTimeout(t);
  }, [reduce]);
  const r = turn.result;
  return (
    <Modal title="命运的骰子" onClose={onClose} className="dice-modal">
      <div className={`dice-reveal ${done ? "landed" : "rolling"}`}>
        <div
          className="d10"
          aria-label={done ? `已保存骰点 ${r.die}` : "骰子滚动中"}
        >
          {done ? r.die : "✦"}
        </div>
        <div aria-live="polite">
          {done ? (
            <>
              <h3>
                {
                  {
                    success: "判定通过",
                    partial: "部分成功",
                    failure: "判定未通过",
                  }[r.outcome]
                }
              </h3>
              <p>
                骰点 {r.die} + 属性 {r.attributeValue} + 修正 {r.modifier} /
                难度 {r.difficulty}
              </p>
              <p>{r.actionLabel}</p>
            </>
          ) : (
            <p>骰子正在落定……</p>
          )}
        </div>
        <button
          className="primary"
          onClick={() => (done ? onClose() : setDone(true))}
        >
          {done ? "进入剧情" : "跳过动画，查看结果"}
        </button>
      </div>
    </Modal>
  );
}
