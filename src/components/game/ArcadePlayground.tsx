"use client";
import { useState } from "react";
import {
  arcadeGames,
  gamesByAttribute,
  gameNames,
  playArcade,
  type ArcadeGame,
} from "@/domain/arcade";
import { attributeLabels, attributes } from "@/domain/types";
import { ArcadeBoard } from "./ArcadeBoard";
import {
  arcadeDifficulties,
  arcadeDifficultyNames,
  type ArcadeDifficulty,
} from "@/domain/arcade-difficulty";
export function ArcadePlayground({ onBack }: { onBack: () => void }) {
  const [difficulty, setDifficulty] = useState<ArcadeDifficulty>("normal");
  const [game, setGame] = useState<ArcadeGame>("summit"),
    [round, setRound] = useState(() => ({
      seed: Math.floor(Math.random() * 100000),
      id: crypto.randomUUID(),
    })),
    [result, setResult] = useState<boolean | null>(null);
  function restart(g = game) {
    sessionStorage.removeItem(`snail:arcade:playground-${round.id}`);
    sessionStorage.removeItem(`snail:arcade:playground-${round.id}:reveal`);
    setGame(g);
    setRound({
      seed: Math.floor(Math.random() * 100000),
      id: crypto.randomUUID(),
    });
    setResult(null);
  }
  return (
    <section className="story-library playground">
      <header>
        <div>
          <h1>小游戏广场</h1>
          <p>这里是故事中的小游戏。挑一款，单独玩一局。</p>
        </div>
        <button onClick={onBack}>返回封面</button>
      </header>
      <div className="playground-layout">
        <nav aria-label="选择小游戏">
          {attributes.map((a) => (
            <div key={a}>
              <h3>{attributeLabels[a]}</h3>
              {arcadeGames
                .filter((g) => gamesByAttribute[a].includes(g))
                .map((g) => (
                  <button
                    key={g}
                    aria-pressed={g === game}
                    onClick={() => restart(g)}
                  >
                    {gameNames[g]}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <article className="playground-stage">
          <fieldset className="arcade-difficulty">
            <legend>难度</legend>
            {arcadeDifficulties.map((d) => (
              <button
                key={d}
                aria-pressed={difficulty === d}
                onClick={() => {
                  setDifficulty(d);
                  restart();
                }}
              >
                {arcadeDifficultyNames[d]}
              </button>
            ))}
          </fieldset>
          {result === null ? (
            <ArcadeBoard
              practice
              key={round.id}
              spec={{ game, seed: round.seed, difficulty, rulesVersion: 3 }}
              challengeId={`playground-${round.id}`}
              disabled={false}
              onFinish={(moves) =>
                setResult(
                  playArcade(
                    { game, seed: round.seed, difficulty, rulesVersion: 3 },
                    moves,
                  ).success,
                )
              }
            />
          ) : (
            <div role="status">
              <h2>{result ? "成功！" : "这次没完成"}</h2>
              <p>再来一局，还是换个游戏？</p>
            </div>
          )}
          <button className="primary" onClick={() => restart()}>
            重新开一局
          </button>
        </article>
      </div>
    </section>
  );
}
