import { z } from "zod";
import { faces, speakers } from "../../content/script-book";
import { viewpointContract } from "../../content/narration-viewpoint";
export const compactPrompt = `${viewpointContract}
你是中文文字冒险编剧，一次写完完整主线、全部分支结果和结局。全文输出一个JSON对象。不要分幕生成，不留待续，不把素材各抄一段拼接。
优先写好3或4幕，题材确实需要可5幕，每幕2或3个选项。结局4至6个，恰好一个true，至少一个good与一个bad。允许第一幕失败就进入坏结局。中间可合流，但合流开场必须适合所有来路。真结局只需一部分路线能达成。所有幕和结局都要至少有一条可达路线。
四属性body体魄/agility身手/mind头脑/presence气场，选项按实际行动选属性，可重复。不必覆盖四属性。难度tier只写low/medium/high，不给具体数值。各幕应有不同难度、不同强项的做法，不让每幕都能靠同一专长轻松通关。
格式用紧凑台词三元组[角色ID,表情ID,文字]。角色ID只能gm/player/student/sister/engineer/visitor；gm负责全部非直接对白，player是主角。每幕必须有至少3段真正的角色直接对话，包含player与其他角色；不能把整幕全写成gm转述。人物说出口的话应以该人物为speaker，环境与动作才归gm。表情只有neutral/smile/worried/surprised/angry/sad。每段最多180字，通常25—100字。无需每段都一样长。每幕正文8—24段，每幕总正文至少400字，重要段落写长一点来解释清楚事情，结局6—16段，每个行动结果1—4段。短段落要说完一件事，不用填充句子凑数量。
输出结构：
{
 "title":"标题", "description":"无剧透的一句话简介",
 "roleNames":{"player":"主角名字","student":"配角名字",...},
 "flags":{"clue":"线索的准确含义"},
 "stages":[{
   "title":"幕标题","location":"地点","anchor":"这一幕玩家要解决的具体问题","knownFacts":["所有进入本幕的路线共同知道的事实，至少2条"],"landing":"目前人物的位置和处境",
   "opening":[["gm","neutral","完整背景段落"],...],
   "choices":[{
     "id":"look","attribute":"mind","tier":"medium","label":"看一眼登记本","conditions":["需看清登记本上的改动"],"risk":"失败会惊动门口的人，可能提前结束",
     "success":{"to":"s2","grants":["clue"],"lines":[["gm","neutral","具体完成了什么以及如何前往下一幕"],...]},
     "partial":{"to":"s2","grants":[],"lines":[...]},
     "failure":{"to":"bad1","grants":[],"lines":[...]}
   },...],
   "activity":{"attribute":"body","game":"summit","title":"帮忙搬箱子","afterLine":8,"intro":[["gm","neutral","剧中人物准备做一个合理的小动作"],...],"success":[...],"failure":[...]}
 },...],
 "endings":[{"id":"bad1","category":"bad","title":"结局标题","dialogue":[["gm","sad","这一条路线的实际后果"],...]} ,...]
}
activity可省略，整书1—2处即可。intro放入opening对应位置；afterLine由代码最终校准。台词不要提小游戏名字。故事角色不是跑团桌边的演员。
每个choice都必须完整写出success、partial、failure三个结果对象，不能因为去向相同就省略partial。每个结果都要包含to、grants和lines。requires与otherwise写在对应结果对象里，绝对不要放在choice的顶层。
to指向s2/s3/s4/s5或已声明结局ID。幕只能前向跳转。grants只能用flags中声明的ID（最多4条flags）。仅通往结局时可额外写requires:["clue"],otherwise:"good1"，表示缺少线索就去备选结局。每个有条件的结局都必须有otherwise。不要给普通前进路线加requires。结局ID不能使用s加数字。好坏结局不是把同一段换一个标题：必须有不同的具体收场。不要所有失败都强行被救回主线。
减少合流矛盾：主线必需道具、人物出场、共用幕需要的基本信息，在共同开场中交代。flags宜表示是否完成过额外核实或帮忙，而不是角色是否活着、共用人物是否在场等会改变全书写法的状态。不要为了复刻素材引入大量新规则，抓住一个容易懂的矛盾讲完即可。
写作前自己理清各条路径：线索是何时获得的、没有线索也进入的幕该怎么说、哪条路线使哪些结局可达。正文不能无条件说已经拿到了某条路线才有的东西。各选项的失败不会改变后续仍需要的道具状态，除非进入单独结局。正文开头连续3—5段gm交代地点、身份、关系、事情起因、眼前目标。`;
const line = z.tuple([
  z.enum(speakers),
  z.enum(faces),
  z.string().min(1).max(180),
]);
const outcome = z
  .object({
    to: z.string().min(1).max(60),
    grants: z.array(z.string()).max(4).default([]),
    lines: z.array(line).min(1).max(6),
    requires: z.array(z.string()).max(4).optional(),
    otherwise: z.string().optional(),
  })
  .strict();
const compact = z
  .object({
    title: z.string(),
    description: z.string(),
    roleNames: z.partialRecord(z.enum(speakers), z.string()),
    flags: z.record(z.string(), z.string()),
    stages: z.array(
      z
        .object({
          title: z.string(),
          location: z.string(),
          anchor: z.string(),
          knownFacts: z.array(z.string()),
          landing: z.string(),
          opening: z.array(line),
          choices: z.array(
            z
              .object({
                id: z.string(),
                attribute: z.enum(["body", "agility", "mind", "presence"]),
                tier: z.enum(["low", "medium", "high"]),
                label: z.string(),
                conditions: z.array(z.string()),
                risk: z.string(),
                success: outcome,
                partial: outcome,
                failure: outcome,
              })
              .strict(),
          ),
          activity: z
            .object({
              attribute: z.enum(["body", "agility", "mind", "presence"]),
              game: z.enum(["summit", "flight", "roulette", "rally"]),
              title: z.string(),
              afterLine: z.number().int(),
              intro: z.array(line).min(2).max(6),
              success: z.array(line).min(2).max(6),
              failure: z.array(line).min(2).max(6),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    endings: z.array(
      z
        .object({
          id: z.string(),
          category: z.enum(["good", "bad", "true"]),
          title: z.string(),
          dialogue: z.array(line),
        })
        .strict(),
    ),
  })
  .strict();
export function expandCompact(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("flags" in raw)) return raw;
  const v = compact.parse(raw);
  const lines = (a: z.infer<typeof line>[]) =>
    a.map(([speaker, expression, text]) => ({ speaker, expression, text }));
  const route = (o: z.infer<typeof outcome>) => ({
    ...(/^s[2-5]$/.test(o.to)
      ? { stage: Number(o.to.slice(1)) }
      : { ending: o.to }),
    grants: o.grants,
    bridge: [],
    ...(o.requires ? { requires: o.requires, otherwise: o.otherwise } : {}),
  });
  return {
    title: v.title,
    description: v.description,
    roleNames: v.roleNames,
    graphFlags: Object.keys(v.flags),
    flagLabels: v.flags,
    initialFlags: [],
    stages: v.stages.map((s) => {
      const choices = s.choices.map(({ success, partial, failure, ...c }) => ({
        ...c,
        branches: {
          success: lines(success.lines),
          partial: lines(partial.lines),
          failure: lines(failure.lines),
        },
        routes: {
          success: route(success),
          partial: route(partial),
          failure: route(failure),
        },
      }));
      const activity = s.activity
        ? {
            ...s.activity,
            intro: lines(s.activity.intro),
            success: lines(s.activity.success),
            failure: lines(s.activity.failure),
          }
        : undefined;
      const opening = lines(s.opening);
      const roles = [
        ...new Set([
          "gm",
          "player",
          ...opening.map((l) => l.speaker),
          ...choices.flatMap((c) =>
            Object.values(c.branches)
              .flat()
              .map((l) => l.speaker),
          ),
          ...(activity
            ? [...activity.intro, ...activity.success, ...activity.failure].map(
                (l) => l.speaker,
              )
            : []),
        ]),
      ];
      return {
        title: s.title,
        location: s.location,
        anchor: s.anchor,
        knownFacts: s.knownFacts,
        landing: s.landing,
        opening,
        roles,
        sideLimit: 0,
        transition: [],
        choices,
        ...(activity ? { activity } : {}),
      };
    }),
    endings: v.endings.map((e) => ({ ...e, dialogue: lines(e.dialogue) })),
  };
}
