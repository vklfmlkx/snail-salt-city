/** Match the action kind, not a story author's choice ID (which may itself be 'key'). */
export const isFixedScriptAction = (id: string) =>
  /^book\.s\d+\.key\.[^.]+$/.test(id);
