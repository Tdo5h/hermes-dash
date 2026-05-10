"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ChatIdentity = {
  agentName: string;
  soulHeadline: string | null;
  userDisplay: string | null;
  labelLine: string;
  hermesDataDir: string | null;
  userMdLoaded: boolean;
  soulMdLoaded: boolean;
};

const defaultIdentity: ChatIdentity = {
  agentName: "Hermes",
  soulHeadline: null,
  userDisplay: null,
  labelLine: "Hermes",
  hermesDataDir: null,
  userMdLoaded: false,
  soulMdLoaded: false,
};

const IdentityContext = createContext<ChatIdentity>(defaultIdentity);

export function useChatIdentity() {
  return useContext(IdentityContext);
}

export function ChatIdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<ChatIdentity>(defaultIdentity);

  useEffect(() => {
    let stale = false;
    void fetch("/api/identity")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Record<string, unknown> | null) => {
        if (stale || !d || typeof d.agentName !== "string") return;
        setIdentity({
          agentName: d.agentName,
          soulHeadline:
            typeof d.soulHeadline === "string" ? d.soulHeadline : null,
          userDisplay:
            typeof d.userDisplay === "string" ? d.userDisplay : null,
          labelLine:
            typeof d.labelLine === "string" ? d.labelLine : d.agentName,
          hermesDataDir:
            typeof d.hermesDataDir === "string" ? d.hermesDataDir : null,
          userMdLoaded: Boolean(d.userMdLoaded),
          soulMdLoaded: Boolean(d.soulMdLoaded),
        });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  return (
    <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>
  );
}
