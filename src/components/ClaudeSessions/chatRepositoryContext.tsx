import { createContext, useContext, type ReactNode } from "react";

const ChatRepositoryContext = createContext<string | null>(null);

export function ChatRepositoryProvider({
  repositoryPath,
  children,
}: {
  repositoryPath: string | null | undefined;
  children: ReactNode;
}) {
  const normalized = repositoryPath?.trim() || null;
  return <ChatRepositoryContext.Provider value={normalized}>{children}</ChatRepositoryContext.Provider>;
}

export function useChatRepositoryPath(): string | null {
  return useContext(ChatRepositoryContext);
}
