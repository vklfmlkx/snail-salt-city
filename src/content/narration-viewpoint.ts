/** Quoted character speech is not the narrator's viewpoint. */
export function unquotedNarration(text: string): string {
  const closing: Record<string, string> = {
    "“": "”",
    "「": "」",
    "『": "』",
    "‘": "’",
    '"': '"',
  };
  const stack: string[] = [];
  let result = "";
  for (const char of text) {
    if (stack.length && char === stack.at(-1)) stack.pop();
    else if (closing[char]) stack.push(closing[char]);
    else if (!stack.length) result += char;
  }
  // An unclosed quote cannot hide the rest of a malformed paragraph.
  return stack.length ? text : result;
}

export function viewpointIssues(book: unknown): string[] {
  const issues: string[] = [];
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.speaker === "gm" && typeof node.text === "string") {
      if (/(?<!自|忘|敌|物)我/.test(unquotedNarration(node.text)))
        issues.push(
          `${path}/text: gm_viewpoint，城主用“你”叙述主角；人物直接台词请交给对应speaker，转引原话要有成对引号，不能把人物的我机械改成你。`,
        );
      return;
    }
    for (const [key, child] of Object.entries(node))
      visit(child, `${path}/${key}`);
  }
  visit(book, "");
  return issues;
}

export const viewpointContract = `叙事视角全书固定为第二人称：gm始终用“你”指主角，包括开场、环境描写、动作、心理、行动结果、转场、小游戏反馈和结局。可以用“你叫张冬冬”介绍身份，之后不能切回“我走进屋里”或“张冬冬走进屋里，他想……”。配角仍按姓名或清楚的第三人称指代，不得把配角做的事改成你做的事。player以及其他角色直接说出口的话仍自然用我、你、他；不是把所有我替换成你。短信、信件和必要的原话引用使用成对引号，引用以外恢复第二人称。不要在同一本书里把同一个人交替叫哥哥和姐姐。
城主讲故事，不主持会议。用具体动作、物件、接话把事情讲清楚，少写抽象结论与安慰式说教。开场说清身份、地点、关系、眼前麻烦；中间交代人物进出、道具位置和时间变化。轻小说的轻松来自自然口语与人物反应，不是每段都讲笑话。不重复同一段背景，不用故意藏主语、谜语和碎句制造悬疑。每次定点修改后通读整本，检查称呼、指代、引用、来路和道具是否仍然一致。`;
