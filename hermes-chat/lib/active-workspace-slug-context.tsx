"use client";

import { createContext, useContext, type ReactNode } from "react";

const ActiveWorkspaceSlugContext = createContext<string | null>(null);

export function ActiveWorkspaceSlugProvider({
  value,
  children,
}: {
  value: string | null;
  children: ReactNode;
}) {
  return (
    <ActiveWorkspaceSlugContext.Provider value={value}>
      {children}
    </ActiveWorkspaceSlugContext.Provider>
  );
}

export function useActiveWorkspaceSlug(): string | null {
  return useContext(ActiveWorkspaceSlugContext);
}
