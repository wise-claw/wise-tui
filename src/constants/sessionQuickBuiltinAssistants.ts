/** 会话快捷条「更多」与助手 Hub 一致的内置助手目录。 */
export type SessionQuickBuiltinAssistantRow = {
  id: string;
  menuLabel: string;
};

export const SESSION_QUICK_BUILTIN_ASSISTANTS: ReadonlyArray<SessionQuickBuiltinAssistantRow> = [];

export type SessionQuickBuiltinAssistantId = SessionQuickBuiltinAssistantRow["id"];

export function isSessionQuickBuiltinAssistantId(
  id: string,
): id is SessionQuickBuiltinAssistantId {
  return SESSION_QUICK_BUILTIN_ASSISTANTS.some((row) => row.id === id);
}
