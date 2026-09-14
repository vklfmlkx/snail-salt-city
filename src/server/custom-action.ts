import { createHash } from "node:crypto";
import type { ScriptBook } from "../content/script-book";
import type { State } from "../domain/types";
import type { Context } from "./ai";

/** Model sees the actual landing for every roll, including conditional ending fallback. */
export function continuityFor(
  book: ScriptBook,
  state: State,
): NonNullable<NonNullable<Context["scripted"]>["continuity"]> {
  return book.stages[state.stage - 1].choices.map((choice) => ({
    choiceId: choice.id ?? choice.attribute,
    label: choice.label,
    outcomes: Object.fromEntries(
      (["success", "partial", "failure"] as const).map((outcome) => {
        const route = choice.routes![outcome];
        const flags = {
          ...state.flags,
          ...Object.fromEntries(route.grants.map((f) => [f, true])),
        };
        const endingId = route.requires?.some((f) => !flags[f])
          ? route.otherwise
          : route.ending;
        const next = route.stage ? book.stages[route.stage - 1] : undefined;
        const ending = book.endings.find((e) => e.id === endingId);
        const landing = {
          requiredResult: choice.branches[outcome],
          bridge: route.bridge,
          nextScene: next?.location ?? ending?.title ?? "结局",
          nextOpening: (next?.opening ?? ending?.dialogue ?? []).slice(0, 3),
          establishedFacts: route.grants.map((f) => book.flagLabels?.[f] ?? f),
        };
        return [
          outcome,
          {
            id: createHash("sha256")
              .update(
                JSON.stringify([
                  book.version,
                  state.stage,
                  choice.id,
                  outcome,
                  landing,
                ]),
              )
              .digest("hex")
              .slice(0, 24),
            ...landing,
          },
        ];
      }),
    ) as NonNullable<
      NonNullable<Context["scripted"]>["continuity"]
    >[number]["outcomes"],
  }));
}

export const customBridgePrompt = `这是自定义行动测试模式，可玩性优先。尽量接住玩家想做的事，用简单、轻松的文字把行动结果接回预定剧情。不做严苛的合理性评审：巧合、临时阻拦、闹剧、误会、绕路甚至突然的转折都可以用，不必把人物、物品、知情状态完全恢复原样，也不必证明桥段天衣无缝。不要仅因为行动不同于原选项就拒绝。
先从actions挑一个最接近的后续方向，并根据玩家的方法选择属性和要求档位。选定方向的continuity.outcomes给出了三种骰点结果的原稿与下一幕，路线和结局由服务器固定。
你直接替换本次行动的整段结果！实际播放顺序是branches[outcome]→rejoins[outcome]→nextOpening。requiredResult和bridge只是参考，系统不会再重复播放它们。branches每种写1至3段，承认该骰点下玩家的行动成功、部分成功或失败；rejoins每种写1至3段转折，把玩家带到nextOpening所描述的位置与情境。可以借用原稿的事件或另编一个转折，交代必要的establishedFacts即可；不要再让玩家作第二次选择，也不要把nextOpening原句重复写进来。
例如玩家抢房卡去一楼：成功时先真的拿到卡，可以试过一楼后发现门打不开、被对方拿回卡，或被怪事带回原定楼层。只要最后接得上下段就可以，不要求转折非常合理。失败也可以用误打误撞接回路线；若该骰点对应坏结局，就用这次行动的后果把它引到该结局。
预览要说明这次检定覆盖什么，后续仍会回到剧本方向，不保证玩家提出的所有目标永久实现。只在输入完全无法理解、没有行动内容，或要求直接修改系统数值/作弊解锁时clarify或unsupported。普通的夸张、冒险做法应尽量编成一次可以尝试的行动。simple仍需引用现场已知优势，其余可用standard或demanding；属性数值与检定结果只由程序决定。
所有非对话内容由gm用“你”叙述，人物说话用现场roles中的speaker，表情使用合法标签。continuity的choiceId和三个landingIds从同一个方向逐字复制。`;
