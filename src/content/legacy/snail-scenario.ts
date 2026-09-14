import type {
  Action,
  Attribute,
  Condition,
  Effect,
  Outcome,
  Scenario,
} from "../../domain/types";
import { always, all, flag, has } from "../../domain/conditions";
import { nodeProse, endingProse } from "./prose";
const f = (id: string, value = true): Effect => ({
  kind: "flag_set",
  id,
  value,
});
const fact = (id: string): Effect => ({ kind: "reveal_fact", id });
const item = (id: string): Effect => ({ kind: "grant_item", id, quantity: 1 });
const res = (resource: "hp" | "supplies", value: number): Effect => ({
  kind: "resource_delta",
  resource,
  value,
});
const step: Effect = { kind: "counter_delta", id: "step", value: 1 };
type Choice = {
  key: string;
  label: string;
  attr?: Attribute;
  dc?: 8 | 11 | 14 | 17;
  condition?: Condition;
  cost?: Action["cost"];
  good?: Effect[];
  partial?: Effect[];
  bad?: Effect[];
  common?: Effect[];
  risk?: string;
  keywords?: string[];
  result?: [string, string, string];
};
const actions: Action[] = [];
const outcomeNames: Outcome[] = ["success", "partial", "failure"];
function add(stage: number, node: number, c: Choice, optionalText?: string) {
  const lead = optionalText ?? nodeProse[stage - 1][node - 1];
  const good = c.good ?? [],
    partial = c.partial ?? [res("supplies", -1)],
    bad = c.bad ?? [res("supplies", -1)];
  const branches = [good, partial, bad];
  const defaultResult = [
    "这次方法达到预定目标。你核对已经落实的变化，把能确认的部分记下来，保留下一步判断所需的距离。",
    "这次方法只完成了一部分。局面仍向前变化，但额外代价已经发生；你没有把未取得的好处算进准备，而是按当前真实条件继续。",
    "这次尝试没有达到预期。你接受本次后果，放弃反复试到成功的念头；已经公开的信息仍然有效，接下来使用实际可用的路线。",
  ];
  const effects = {} as Action["effects"],
    text = {} as Action["text"];
  outcomeNames.forEach((o, i) => {
    effects[o] = [...(c.common ?? []), ...branches[i], ...(node ? [step] : [])];
    text[o] = `${lead}\n\n${c.label}。${(c.result ?? defaultResult)[i]}`;
  });
  actions.push({
    id: `s${stage}.${node || "opt"}.${c.key}`,
    stage,
    step: node ? node - 1 : null,
    label: c.label,
    intent: c.label,
    target:
      stage <= 2
        ? "大堂设施与物业老许"
        : stage <= 4
          ? "仓库设备与维修员阿岑"
          : "码头执行位置",
    keywords: c.keywords ?? [c.label],
    attribute: c.attr ?? null,
    difficulty: c.attr ? (c.dc ?? 8) : null,
    condition: c.condition ?? always,
    cost: c.cost ?? {},
    effects,
    text,
    risk:
      c.risk ??
      (c.attr
        ? "部分成功或失败可能损失1物资；节点仍推进，未取得的奖励不会补发。"
        : "消耗1行动，按当前条件执行；确认后不可撤销。"),
    maxAttempts: 1,
    core: !!node,
  });
}
const pair = (s: number, n: number, a: Choice, b: Choice) => {
  add(s, n, a);
  add(s, n, b);
};
pair(
  1,
  1,
  {
    key: "notice",
    label: "核对奖金通知",
    attr: "mind",
    common: [fact("notice")],
    keywords: ["通知", "奖金", "短信", "收款"],
  },
  {
    key: "read",
    label: "逐项读完通知",
    common: [fact("notice")],
    cost: { supplies: 1 },
    risk: "消耗1物资与1行动；无需检定。",
  },
);
pair(
  1,
  2,
  {
    key: "observe",
    label: "隔着地砖观察轨迹",
    attr: "mind",
    common: [fact("tracking")],
    keywords: ["观察", "轨迹", "看看蜗牛"],
  },
  {
    key: "sidestep",
    label: "侧移试探追踪方向",
    attr: "agility",
    common: [fact("tracking")],
    keywords: ["侧移", "躲开", "避让"],
    bad: [res("hp", -1)],
  },
);
pair(
  1,
  3,
  {
    key: "barrier",
    label: "搬动隔离栏设置屏障",
    attr: "body",
    good: [f("barrier"), fact("barrier_visible")],
    partial: [res("supplies", -1)],
    bad: [res("hp", -1)],
    keywords: ["屏障", "隔离栏", "搬栏杆"],
  },
  {
    key: "detour",
    label: "推清洁车延长绕行路线",
    attr: "agility",
    good: [f("barrier"), fact("barrier_visible")],
    bad: [res("hp", -1)],
  },
);
pair(
  1,
  4,
  { key: "counter", label: "沿快递架前往物业窗口" },
  {
    key: "call",
    label: "边呼叫老许边移向窗口",
    attr: "presence",
    good: [res("supplies", 1)],
    keywords: ["物业", "老许", "求助"],
  },
);
pair(
  2,
  1,
  {
    key: "ask",
    label: "询问维修通道限制",
    attr: "presence",
    common: [fact("passage")],
  },
  {
    key: "map",
    label: "对照疏散图确认通道",
    attr: "mind",
    common: [fact("passage")],
    keywords: ["疏散图", "通道"],
  },
);
add(2, 2, {
  key: "persuade",
  label: "说明危险，争取老许配合",
  attr: "presence",
  good: [f("support"), f("access")],
  partial: [f("access"), res("supplies", -1)],
  bad: [f("forced"), res("supplies", -1)],
  keywords: ["说服", "解释危险", "请求配合"],
  result: [
    "老许答应安排通道，并留下码头路线的提醒。你取得的是有限合作，不是所有设施的永久免费使用权。",
    "老许允许一次通行，额外安排消耗了物资；他没有承诺后续帮助。",
    "老许拒绝了请求。你只能准备从维修侧口自行通过，未获得钥匙与信任；后续要独自承担障碍。",
  ],
});
add(2, 2, {
  key: "trade",
  label: "用1物资交换通行安排",
  cost: { supplies: 1 },
  common: [f("access")],
  risk: "消耗1物资；取得通行安排，但不获得额外人物支持。",
});
add(2, 2, {
  key: "force",
  label: "强行打开维修侧口",
  attr: "body",
  common: [f("forced")],
  good: [f("access")],
  partial: [res("hp", -1)],
  bad: [res("hp", -2)],
  risk: "失去物业合作；可能受伤1—2点。仍可经侧口推进。",
  keywords: ["强开", "踹门"],
});
pair(
  2,
  3,
  { key: "clear", label: "挪开通道回收架", attr: "body", bad: [res("hp", -1)] },
  { key: "avoid", label: "标出积水后从边缘通行", attr: "mind" },
);
pair(
  2,
  4,
  { key: "leave", label: "核对携带物并进入仓库" },
  {
    key: "close",
    label: "关回维修门再进入仓库",
    attr: "agility",
    good: [res("supplies", 1)],
  },
);
pair(
  3,
  1,
  {
    key: "inventory",
    label: "和阿岑盘点可用物件",
    attr: "presence",
    common: [fact("tools")],
  },
  {
    key: "labels",
    label: "阅读箱体和车辆检修标签",
    attr: "mind",
    common: [fact("tools")],
  },
);
add(3, 2, {
  key: "box",
  label: "选择容器方案，领取运输箱",
  common: [f("plan_box"), item("box"), fact("box_owned")],
  risk: "只是取得箱体；后续仍需检查、引导与封口。",
  keywords: ["箱子", "容器", "运输箱"],
});
add(3, 2, {
  key: "car",
  label: "选择车辆方案，登记领取车钥匙",
  common: [f("plan_car"), item("key")],
  risk: "只是取得钥匙；后续必须维护、清通路并实际驶离。",
  keywords: ["车辆", "开车", "钥匙"],
});
add(3, 2, {
  key: "run",
  label: "选择机动撤离，减轻携带负担",
  common: [f("plan_run"), res("supplies", 1)],
  risk: "无需专属道具，末阶段高风险；补充1物资。",
  keywords: ["机动", "步行", "奔逃"],
});
pair(
  3,
  3,
  {
    key: "test",
    label: "按检修表测试所选准备",
    attr: "mind",
    good: [f("maintained")],
    partial: [res("supplies", -1)],
    bad: [res("supplies", -1)],
  },
  {
    key: "repair",
    label: "消耗1物资完成保守维护",
    cost: { supplies: 1 },
    common: [f("maintained")],
    risk: "1物资；无需检定，确认已维护。",
  },
);
pair(
  3,
  4,
  { key: "secure", label: "固定携带物，移向记录区" },
  {
    key: "pack",
    label: "用绳带调整携带重心再移动",
    attr: "agility",
    good: [res("supplies", 1)],
  },
);
pair(
  4,
  1,
  {
    key: "records",
    label: "请阿岑定位运输记录",
    attr: "presence",
    common: [fact("records_visible")],
  },
  {
    key: "index",
    label: "按批次索引翻查登记",
    attr: "mind",
    common: [fact("records_visible")],
    keywords: ["运输记录", "档案", "索引"],
  },
);
pair(
  4,
  2,
  {
    key: "compare",
    label: "比对奖金编号与风险记录",
    attr: "mind",
    common: [fact("risk_link")],
  },
  {
    key: "explain",
    label: "向阿岑复述编号，请她逐项核对",
    attr: "presence",
    common: [fact("risk_link")],
  },
);
pair(
  4,
  3,
  {
    key: "cooperate",
    label: "告知查实的风险，争取有限协助",
    attr: "presence",
    good: [f("mechanic_support"), res("supplies", 1)],
  },
  {
    key: "independent",
    label: "保持独立，整理可携带耗材",
    common: [res("supplies", 1)],
  },
);
pair(
  4,
  4,
  { key: "dock", label: "整理已知材料，前往码头" },
  {
    key: "review",
    label: "复核撤离位置再前往码头",
    attr: "mind",
    good: [res("supplies", 1)],
  },
);
pair(
  5,
  1,
  {
    key: "position",
    label: "观察地面，选定执行位置",
    attr: "mind",
    common: [fact("dock_layout")],
  },
  {
    key: "footing",
    label: "小范围试走，确认落脚点",
    attr: "agility",
    common: [fact("dock_layout")],
    bad: [res("hp", -1)],
  },
);
add(5, 2, {
  key: "release",
  label: "布置按条款主动解除的计划",
  condition: all(flag("clause"), flag("signature")),
  common: [f("final_release"), fact("release_plan")],
  risk: "最终需明确放弃奖金；此步仅布置，不默认代你弃奖。",
});
add(5, 2, {
  key: "container",
  label: "把运输箱部署到执行位置",
  condition: has("box"),
  common: [f("final_box"), fact("deployed")],
  risk: "需要运输箱；只是部署，尚未封存。",
});
add(5, 2, {
  key: "vehicle",
  label: "用实际钥匙将车辆就位",
  condition: has("key"),
  common: [f("final_car"), fact("deployed")],
  risk: "需要钥匙；后续还要清路与离开。",
});
add(5, 2, {
  key: "flight",
  label: "布置不依赖设备的奔逃路线",
  common: [f("final_run"), fact("deployed")],
  risk: "后续奔逃可能受伤；不会自动获得车辆。",
});
pair(
  5,
  3,
  {
    key: "obstacle",
    label: "按已有帮助处理码头障碍",
    attr: "body",
    good: [],
    partial: [res("supplies", -1)],
    bad: [res("hp", -1)],
  },
  { key: "detour", label: "检查说明并选择绕行线路", attr: "mind" },
);
pair(
  5,
  4,
  { key: "confirm", label: "确认计划顺序，进入最后执行" },
  {
    key: "mark",
    label: "标记退路后进入最后执行",
    attr: "mind",
    good: [res("supplies", 1)],
  },
);
pair(
  6,
  1,
  {
    key: "guide",
    label: "保持距离，引导危险进入范围",
    attr: "agility",
    common: [f("guided")],
    good: [],
    partial: [res("supplies", -1)],
    bad: [res("hp", -2)],
    risk: "失败受伤2；不接触蜗牛，仍进入下一步。",
  },
  {
    key: "measure",
    label: "利用位置参照，分段引导危险",
    attr: "mind",
    common: [f("guided")],
    good: [],
    partial: [res("supplies", -1)],
    bad: [res("hp", -2)],
  },
);
add(6, 2, {
  key: "waive",
  label: "核对本人材料，明确放弃全部奖金",
  condition: flag("final_release"),
  common: [f("waived"), f("started"), fact("waived")],
  risk: "不可逆：放弃全部奖金兑现权，必须已查证两项材料。",
});
add(6, 2, {
  key: "waive_verify",
  label: "逐条复核后签下弃奖确认",
  attr: "mind",
  condition: flag("final_release"),
  common: [f("waived"), f("started"), fact("waived")],
  risk: "无论检定结果都明确弃奖；失败额外消耗1物资。",
});
add(6, 2, {
  key: "start",
  label: "按部署方案启动第一步",
  attr: "body",
  condition: { kind: "not", condition: flag("final_release") },
  common: [f("started")],
  good: [],
  partial: [res("supplies", -1)],
  bad: [res("hp", -1)],
});
add(6, 2, {
  key: "start_careful",
  label: "消耗1物资，保守启动已部署方案",
  condition: { kind: "not", condition: flag("final_release") },
  cost: { supplies: 1 },
  common: [f("started")],
  risk: "消耗1物资；不会补发缺失设备。",
});
pair(
  6,
  3,
  {
    key: "stabilize",
    label: "检查偏差，确认方案稳定",
    attr: "mind",
    dc: 11,
    good: [f("stable")],
    partial: [res("supplies", -1)],
    bad: [res("hp", -1)],
    risk: "未成功则无法确认封存稳定；仍可最后撤离。",
  },
  {
    key: "brace",
    label: "用1物资保守处理偏差",
    cost: { supplies: 1 },
    common: [f("stable")],
    risk: "消耗1物资；确认所选方案稳定。",
  },
);
add(6, 4, {
  key: "release",
  label: "执行终止条款，确认契约解除",
  condition: all(
    flag("final_release"),
    flag("clause"),
    flag("signature"),
    flag("waived"),
    flag("guided"),
    flag("started"),
  ),
  common: [f("released")],
  risk: "不可逆；奖金已放弃，满足证据与程序才会解除。",
});
add(6, 4, {
  key: "release_check",
  label: "逐项确认弃奖回执后结束契约",
  condition: all(
    flag("final_release"),
    flag("clause"),
    flag("signature"),
    flag("waived"),
    flag("guided"),
    flag("started"),
  ),
  common: [f("released")],
  risk: "核实同一终止程序；不会恢复奖金。",
});
add(6, 4, {
  key: "seal",
  label: "压紧锁扣，完成本章暂时封存",
  condition: all(
    flag("final_box"),
    flag("stable"),
    flag("guided"),
    flag("started"),
    has("box"),
  ),
  common: [f("contained")],
  risk: "仅暂时封存，不代表杀死蜗牛或永久安全。",
});
add(6, 4, {
  key: "seal_check",
  label: "复查箱沿后锁紧容器",
  condition: all(
    flag("final_box"),
    flag("stable"),
    flag("guided"),
    flag("started"),
    has("box"),
  ),
  common: [f("contained")],
  risk: "仅完成当前容器的暂时封存。",
});
add(6, 4, {
  key: "drive",
  label: "清出最后通路，实际驶离码头",
  condition: all(
    flag("final_car"),
    flag("guided"),
    flag("started"),
    has("key"),
  ),
  common: [f("escaped")],
  risk: "本章暂时逃离；契约仍未解除。",
});
add(6, 4, {
  key: "escape",
  label: "放弃未完成设备，沿退路奋力离开",
  attr: "agility",
  dc: 11,
  common: [f("escaped")],
  good: [],
  partial: [res("hp", -1)],
  bad: [res("hp", -3)],
  risk: "失败受伤3，生命归零优先判为被追上；生还也只是暂时逃离。",
});
add(6, 4, {
  key: "escape_careful",
  label: "以2物资争取距离，沿退路离开",
  cost: { supplies: 2 },
  common: [f("escaped")],
  risk: "消耗2物资，仍然只是本章逃离。",
});
const optText = {
  clause:
    "柜台旁的合同附页没有被锁起来，但要在混乱中读懂它仍然需要一次实际调查。老许只确认这张纸属于同一批通知，不替你解释所有法律意义。你找到“主动终止”的位置，接着读它附带的要求。最容易犯的错误是看到前四个字就停止阅读；你需要把限定条件一起记下，并保留能与本人对应的后续查证方向。蜗牛不会因为你开始研究合同就停在原地，这次调查占用当前窗口，意味着少一次处理别的事情的机会。",
  signature:
    "阿岑把能查的签署记录放在灯下，提醒你必须和自己的通知对应，不能借别人的编号解释自己的契约。纸上的名字不是魔法咒语，批次与签署关系才是要验证的内容。你仔细检查，愿意为必要的补查付出成本，也接受材料可能不足的事实。这里获得的证据只能来自此次实际操作，不能因为你在输入框里写了“我有证据”就进入背包。这份选择使你少了一次仓库准备，却可能让最后的决定多出一种真正合法的方向。",
  prepare:
    "你没有站着等待好运，而是把当前能看到的空间重新整理了一遍：退路、落脚点、下一次操作时要先放下什么。准备不是重复说“我很谨慎”，而是消耗一次行动做出具体安排。已经做好的这层准备只能帮助下一次需要检定的尝试，成功或失败都会被用掉；没有检定的动作则不消耗它。它也无法跟着你跨越不同场景无限叠加。你把呼吸放慢一点，确认没有把危险对象当成可以伸手整理的物件。",
};
add(
  2,
  0,
  {
    key: "clause",
    label: "调查合同附页中的主动终止条款",
    attr: "mind",
    good: [f("clause"), fact("clause")],
    partial: [fact("clause_hint"), res("supplies", -1)],
    bad: [fact("clause_hint")],
    keywords: ["附页", "终止条款", "查合同"],
  },
  optText.clause,
);
add(
  2,
  0,
  {
    key: "clause_copy",
    label: "花1物资换取逐项核对附页",
    condition: flag("clause", false),
    cost: { supplies: 1 },
    common: [f("clause"), fact("clause")],
    risk: "消耗1物资与1行动，取得经核对的终止条款。",
  },
  optText.clause,
);
add(
  4,
  0,
  {
    key: "signature",
    label: "核验与本人对应的签署记录",
    attr: "mind",
    condition: flag("signature", false),
    good: [f("signature"), fact("signature")],
    partial: [fact("signature_hint"), res("supplies", -1)],
    bad: [fact("signature_hint")],
    keywords: ["签署", "本人记录", "证明身份"],
  },
  optText.signature,
);
add(
  4,
  0,
  {
    key: "signature_copy",
    label: "用1物资完成签署材料替代核验",
    condition: flag("signature", false),
    cost: { supplies: 1 },
    common: [f("signature"), fact("signature")],
    risk: "消耗1物资与1行动，补足本人签署证据。",
  },
  optText.signature,
);
for (let s = 1; s <= 6; s++)
  add(
    s,
    0,
    {
      key: "prepare",
      label: "整理当前空间，为下次检定做准备",
      common: [{ kind: "set_prepared", value: true }],
      risk: "1行动，一次性+1；不能叠加，转场清除。",
      keywords: ["准备", "谨慎安排", "整理空间"],
    },
    optText.prepare,
  );
add(
  3,
  0,
  {
    key: "backup",
    label: "登记领取备用运输箱",
    condition: { kind: "not", condition: has("box") },
    cost: { supplies: 1 },
    common: [item("box"), fact("box_owned")],
    risk: "消耗1物资与1行动，保留容器后手。",
  },
  "阿岑确认你愿意为第二套准备腾出时间，才把备用运输箱推到可领取的位置。它不是因为你想到“两手准备”就自动加入背包的奖励。你检查编号，说明后续要如何携带，把当前方案与备用方案分开。第二条路增加了选择，也增加了此刻的安排成本；没有一条路因此在仓库里直接通关。",
);
for (let s = 1; s <= 6; s++)
  add(
    s,
    0,
    {
      key: "touch",
      label: "无视警告，主动用手接触蜗牛",
      common: [res("hp", -10)],
      risk: "致命且不可逆：立即失去全部生命，结束本局。",
      keywords: ["摸蜗牛", "触碰蜗牛", "抓蜗牛"],
    },
    "你选择越过已经公开的接触警告。蜗牛没有为这个决定增加戏剧性的速度，也没有等待另一轮争辩。触碰之前，仍有取消预览的机会；一旦确认，规则就按明确的危险执行。这个动作不会因为一句勇敢的描述变成无敌，也不会变成安全的准备。",
  );
const titles = [
  "奖金还没到账，蜗牛先到了",
  "物业不处理超自然投诉",
  "仓库里没有一键通关道具",
  "合同的重点不是大字",
  "码头的风不负责救你",
  "你要奖金，还是要明天",
];
const intros = [
  "你收到一笔巨额奖金的通知，钱还没有到，附带的契约对象却已经到达楼下。它不死，接触致命，普通盐不能让约定失效。玻璃门外那只小小的蜗牛正在缓慢靠近。你有五次行动处理大堂局面：核实异常、观察轨迹、争取距离，再走到物业窗口。读线索和取消预览不耗行动；世界不会因为你停下来阅读而偷偷推进。",
  "第一道距离已经争取过，接下来要让一扇真实的门为你打开。物业老许能说明维修通道，也有自己的限制。这里有六次行动，四个主要节点之外，还可以调查附页或做准备。说服、交换与强开都可能推进，却会留下不同代价。蜗牛绕过了前面的障碍，剩下的机会来自新的路线，不是它决定休息。",
  "你来到仓库操作区。维修员阿岑没有一键通关道具，只有容器、车辆与机动撤离的实际准备。盘点、选方向、检查维护、固定携带物，是此处需要完成的四件事。六次行动允许有限的后手与准备。拿到箱子或钥匙只是开始，后续还要在码头布置并执行。没有关键物品也始终保留高风险逃生方向。",
  "同一座仓库的记录区亮着一盏灯。运输登记与奖金通知之间有可以核对的联系，未必每一页都能在有限窗口内查完。接触记录、比对来历、决定怎样对待帮助你的人、整理材料离开，是这里的四个主要变化。你还可以查证本人签署关系。未知线索需要真正调查；输入里声称知道答案不会自动成为证据。",
  "你到达码头。这里有风、有窄道，也有足够真实的障碍。五次行动要用来选位置、部署方案、承担前面选择留下的影响、确认最终顺序。如果两项解除证据都已查证，会出现主动解除计划，但不会默认替你放弃奖金。缺设备时仍可准备奔逃。先前人物的有限协助，会在处理障碍时发挥实际作用。",
  "只剩四次执行机会。引导、启动、稳定与最终决定各有自己的作用，不能靠一句“全部做好”跳过。生命耗尽会优先结束故事；最后窗口耗尽同样没有下一轮。预览会说明不可逆代价，你仍可取消并选择另一个合法办法。暂时封存和暂时逃离都不会被写成永久安全，真正解除则要求实际证据与亲自弃奖。",
];
const facts: Scenario["facts"] = {
  danger: "契约蜗牛不死，接触致命；普通盐不能直接解除契约。",
  notice: "通知显示契约已生效，奖金尚未兑现。",
  tracking: "蜗牛缓慢调整方向，持续追踪你；距离只能争取机会。",
  barrier_visible: "你实际建立过临时屏障，它不能永久阻止追逐。",
  passage: "维修通道通往仓库，存在回收架与积水限制。",
  tools: "仓库可筹备运输箱、搬运车或机动撤离方案。",
  box_owned: "你已实际领取运输箱，尚未完成封存。",
  records_visible: "仓库记录区的运输登记已经公开。",
  risk_link: "奖金与风险属于同一份安排，宣传不等于免责。",
  clause_hint: "附页可能存在主动终止条件，但本次没有完整核实。",
  clause: "已核实：契约允许主动终止，需要本人签署证据并明确放弃奖金。",
  signature_hint: "发现相关签署记录，但尚未核实与本人对应。",
  signature: "已核实：签署批次与本人通知对应，可用于主动终止程序。",
  dock_layout: "码头有容器位置、车辆窄道与步行退路。",
  deployed: "当前方案已在实际执行位置部署。",
  release_plan: "已选择查证后的解除计划，仍需亲自确认弃奖与完成程序。",
  waived: "你已明确放弃全部奖金兑现权。",
};
export const scenario: Scenario = {
  version: "0.5.0",
  rulesVersion: "0.1.0",
  assetVersion: "art-demo-0.5.0",
  actions,
  facts,
  items: { box: "运输箱", key: "搬运车钥匙" },
  flags: [
    "barrier",
    "support",
    "access",
    "forced",
    "plan_box",
    "plan_car",
    "plan_run",
    "maintained",
    "mechanic_support",
    "clause",
    "signature",
    "final_release",
    "final_box",
    "final_car",
    "final_run",
    "guided",
    "waived",
    "started",
    "stable",
    "released",
    "contained",
    "escaped",
  ],
  counters: { step: { min: 0, max: 4 } },
  cast: [
    {
      roleId: "keeper",
      actorId: "actor_a",
      lookId: "actor_a.keeper_uniform.look",
      accessoryId: "actor_a.accessory.badge",
    },
    {
      roleId: "mechanic",
      actorId: "actor_b",
      lookId: "actor_b.mechanic_overall.look",
      accessoryId: null,
    },
  ],
  stages: titles.map((title, i) => ({
    id: `s${i + 1}`,
    title,
    scene: [
      "apartment_lobby",
      "apartment_lobby",
      "warehouse",
      "warehouse",
      "dock",
      "dock",
    ][i],
    roles: i < 2 ? ["keeper"] : i < 4 ? ["mechanic"] : [],
    budget: [5, 6, 6, 6, 5, 4][i],
    intro: intros[i],
    timeoutText: [
      "临时屏障失去作用，你损失1物资，被迫移向物业窗口。",
      "正常通行机会用尽，你从备用侧口撤离，受伤1；未得到的信任与线索不会补发。",
      "仓库筹备窗口耗尽，损失1物资；未取得的设备不会自动完成，你转向记录区。",
      "必须带着不完整的信息离开记录区，损失1物资。",
      "布置时间用尽，你受伤1，使用仓促的步行退路进入最后执行。",
      "最后执行机会耗尽，危险追上了你。",
    ][i],
    timeout:
      i === 5
        ? [res("hp", -10)]
        : i === 1
          ? [res("hp", -1), f("forced")]
          : i === 4
            ? [res("hp", -1), f("final_run")]
            : [res("supplies", -1)],
  })),
  endings: [
    {
      id: "caught",
      priority: 100,
      condition: { kind: "compare", field: "hp", op: "lte", value: 0 },
      title: "被追上",
      text: endingProse.caught,
    },
    {
      id: "contract_released",
      priority: 90,
      condition: all(
        flag("released"),
        flag("clause"),
        flag("signature"),
        flag("waived"),
      ),
      title: "契约解除",
      text: endingProse.contract_released,
    },
    {
      id: "temporary_containment",
      priority: 80,
      condition: all(flag("contained"), flag("stable"), has("box")),
      title: "暂时封存",
      text: endingProse.temporary_containment,
    },
    {
      id: "narrow_escape",
      priority: 70,
      condition: flag("escaped"),
      title: "暂时逃离",
      text: endingProse.narrow_escape,
    },
  ],
};
