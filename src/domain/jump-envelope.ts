/** Integrates the same 30 Hz physics as the game. Distances are measured from
 * take-off centre to the descending crossing of each possible landing height.
 * Height and range form a coupled envelope, not two independent maxima. */
export const jumpPhysics = {
  speed: 2.6,
  impulse: -9,
  gravity: 0.48,
  fall: 9,
  dashSpeed: 7,
  dashFrames: 5,
  dashVertical: -1,
};
export type JumpReach = {
  distance: number;
  frames: number;
  dashAt: number;
  height: number;
};
export function jumpReach(rise: number, allowDash = true): JumpReach {
  let best: JumpReach = { distance: 0, frames: 0, dashAt: -1, height: 0 };
  for (let dashAt = -1; dashAt < (allowDash ? 38 : 0); dashAt++) {
    let x = 0,
      y = 0,
      vy = jumpPhysics.impulse,
      top = 0;
    for (let t = 0; t < 110; t++) {
      const old = y;
      if (t === dashAt) vy = jumpPhysics.dashVertical;
      const dashing =
        dashAt >= 0 && t >= dashAt && t < dashAt + jumpPhysics.dashFrames;
      if (!dashing) vy = Math.min(jumpPhysics.fall, vy + jumpPhysics.gravity);
      x += dashing ? jumpPhysics.dashSpeed : jumpPhysics.speed;
      y += vy;
      top = Math.max(top, -y);
      if (vy >= 0 && old <= -rise && y >= -rise && t > 1) {
        if (x > best.distance)
          best = { distance: x, frames: t + 1, dashAt, height: top };
        break;
      }
      if (y > 180) break;
    }
  }
  return best;
}
const reachCache = new Map<string, JumpReach>();
export function landingReach(rise: number, dash = true) {
  const key = `${rise}:${dash}`;
  if (!reachCache.has(key)) reachCache.set(key, jumpReach(rise, dash));
  return reachCache.get(key)!;
}
export const jumpCapability = {
  height: Math.max(
    ...Array.from({ length: 38 }, (_, i) => jumpReach(i * 2).height),
  ),
  normalRange: jumpReach(0, false).distance,
  dashRange: jumpReach(0, true).distance,
};
