"use client";
import { useState, type CSSProperties } from "react";
import { useAssetUrl } from "./GameAssets";
import { attributes, attributeLabels, type Character } from "@/domain/types";
import { Portrait } from "./Portrait";
export function CharacterForm({
  onCreate,
  busy,
  onCancel,
  story,
}: {
  onCreate: (c: Character & { scenarioVersion: string }) => void;
  busy: boolean;
  onCancel: () => void;
  story?: { version: string; title: string; description: string };
}) {
  const cat = useAssetUrl("/assets/tabletop/v1/gm-smile.png");
  const backdrop = useAssetUrl("/assets/tabletop/v1/table.png");
  const [stats, setStats] = useState({
    body: 5,
    agility: 5,
    mind: 5,
    presence: 5,
  });
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const [avatar, setAvatar] = useState<"hero_f" | "hero_m">("hero_f");
  const scenarioVersion = story?.version ?? "homecoming-branch-3.0";
  const [difficulty, setDifficulty] = useState<"story" | "normal" | "hard">(
    "normal",
  );
  return (
    <section
      className="creation"
      style={{ "--creation-backdrop": `url("${backdrop}")` } as CSSProperties}
    >
      <div>
        <span className="chapter-number">入座之前 / 角色卡</span>
        <h2>
          先认识一下，
          <br />
          故事中的你。
        </h2>
        <p>
          选一副主角形象，坐进故事里。
          <br />
          四项属性合计20，每项2—8。
        </p>
        <button className="text-button" onClick={onCancel}>
          ← 返回书架
        </button>
        <img className="creation-cast" src={cat} alt="等你入座的猫咪城主" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            name: "你",
            background: "",
            stats,
            avatar,
            scenarioVersion,
            difficulty,
          });
        }}
      >
        <label>
          本次剧本
          <strong>{story?.title ?? "错位百年"}</strong>
        </label>
        <p className="muted">{story?.description ?? "你将扮演故事主角。"}</p>
        {scenarioVersion.startsWith("homecoming") ? (
          <p className="muted">
            故事原作：
            <a
              href="https://www.zhihu.com/question/489255552/answer/3547523960"
              target="_blank"
              rel="noreferrer"
            >
              猫语 · 知乎
            </a>
            。作者保留著作权；商业使用需另行取得授权。
          </p>
        ) : null}
        <div className="avatar-selection">
          {(["hero_f", "hero_m"] as const).map((id) => (
            <button
              type="button"
              key={id}
              aria-label={id === "hero_f" ? "女主角" : "男主角"}
              aria-pressed={avatar === id}
              onClick={() => setAvatar(id)}
            >
              <Portrait actor={id} />
              {id === "hero_f" ? "女主角" : "男主角"}
            </button>
          ))}
        </div>
        <fieldset className="difficulty-picker">
          <legend>这桌想怎么跑？</legend>
          {[
            ["story", "体验剧情", "轻松读故事，小游戏也更容易。"],
            ["normal", "命运掷骰", "选择与技巧都有分量，适合初次冒险。"],
            ["hard", "逆风跑团", "检定更严格，小游戏更有挑战。"],
          ].map(([id, label, desc]) => (
            <label key={id}>
              <input
                type="radio"
                name="difficulty"
                value={id}
                checked={difficulty === id}
                onChange={() => setDifficulty(id as typeof difficulty)}
              />
              <strong>{label}</strong>
              <small>{desc}</small>
            </label>
          ))}
        </fieldset>
        <div className="presets" aria-label="属性分配方案">
          {[
            ["均衡同行", { body: 5, agility: 5, mind: 5, presence: 5 }],
            ["力气担当", { body: 8, agility: 4, mind: 4, presence: 4 }],
            ["身手灵活", { body: 4, agility: 8, mind: 4, presence: 4 }],
            ["脑力派", { body: 4, agility: 4, mind: 8, presence: 4 }],
            ["社交能手", { body: 4, agility: 4, mind: 4, presence: 8 }],
          ].map(([label, preset]) => {
            const values = preset as typeof stats;
            return (
              <button
                type="button"
                key={String(label)}
                aria-pressed={attributes.every((a) => stats[a] === values[a])}
                onClick={() => setStats(values)}
              >
                {String(label)}{" "}
                <small>{attributes.map((a) => values[a]).join(" / ")}</small>
              </button>
            );
          })}
        </div>
        <div className="stat-inputs">
          {attributes.map((a) => (
            <label key={a}>
              {attributeLabels[a]}
              <input
                aria-label={attributeLabels[a]}
                type="number"
                min={2}
                max={8}
                value={stats[a]}
                onChange={(e) =>
                  setStats({ ...stats, [a]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <p className={total !== 20 ? "error-text" : "muted"}>
          已分配 {total} / 20
        </p>
        <button
          className="primary"
          disabled={
            busy ||
            total !== 20 ||
            Object.values(stats).some(
              (n) => !Number.isInteger(n) || n < 2 || n > 8,
            )
          }
        >
          入座，开始跑团 <span>↗</span>
        </button>
      </form>
    </section>
  );
}
