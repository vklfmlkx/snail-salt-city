import type { PixelState, DuelEvent } from "@/domain/pixel-arcade";
export function duelEventLabel(e: DuelEvent) {
  const who = e.actor === 0 ? "你" : "对手";
  if (e.kind === "shot")
    return `${who} → ${e.target === e.actor ? "自己" : e.target === 0 ? "你" : "对手"}`;
  return e.kind === "reload"
    ? "装填弹药"
    : e.kind === "skip"
      ? `${who}被锁住`
      : `${who} · ${{ heal: "急救包", peek: "放大镜", cuff: "手铐" }[e.kind]}`;
}
const palette = [
  "#77d6b2",
  "#f5a65d",
  "#e794c6",
  "#93bdf8",
  "#e5d783",
  "#c0a4e6",
];
export function paintPixel(
  ctx: CanvasRenderingContext2D,
  s: PixelState,
  animation?: { event: DuelEvent; progress: number },
) {
  const W = 480,
    H = 288;
  ctx.imageSmoothingEnabled = false;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const text = (
    str: string,
    x: number,
    y: number,
    color = "#f8eccb",
    size = 12,
  ) => {
    ctx.fillStyle = color;
    ctx.font = `${size}px monospace`;
    ctx.fillText(str, x, y);
  };
  const person = (x: number, y: number, color: string, scale = 1, step = 0) => {
    const p = (a: number, b: number, w: number, h: number, c: string) =>
      rect(x + a * scale, y + b * scale, w * scale, h * scale, c);
    p(-5, -18, 10, 8, "#302c42");
    p(-4, -16, 9, 6, "#f1cbad");
    p(2, -15, 1, 2, "#282335");
    p(-5, -10, 10, 7, color);
    p(-7, -9, 2, 5, "#f1cbad");
    p(5, -9, 2, 5, "#f1cbad");
    p(-4, -3, 3, 3 + step, "#293445");
    p(2, -3, 3, 3 - step, "#293445");
  };
  rect(0, 0, W, H, "#141c35");
  for (let i = 0; i < 45; i++)
    rect(
      (i * 107 + s.seed * 7) % W,
      (i * 43 + s.seed) % 170,
      i % 5 ? 1 : 2,
      2,
      i % 2 ? "#617f9d" : "#b3c4c4",
    );
  if (s.game === "summit" || s.game === "flight") {
    const camera = Math.max(0, s.x - (s.game === "flight" ? 85 : 140));
    rect(370, 25, 28, 28, "#f8dfad");
    rect(360, 20, 23, 24, "#141c35");
    for (let i = -1; i < 8; i++) {
      const x = i * 100 - ((camera * 0.15) % 100);
      for (let y = 0; y < 10; y++)
        rect(x + 50 - y * 6, 104 + y * 16, y * 12, 16, "#23354e");
    }
    if (s.game === "summit") {
      for (const [i, p] of s.platforms.entries()) {
        const x = p.x - camera;
        if (x > 480 || x + p.w < 0) continue;
        rect(x, p.y, p.w, 74, "#554358");
        rect(x, p.y, p.w, 5, "#b9c5cf");
        rect(x + 3, p.y + 5, p.w - 6, 4, "#7f92a8");
        for (let k = 0; k < p.w - 8; k += 18) {
          rect(x + k + 2, p.y + 19, 12, 3, "#72566a");
          rect(x + k + 8, p.y + 38, 8, 3, "#392f49");
        }
        if (i && i < 8) {
          rect(x + 12, p.y - 19, 2, 19, "#ddd5ac");
          rect(
            x + 14,
            p.y - 19,
            8,
            7,
            i <= s.checkpoint ? "#7fe5b0" : "#657d99",
          );
        }
        if (i === 8) {
          rect(x + p.w - 20, p.y - 44, 3, 44, "#eadfc0");
          rect(x + p.w - 17, p.y - 44, 22, 15, "#f8ba64");
          text("GOAL", x + p.w - 54, p.y - 53, "#ffe3a2");
        }
      }
      if (s.dashTicks)
        for (let i = 1; i < 5; i++)
          rect(
            s.x - camera - Math.sign(s.vx) * i * 8,
            s.y - 9,
            5,
            3,
            "#8cf4ff",
          );
      person(
        s.x - camera,
        s.y,
        s.dash ? "#ed858d" : "#88b3e6",
        1,
        s.grounded && s.vx ? s.tick % 2 : 0,
      );
    } else {
      for (const g of s.gates) {
        const x = g.x - camera,
          top = g.y - g.gap / 2,
          bottom = g.y + g.gap / 2;
        rect(x, 0, 30, Math.round(top), "#367e88");
        rect(x - 4, top - 8, 38, 8, "#70b7a8");
        rect(x, bottom, 30, 288 - Math.round(bottom), "#367e88");
        rect(x - 4, bottom, 38, 8, "#70b7a8");
        rect(x + 4, 0, 4, Math.max(0, Math.round(top - 8)), "#4b9b99");
        rect(x + 4, bottom + 8, 4, 288 - Math.round(bottom + 8), "#4b9b99");
        for (let y = 24; y < top - 8; y += 24)
          rect(x + 15, y, 12, 2, "#286374");
      }
      const x = s.x - camera;
      rect(x - 8, s.y - 6, 15, 12, "#f5c267");
      rect(x - 10, s.y + (s.vy < 0 ? -8 : 0), 9, 6, "#e89160");
      rect(x + 3, s.y - 5, 5, 5, "#fff8d9");
      rect(x + 6, s.y - 4, 2, 3, "#1b2947");
      rect(x + 7, s.y, 6, 3, "#e66f63");
      rect(0, 284, W, 4, "#70b7a8");
    }
  } else if (s.game === "roulette") {
    const d = s.duel,
      e = animation?.event,
      p = Math.min(1, animation?.progress ?? 0);
    const shown = e && p > 0.7 ? e.after : d;
    rect(20, 22, 440, 253, "#332a3d");
    rect(30, 30, 420, 237, "#493448");
    rect(58, 86, 364, 126, "#172d33");
    rect(66, 93, 348, 112, "#244641");
    for (let x = 70; x < 417; x += 24) rect(x, 96, 1, 105, "#365548");
    person(240, 79, "#d0a078", 3);
    rect(220, 22, 40, 7, "#202633");
    person(240, 276, "#87b1d3", 2);
    text("对手", 281, 46, "#ebaaa0");
    text("你", 281, 242, "#93e0c6");
    for (let i = 0; i < 3; i++) {
      rect(280 + i * 18, 53, 12, 10, i < shown.hp[1] ? "#f29b97" : "#685569");
      rect(280 + i * 18, 250, 12, 10, i < shown.hp[0] ? "#8bdfb7" : "#685569");
    }
    const shells = e?.kind === "reload" && p > 0.5 ? e.after.shells : d.shells;
    shells.forEach((_, i) => {
      const x = 188 + i * 23;
      rect(x, 113, 12, 21, "#a08264");
      rect(x, 128, 12, 6, "#ddc48b");
      text("?", x + 2, 125, "#282b32", 10);
    });
    if (d.known[0] !== null) {
      rect(170, 116, 9, 12, d.known[0] ? "#f09b86" : "#a6d5e6");
      text(
        d.known[0] ? "实" : "空",
        166,
        147,
        d.known[0] ? "#f09b86" : "#a6d5e6",
      );
    }
    const actorY = e?.actor === 1 ? 98 : 218,
      targetY = e?.target === 1 ? 62 : 252;
    const rings = (x: number, y: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      for (const dx of [-8, 8]) {
        ctx.beginPath();
        ctx.arc(x + dx, y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      rect(x - 3, y - 2, 6, 3, color);
    };
    if (d.locked[1]) rings(240, 72, "#dfc580");
    if (d.locked[0]) rings(240, 264, "#dfc580");
    let gx = 240,
      gy = 172,
      angle = 0;
    if (e?.kind === "shot") {
      const t = Math.min(1, p / 0.35);
      gy = 172 + (actorY - 172) * t;
      angle = (e.target === 1 ? -Math.PI / 2 : Math.PI / 2) * t;
      if (p > 0.5 && p < 0.67) gy += (e.target === 1 ? 1 : -1) * 5;
    }
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(angle);
    rect(-23, -5, 58, 8, "#9eb0b2");
    rect(-28, 3, 28, 8, "#8c6350");
    rect(-34, 0, 13, 18, "#bb8f65");
    if (e?.kind === "shot" && p > 0.5 && p < 0.68) {
      rect(
        38,
        -(e.shell ? 9 : 3),
        e.shell ? 18 : 8,
        e.shell ? 18 : 6,
        e.shell ? "#ffd780" : "#bed2d4",
      );
    }
    ctx.restore();
    if (e?.kind === "shot" && p > 0.65) {
      if (e.shell) {
        text("−1", 210, targetY, e.target ? "#ffaaa0" : "#a6efd0", 23);
        ctx.strokeStyle = "#ea9b87";
        ctx.lineWidth = 3;
        ctx.strokeRect(215, targetY - 26, 50, 42);
      } else {
        ctx.strokeStyle = "#a9c5cc";
        ctx.beginPath();
        ctx.arc(240, targetY - 10, 11 + p * 5, 0, Math.PI * 2);
        ctx.stroke();
        text("空弹", 218, 170, "#cbded7", 14);
      }
    }
    if (e && ["heal", "peek", "cuff", "skip"].includes(e.kind)) {
      const t = Math.min(1, p / 0.5),
        x = 406 + (240 - 406) * t,
        y = 167 + ((e.kind === "peek" ? 123 : targetY) - 167) * t;
      if (e.kind === "heal") {
        rect(x - 13, y - 13, 26, 26, "#476a64");
        rect(x - 3, y - 9, 6, 18, "#a4f0c3");
        rect(x - 9, y - 3, 18, 6, "#a4f0c3");
        if (p > 0.6) text("+1", x + 17, y, "#a4f0c3", 22);
      }
      if (e.kind === "peek") {
        ctx.strokeStyle = "#c7e3e9";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.stroke();
        rect(x + 9, y + 10, 5, 18, "#bd946e");
        if (p > 0.55 && e.actor === 0) {
          rect(x - 5, y - 8, 10, 16, e.shell ? "#e89176" : "#c9dece");
          text(e.shell ? "实弹" : "空弹", x - 16, y + 35, "#f3d3a7");
        }
      }
      if (e.kind === "cuff" || e.kind === "skip")
        rings(
          e.kind === "skip" ? 240 : x,
          e.kind === "skip" ? targetY : y,
          "#e8c886",
        );
    }
  } else {
    ctx.save();
    ctx.translate(0, 29);
    ctx.scale(1, 0.74);
    rect(0, 0, W, H, "#233c46");
    const ox = 16,
      oy = 4,
      tile = 28;
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 16; x++) {
        const px = ox + x * tile,
          py = oy + y * tile,
          cell = y * 16 + x;
        if (s.walls.includes(cell)) {
          rect(px, py, 27, 27, "#345661");
          rect(px + 2, py + 2, 23, 5, "#57807d");
          rect(px + 3, py + 15, 10, 2, "#223e4c");
        } else {
          rect(px, py, 27, 27, (x + y) % 2 ? "#202e43" : "#243448");
          rect(px + 4, py + 22, 6, 1, "#3b4556");
        }
      }
    rect(ox + 14 * tile, oy + 8 * tile, 26, 26, "#c89c58");
    text("GO", ox + 14 * tile + 4, oy + 8 * tile + 17, "#172d35");
    for (const [i, p] of (s.rulesVersion === 3
      ? []
      : s.trail.slice(1)
    ).entries())
      person(
        ox + (p % 16) * tile + 14,
        oy + Math.floor(p / 16) * tile + 23,
        palette[i % 6],
      );
    for (const [i, p] of s.friends.entries()) {
      person(
        ox + (p % 16) * tile + 14,
        oy + Math.floor(p / 16) * tile + 23,
        palette[i],
      );
      text(
        "!",
        ox + (p % 16) * tile + 12,
        oy + Math.floor(p / 16) * tile + 6,
        "#ffeaba",
      );
    }
    for (const p of s.guards) {
      rect(
        ox + (p % 16) * tile + 6,
        oy + Math.floor(p / 16) * tile + 7,
        16,
        16,
        s.stunned ? "#8388b4" : "#da7580",
      );
      rect(
        ox + (p % 16) * tile + 9,
        oy + Math.floor(p / 16) * tile + 11,
        10,
        3,
        "#3c293e",
      );
    }
    person(ox + s.x * tile + 14, oy + s.y * tile + 23, "#f9deb2");
    if (s.stunned) {
      ctx.strokeStyle = "#99decc";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + s.x * tile - 12, oy + s.y * tile - 12, 52, 52);
    }
    ctx.restore();
  }
}
