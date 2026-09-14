export function checkChances(value: number, difficulty: number, modifier = 0) {
  const counts = { success: 0, partial: 0, failure: 0 };
  for (let die = 1; die <= 10; die++) {
    const margin = die + value + modifier - difficulty;
    counts[margin >= 0 ? "success" : margin >= -2 ? "partial" : "failure"] +=
      10;
  }
  return counts;
}
