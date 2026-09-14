"use client";
import { useEffect, useState } from "react";
import { ArcadeBoard } from "./ArcadeBoard";
import type { Challenge } from "@/domain/minigames";
import type { PublicState } from "@/domain/types";
import { attributeLabels } from "@/domain/types";
import { Modal } from "./Modal";
type PracticeResult = {
  success: boolean;
  skipped: boolean;
  reward: number;
  dialogue: { speaker: string; text: string }[];
};
function LegacyMiniGame({
  state,
  request,
  onState,
  onClose,
}: {
  state: PublicState;
  request: (path: string, body: unknown) => Promise<any>;
  onState: (s: PublicState) => void;
  onClose: () => void;
}) {
  const activity = state.script!.activity!;
  const [challenge, setChallenge] = useState<Challenge | null>(null),
    [answers, setAnswers] = useState<number[]>([]),
    [memory, setMemory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<PracticeResult | null>(null);
  async function send(finish = false, skip = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await request(`sessions/${state.id}/activity`, {
        expectedStateVersion: state.version,
        ...(finish ? { challengeId: challenge!.id, answers, skip } : {}),
      });
      if (data.challenge) setChallenge(data.challenge);
      if (data.result) {
        setResult(data.result);
        if (data.state) onState(data.state);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "练习暂时不可用，可稍后重试");
    } finally {
      setBusy(false);
    }
  }
  const directions = ["↑", "→", "↓", "←"];
  const ready =
    challenge &&
    (challenge.kind === "body"
      ? answers.length === 3
      : challenge.kind === "agility"
        ? memory && answers.length === 5
        : challenge.kind === "mind"
          ? answers.length === 1
          : answers.length === 3 &&
            answers.every((x) => Number.isInteger(x) && x >= 0));
  return (
    <Modal title={activity.title} onClose={onClose}>
      <section className="mini-game">
        <p className="mini-reward">
          {attributeLabels[activity.attribute]}练习 · 成功最多 +1 · 失败无惩罚 ·
          每幕一次；每项本局最多 +1，本局累计最多 +2。
        </p>
        {!activity.rewardAvailable ? (
          <p>本局已达到这项或总成长上限，仍可练习，不再加属性。</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {result ? (
          <>
            <h3>
              {result.skipped
                ? "结束练习"
                : result.success
                  ? "完成练习"
                  : "这次没通过"}
            </h3>
            <p>
              {result.reward
                ? `${attributeLabels[activity.attribute]} +${result.reward}`
                : "属性没有减少"}
            </p>
            {result.dialogue.map((d, i) => (
              <p key={i}>
                {state.script?.roleNames?.[d.speaker] ?? "猫咪城主"}：{d.text}
              </p>
            ))}
            <button className="primary" onClick={onClose}>
              回到刚才的对白
            </button>
          </>
        ) : !challenge ? (
          <>
            {activity.intro.map((d, i) => (
              <p key={i}>
                {state.script?.roleNames?.[d.speaker] ?? "猫咪城主"}：{d.text}
              </p>
            ))}
            <button className="primary" disabled={busy} onClick={() => send()}>
              开始小练习
            </button>
            <button className="secondary" onClick={onClose}>
              现在不练，继续故事
            </button>
          </>
        ) : (
          <>
            <h3>{challenge.prompt}</h3>
            {challenge.kind === "body" ? (
              <>
                <p>
                  目标重量：{challenge.target} · 已选重量：
                  {answers.reduce((n, i) => n + challenge.values[i], 0)}
                </p>
                <div className="mini-buttons">
                  {challenge.values.map((v, i) => (
                    <button
                      aria-pressed={answers.includes(i)}
                      key={i}
                      onClick={() =>
                        setAnswers((a) =>
                          a.includes(i)
                            ? a.filter((x) => x !== i)
                            : a.length < 3
                              ? [...a, i]
                              : a,
                        )
                      }
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {challenge.kind === "agility" ? (
              <>
                {!memory ? (
                  <>
                    <p className="memory-sequence">
                      {challenge.values.map((n) => directions[n]).join("　")}
                    </p>
                    <button
                      onClick={() => {
                        setMemory(true);
                        setAnswers([]);
                      }}
                    >
                      开始回忆
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      已记下 {answers.length}/5 步：
                      {answers.map((n) => directions[n]).join(" ")}
                    </p>
                    <div className="mini-buttons">
                      {directions.map((d, i) => (
                        <button
                          key={d}
                          disabled={answers.length === 5}
                          onClick={() => setAnswers((a) => [...a, i])}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : null}
            {challenge.kind === "mind" ? (
              <>
                <p className="memory-sequence">
                  {challenge.values.join("，")}，？
                </p>
                <label>
                  下一个数
                  <input
                    type="number"
                    value={answers[0] ?? ""}
                    onChange={(e) =>
                      setAnswers(
                        e.target.value === "" ? [] : [Number(e.target.value)],
                      )
                    }
                  />
                </label>
              </>
            ) : null}
            {challenge.kind === "presence"
              ? challenge.questions!.map((q, i) => (
                  <fieldset key={q.text}>
                    <legend>
                      {i + 1}. {q.text}
                    </legend>
                    {q.options.map((o, j) => (
                      <label key={o}>
                        <input
                          type="radio"
                          name={`question-${i}`}
                          checked={answers[i] === j}
                          onChange={() =>
                            setAnswers((a) => {
                              const n = [0, 1, 2].map((k) => a[k] ?? -1);
                              n[i] = j;
                              return n;
                            })
                          }
                        />
                        {o}
                      </label>
                    ))}
                  </fieldset>
                ))
              : null}
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || !ready}
                onClick={() => send(true)}
              >
                提交练习
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => send(true, true)}
              >
                结束本次练习
              </button>
            </div>
            <small>关闭窗口会保留本幕题目；提交后不可重刷奖励。</small>
          </>
        )}
      </section>
    </Modal>
  );
}
type MiniProps = Parameters<typeof LegacyMiniGame>[0];
export function MiniGame(props: MiniProps) {
  return props.state.script?.activity?.game ? (
    <ArcadeSession {...props} />
  ) : (
    <LegacyMiniGame {...props} />
  );
}
function ArcadeSession({ state, request, onState, onClose }: MiniProps) {
  const activity = state.script!.activity!;
  const [challenge, setChallenge] = useState<Challenge | null>(null),
    [result, setResult] = useState<PracticeResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [finishedMoves, setFinishedMoves] = useState<number[] | undefined>();
  async function send(moves?: number[]) {
    setBusy(true);
    setError("");
    if (moves) setFinishedMoves(moves);
    try {
      const data = await request(`sessions/${state.id}/activity`, {
        expectedStateVersion: state.version,
        ...(moves ? { challengeId: challenge!.id, answers: moves } : {}),
      });
      if (data.challenge) setChallenge(data.challenge);
      if (data.result) {
        setResult(data.result);
        if (data.state) onState(data.state);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "保存未完成，请重试；操作记录仍保留。",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void send();
  }, []);
  return (
    <Modal title={activity.title} onClose={onClose} className="arcade-modal">
      <section className="mini-game">
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button disabled={busy} onClick={() => send(finishedMoves)}>
              重试
            </button>
          </div>
        ) : null}
        {result ? (
          <>
            <h3>{result.success ? "挑战完成" : "这次没能完成目标"}</h3>
            <p>
              {result.reward
                ? `${attributeLabels[activity.attribute]} +${result.reward}`
                : "属性没有减少"}
            </p>
            {result.dialogue.map((d, i) => (
              <p key={i}>
                <b>{state.script?.roleNames?.[d.speaker] ?? "猫咪城主"}：</b>
                {d.text}
              </p>
            ))}
            <button className="primary" onClick={onClose}>
              继续故事
            </button>
          </>
        ) : challenge?.game ? (
          <ArcadeBoard
            challengeId={challenge.id}
            spec={{
              game: challenge.game,
              seed: challenge.seed ?? 0,
              difficulty: challenge.difficulty,
              rulesVersion: challenge.rulesVersion,
            }}
            disabled={busy || !!error}
            onFinish={(moves) => void send(moves)}
          />
        ) : (
          <p role="status">正在准备挑战…</p>
        )}
      </section>
    </Modal>
  );
}
