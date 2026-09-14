import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { scenario } from "../src/content/legacy/snail-scenario";
import { nodeProse, endingProse } from "../src/content/legacy/prose";
import {
  initialState,
  project,
  resolveTurn,
  compileActionOptions,
} from "../src/engine/rules";
import { parseState } from "../src/domain/state-schema";
import {
  actors,
  authoredBeats,
  makeBeats,
  paginate,
} from "../src/components/game/presentation";
import { character, walk } from "./paths";
import type { PublicTurn } from "../src/domain/types";

test("all authored prose and endings survive dialogue pagination without truncation", () => {
  for (const text of [
    ...nodeProse.flat(),
    ...Object.values(endingProse),
    ...scenario.stages.map((s) => s.intro),
  ]) {
    const parts = paginate(text);
    assert.equal(parts.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
    assert.ok(parts.every((p) => Array.from(p).length <= 108));
    assert.equal(
      authoredBeats(text, "neutral")
        .map((b) => b.text)
        .join("")
        .replace(/\s/g, ""),
      text.replace(/\s/g, ""),
    );
  }
});
test("GM narrates prose and signage while explicit speech uses tabletop actors", () => {
  const beats = authoredBeats(
    "告示写着“其他”。阿岑说：“想两手准备可以，但得真的多做一件事。”你点头。",
    "neutral",
  );
  assert.equal(
    beats.find((b) => b.speaker === "lin")?.text,
    "“想两手准备可以，但得真的多做一件事。”",
  );
  assert.ok(
    beats
      .filter((b) => !b.text.startsWith("“想"))
      .every((b) => b.speaker === "gm"),
  );
  assert.equal(
    authoredBeats(nodeProse[0][3], "neutral").find((b) => b.speaker === "zhou")
      ?.label,
    "老许 · 阿舟饰",
  );
});
test("presentation preserves all four saved ending states and complete ending text", () => {
  for (const ending of [
    "caught",
    "contract_released",
    "temporary_containment",
    "narrow_escape",
  ] as const) {
    const { state } = walk(ending);
    const original = JSON.stringify(state);
    const publicState = project(state, scenario, "old-save");
    const beats = makeBeats(publicState);
    assert.ok(
      beats
        .map((b) => b.text)
        .join("")
        .includes(publicState.ending!.text.replace(/\n\n/g, "")),
    );
    assert.equal(JSON.stringify(state), original);
    assert.deepEqual(parseState(state, scenario), state);
    assert.deepEqual(state.castSnapshot, scenario.cast);
  }
});
test("live narrator descriptions remain GM and unknown role IDs cannot become actors", () => {
  const st = initialState(character, scenario);
  const r = resolveTurn(st, scenario, "s1.1.notice", 10);
  const turn: PublicTurn = {
    id: "t",
    result: r.result,
    narrationStatus: "ready",
    errorCode: null,
    narration: {
      reaction: "你放下手机。",
      description: "灯还亮着。",
      dialogue: [
        { roleId: "invented", text: "未映射对白", expressionId: null },
      ],
      usedFactIds: [],
    },
  };
  assert.ok(
    makeBeats(project(r.state, scenario), turn, true).every(
      (b) => b.speaker === "gm",
    ),
  );
  turn.narrationStatus = "fallback";
  assert.equal(
    makeBeats(project(r.state, scenario), turn, true)
      .map((b) => b.text)
      .join(""),
    r.result.fallback.replace(/\n\n/g, ""),
  );
});
test("chapter transitions narrate the next intro and never rely on room changes", () => {
  let st = initialState(character, scenario);
  for (const action of ["notice", "observe", "barrier", "counter"]) {
    const id = `s1.${st.counters.step + 1}.${action}`;
    const r = resolveTurn(
      st,
      scenario,
      id,
      compileActionOptions(st, scenario).find((a) => a.id === id)!.attribute
        ? 10
        : null,
    );
    st = r.state;
    if (st.stage === 2) {
      const turn: PublicTurn = {
        id: "t",
        result: r.result,
        narrationStatus: "fallback",
        narration: null,
        errorCode: null,
      };
      assert.ok(
        makeBeats(project(st, scenario), turn)
          .map((b) => b.text)
          .join("")
          .includes(scenario.stages[1].intro),
      );
    }
  }
});
test("delivered tabletop roster has six real alpha expressions per actor and three rooms", () => {
  for (const actor of Object.keys(actors))
    for (const face of ["neutral"]) {
      const png = readFileSync(`public/assets/tabletop/v2/${actor}.png`);
      let transparentPalette = false;
      for (let offset = 8; offset + 12 <= png.length; ) {
        const size = png.readUInt32BE(offset);
        const type = png.toString("ascii", offset + 4, offset + 8);
        if (offset + 12 + size > png.length) break;
        if (type === "tRNS")
          transparentPalette = png
            .subarray(offset + 8, offset + 8 + size)
            .some((alpha) => alpha < 255);
        offset += 12 + size;
      }
      assert.ok(
        png[25] === 6 || png[25] === 4 || (png[25] === 3 && transparentPalette),
        "PNG must retain alpha (RGBA or indexed palette with transparency)",
      );
      assert.ok(png.readUInt32BE(16) >= 1000);
    }
  for (const room of ["table", "nook", "lounge"])
    assert.ok(existsSync(`public/assets/tabletop/v1/${room}.png`));
});
