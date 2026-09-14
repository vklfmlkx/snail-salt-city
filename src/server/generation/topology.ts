/** Reusable example DAG: routing and knowledge structure, without story prose. */
export function referenceTopology() {
  const stats = ["body", "agility", "mind", "presence"] as const;
  const nodes = Array.from({ length: 6 }, (_, i) => ({
    id: `n${i + 1}`,
    requires: [] as string[],
    reveals: i === 1 || i === 2 ? ["f1"] : [],
    choices: stats.map((stat) => ({
      stat,
      ...Object.fromEntries(
        ["success", "partial", "failure"].map((outcome) => {
          let to =
            i === 0
              ? stat === "mind" || stat === "presence"
                ? "n3"
                : "n2"
              : i === 1 || i === 2
                ? "n4"
                : i === 3
                  ? "n5"
                  : "n6";
          if (i === 0 && stat === "mind" && outcome === "failure") to = "bad_1";
          if (
            ((i === 1 && stat === "mind") || (i === 2 && stat === "agility")) &&
            outcome === "failure"
          )
            to = "bad_2";
          if (i === 4 && stat === "presence" && outcome === "failure")
            to = "bad_3";
          if (i === 5)
            to =
              outcome === "failure"
                ? "bad_3"
                : stat === "agility"
                  ? "good_2"
                  : stat === "mind" && outcome === "success"
                    ? "true"
                    : "good_1";
          return [
            outcome,
            {
              to,
              grants:
                i === 3 && stat === "mind" && outcome === "success"
                  ? ["f2"]
                  : [],
              ...(to === "true"
                ? { whenAll: ["f1", "f2"], otherwise: "good_1" }
                : {}),
            },
          ];
        }),
      ),
    })),
  }));
  return {
    nodes,
    endings: ["good_1", "good_2", "bad_1", "bad_2", "bad_3", "true"].map(
      (id) => ({ id, requires: id === "true" ? ["f1", "f2"] : [] }),
    ),
  };
}
