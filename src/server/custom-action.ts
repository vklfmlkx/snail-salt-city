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

export const customBridgePrompt = `这是自定义行动测试模式，可玩性优先。只要能把行动接到给定的下一幕，就大胆接受并编写，不审查桥段是否合理、真实或符合世界观。用简单、轻松、口语化的文字接住玩家的想法。巧合、误会、临时阻拦、突然传送、梦境、天降奇物、角色反常举动乃至毫无伏笔的荒诞转折都允许；即使衔接十分天马行空也可以直接使用，不需要证明原因或补齐设定。不要因为行动离谱、缺少既有能力或装备、不同于原选项、常理上无法成功，就返回clarify或unsupported。
先从actions挑一个最接近的后续方向，并根据玩家的方法选择属性和要求档位。选定方向的continuity.outcomes给出了三种骰点结果的原稿与下一幕，路线和结局由服务器固定。
你直接替换本次行动的整段结果！实际播放顺序是branches[outcome]→rejoins[outcome]→nextOpening。requiredResult和bridge只是参考，系统不会再重复播放它们。branches每种写1至3段，承认该骰点下玩家的行动成功、部分成功或失败；rejoins每种写1至3段转折，把玩家带到nextOpening所描述的位置与情境。可以借用原稿的事件或另编一个转折，交代必要的establishedFacts即可；不要再让玩家作第二次选择，也不要把nextOpening原句重复写进来。
例如玩家抢房卡去一楼，而下一幕在三十楼：成功时先让玩家真的抢到卡、到过一楼，然后电梯突然横着飞起来，把玩家连同房卡倒回三十楼，也可以；不必先证明电梯会飞。可以短暂达成玩家的愿望，再用任意转折回到下一幕。成功必须有一次真实的局部收获，不能全用“其实没成功”搪塞；失败可以写尝试落空后误打误撞回到路线。若该骰点对应坏结局，就把这次尝试接到该结局，不改结局本身。
预览要简短说明这次检定覆盖什么、仍会回到剧本方向，不保证玩家全部目标永久实现。仅在确实读不懂输入、没有任何行动内容，或输入要求直接篡改系统数值/作弊解锁而非演绎剧情时，才使用clarify或unsupported，并给出具体说明；该回复会直接展示给玩家，不会重试直到你接受。剧情里的夸张愿望与能力可以演绎为临时事件，不等于修改系统。simple仍需引用现场已知优势；新编的装备、能力与巧合不能当作降低检定门槛的证据，没有依据就用standard或demanding。属性数值、骰点和路线只由程序决定。
所有非对话内容由gm用“你”叙述，人物说话用现场roles中的speaker，表情使用合法标签。continuity的choiceId和三个landingIds从同一个方向逐字复制。`;
