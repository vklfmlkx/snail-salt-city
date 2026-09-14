export const arcadeDifficulties = ["story", "normal", "hard"] as const;
export type ArcadeDifficulty = (typeof arcadeDifficulties)[number];
export const arcadeDifficultyNames = {
  story: "体验剧情",
  normal: "命运掷骰",
  hard: "逆风跑团",
};
export const arcadeTuning = {
  story: {
    flightSpeed: 2.2,
    flightDrop: 20,
    flightGap: 116,
    guards: 2,
    mistake: 50,
    jumpRatio: [0.38, 0.53],
  },
  normal: {
    flightSpeed: 2.9,
    flightDrop: 44,
    flightGap: 104,
    guards: 3,
    mistake: 35,
    jumpRatio: [0.66, 0.78],
  },
  hard: {
    flightSpeed: 3.6,
    flightDrop: 68,
    flightGap: 94,
    guards: 5,
    mistake: 20,
    jumpRatio: [0.87, 0.94],
  },
} as const;
