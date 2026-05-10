"use client";

import { useEffect, useState } from "react";
import { BellIcon } from "lucide-react";
import {
  ensurePushSubscription,
  pushClientSupported,
  pushPromptStorageKeys,
} from "@/lib/push-client";

const {
  dismissed: KEY_DISMISSED,
  hadSubscription: KEY_HAD_SUBSCRIPTION,
  reenableSnooze: SESSION_REENABLE_SNOOZE,
} = pushPromptStorageKeys();

type ShowMode = "none" | "first" | "re-enable" | "blocked";

export function NotificationPrompt() {
  const [mode, setMode] = useState<ShowMode>("none");
  const [agentName, setAgentName] = useState("Hermes");

  useEffect(() => {
    void fetch("/api/agent/name")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const raw = typeof data?.name === "string" ? data.name.trim() : "";
        if (raw) setAgentName(raw);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!pushClientSupported()) return;

    let cancelled = false;

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (cancelled) return;

        const hadSubscribed = localStorage.getItem(KEY_HAD_SUBSCRIPTION) === "1";
        const dismissedWithoutSub =
          localStorage.getItem(KEY_DISMISSED) === "1";
        const perm = Notification.permission;

        if (perm === "granted" && sub) {
          setMode("none");
          return;
        }

        if (hadSubscribed && perm === "denied") {
          setMode("blocked");
          return;
        }

        if (hadSubscribed && !sub) {
          if (sessionStorage.getItem(SESSION_REENABLE_SNOOZE) === "1") {
            setMode("none");
            return;
          }
          setMode("re-enable");
          return;
        }

        if (!hadSubscribed && dismissedWithoutSub) {
          setMode("none");
          return;
        }

        if (perm === "denied" && !hadSubscribed) {
          setMode("none");
          return;
        }

        if (!hadSubscribed && (perm === "default" || (perm === "granted" && !sub))) {
          setMode("first");
          return;
        }

        setMode("none");
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    try {
      await ensurePushSubscription();
      setMode("none");
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : "";
      const denied =
        Notification.permission === "denied" || name === "NotAllowedError";
      if (!denied) {
        console.error("Push subscription failed:", err);
      }
      if (denied) {
        localStorage.setItem(KEY_DISMISSED, "1");
        setMode("none");
      }
    }
  }

  function dismissWithoutEnabling() {
    localStorage.setItem(KEY_DISMISSED, "1");
    setMode("none");
  }

  function snoozeReEnable() {
    sessionStorage.setItem(SESSION_REENABLE_SNOOZE, "1");
    setMode("none");
  }

  if (mode === "none") return null;

  const isReEnable = mode === "re-enable";
  const isBlocked = mode === "blocked";

  return (
    <div
      className="main-chat-depth fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--sidebar-depth-canvas)]/95 px-6 text-center backdrop-blur-sm"
      style={{
        paddingTop: "max(2rem, env(safe-area-inset-top))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="mb-8 flex justify-center">
        <div className="neu-raised flex size-20 items-center justify-center rounded-full text-sidebar-primary">
          <BellIcon className="size-10" strokeWidth={1.5} />
        </div>
      </div>

      <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {isBlocked
          ? "Notifications are blocked"
          : isReEnable
            ? "Turn notifications back on"
            : "Stay in the loop"}
      </h2>

      <p className="mt-5 max-w-sm text-lg leading-relaxed text-muted-foreground sm:text-xl">
        {isBlocked
          ? `Your browser is blocking ${agentName} notifications. Enable them in browser or phone settings when you want background alerts again.`
          : isReEnable
          ? `Notifications were turned off. Enable them again so ${agentName} can tell you when replies, vault ingests, and background work are ready.`
          : `Let ${agentName} tap you when a reply is ready, a vault ingest finishes, or background work needs attention.`}
      </p>

      <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={isBlocked ? snoozeReEnable : subscribe}
          className="neu-raised-active w-full rounded-lg py-4 text-lg font-semibold text-sidebar-primary-foreground transition-colors"
        >
          {isBlocked ? "Okay" : "Enable notifications"}
        </button>

        {!isReEnable && !isBlocked && (
          <button
            type="button"
            onClick={dismissWithoutEnabling}
            className="w-full py-3 text-base text-muted-foreground transition-colors hover:text-foreground"
          >
            Not now
          </button>
        )}
      </div>

      {isReEnable && (
        <button
          type="button"
          onClick={snoozeReEnable}
          className="mt-6 text-sm text-muted-foreground/70 hover:text-muted-foreground"
        >
          Maybe later
        </button>
      )}
    </div>
  );
}
