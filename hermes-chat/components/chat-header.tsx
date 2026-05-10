"use client";

import { useState, type ReactNode } from "react";
import { MenuIcon, SettingsIcon } from "lucide-react";
import { useSidebar, useSettings } from "@/app/chat/layout";
import { RenameChatDialog } from "@/components/RenameChatDialog";
import { useLongPressOrClick } from "@/lib/use-long-press-or-click";
import {
  HERMESCHAT_SUMMARIZE_EVENT,
  HERMESCHAT_SUMMARIZE_PROMPT,
} from "@/lib/sessions";

interface ChatHeaderProps {
  title?: string;
  /** When set, replaces the default “Powered by Hermes” subline (e.g. workspace name). */
  subline?: string | null;
  /** Vault chat: vault name on top (large, accent), chat title below. */
  vaultHeader?: boolean;
  /** When both set, double-click the chat title to rename (PATCH session label). */
  renameSessionId?: string;
  renameSessionKey?: string;
  onChatTitleSaved?: (label: string) => void;
  /** After delete from rename dialog (only this session’s row is shown in the header). */
  onChatSessionDeleted?: (sessionId: string) => void;
}

function RenameableChatTitle({
  className,
  titleAttr,
  onOpenRename,
  children,
}: {
  className: string;
  titleAttr: string;
  onOpenRename: () => void;
  children: ReactNode;
}) {
  const press = useLongPressOrClick({
    onLongPress: onOpenRename,
  });
  return (
    <h1
      className={`${className} touch-manipulation`}
      data-hermes-tip={titleAttr}
      {...press}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenRename();
      }}
    >
      {children}
    </h1>
  );
}

export function ChatHeader({
  title,
  subline,
  vaultHeader = false,
  renameSessionId,
  renameSessionKey,
  onChatTitleSaved,
  onChatSessionDeleted,
}: ChatHeaderProps) {
  const { toggle } = useSidebar();
  const { openSettings } = useSettings();
  const [renameOpen, setRenameOpen] = useState(false);
  const canRename =
    Boolean(renameSessionId?.trim()) &&
    Boolean(renameSessionKey?.trim()) &&
    Boolean(onChatTitleSaved);

  const vaultBanner = subline?.trim();
  const defaultSub = "Powered by Hermes";
  const renameHint = "Double-click or long-press to rename this chat";

  if (vaultHeader) {
    return (
      <header className="main-chat-depth flex flex-shrink-0 items-center gap-3 border-b border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)] px-4 py-2">
        <button
          type="button"
          onClick={toggle}
          className="neu-raised rounded-lg p-2 text-muted-foreground transition-colors hover:text-sidebar-foreground md:hidden"
          aria-label="Open chat list"
          data-hermes-tip="Open the chat, vault, and create sidebar."
        >
          <MenuIcon className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-row flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="shrink-0 truncate text-base font-semibold tracking-tight text-sidebar-primary">
            {vaultBanner || "Vault"}
          </span>
          <span className="shrink-0 text-muted-foreground/50" aria-hidden>
            ·
          </span>
          {canRename ? (
            <RenameableChatTitle
              className="min-w-0 flex-1 truncate text-xs font-medium leading-tight text-muted-foreground cursor-text select-none"
              titleAttr={renameHint}
              onOpenRename={() => setRenameOpen(true)}
            >
              {title || "New chat"}
            </RenameableChatTitle>
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-xs font-medium leading-tight text-muted-foreground">
              {title || "New chat"}
            </h1>
          )}
        </div>
        <button
          type="button"
          onClick={openSettings}
          className="neu-raised rounded-lg p-2 text-muted-foreground transition-colors hover:text-sidebar-primary"
          aria-label="Open settings"
          data-hermes-tip="Open settings for theme, notifications, models, voice, and tips."
        >
          <SettingsIcon className="size-5" />
        </button>
        {canRename && renameSessionId && renameSessionKey && onChatTitleSaved ? (
          <RenameChatDialog
            open={renameOpen}
            sessionId={renameSessionId}
            sessionKey={renameSessionKey}
            initialLabel={title?.trim() || "Chat"}
            onCancel={() => setRenameOpen(false)}
            onSaved={(label) => {
              onChatTitleSaved(label);
              window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
            }}
            onSessionDeleted={
              onChatSessionDeleted
                ? (sid) => onChatSessionDeleted(sid)
                : undefined
            }
            onRequestSummarize={(sid, key) => {
              window.dispatchEvent(
                new CustomEvent(HERMESCHAT_SUMMARIZE_EVENT, {
                  detail: {
                    sessionId: sid,
                    sessionKey: key,
                    text: HERMESCHAT_SUMMARIZE_PROMPT,
                  },
                })
              );
            }}
          />
        ) : null}
      </header>
    );
  }

  return (
    <header className="main-chat-depth flex flex-shrink-0 items-center gap-3 border-b border-sidebar-border/25 bg-[var(--sidebar-depth-canvas)] px-4 py-2">
      <button
        type="button"
        onClick={toggle}
        className="neu-raised rounded-lg p-2 text-muted-foreground transition-colors hover:text-sidebar-foreground md:hidden"
        aria-label="Open chat list"
        data-hermes-tip="Open the chat, vault, and create sidebar."
      >
        <MenuIcon className="size-5" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {canRename ? (
          <RenameableChatTitle
            className="truncate text-sm font-medium tracking-tight text-foreground cursor-text select-none"
            titleAttr={renameHint}
            onOpenRename={() => setRenameOpen(true)}
          >
            {title || "New chat"}
          </RenameableChatTitle>
        ) : (
          <h1 className="truncate text-sm font-medium tracking-tight text-foreground">
            {title || "New chat"}
          </h1>
        )}
        <p className="truncate text-[10px] leading-tight text-muted-foreground">
          {vaultBanner ? vaultBanner : defaultSub}
        </p>
      </div>
      <button
        type="button"
        onClick={openSettings}
        className="neu-raised rounded-lg p-2 text-muted-foreground transition-colors hover:text-sidebar-primary"
        aria-label="Open settings"
        data-hermes-tip="Open settings for theme, notifications, models, voice, and tips."
      >
        <SettingsIcon className="size-5" />
      </button>
      {canRename && renameSessionId && renameSessionKey && onChatTitleSaved ? (
        <RenameChatDialog
          open={renameOpen}
          sessionId={renameSessionId}
          sessionKey={renameSessionKey}
          initialLabel={title?.trim() || "Chat"}
          onCancel={() => setRenameOpen(false)}
          onSaved={(label) => {
            onChatTitleSaved(label);
            window.dispatchEvent(new Event("hermes-chat-sessions-updated"));
          }}
          onSessionDeleted={
            onChatSessionDeleted
              ? (sid) => onChatSessionDeleted(sid)
              : undefined
          }
          onRequestSummarize={(sid, key) => {
            window.dispatchEvent(
              new CustomEvent(HERMESCHAT_SUMMARIZE_EVENT, {
                detail: {
                  sessionId: sid,
                  sessionKey: key,
                  text: HERMESCHAT_SUMMARIZE_PROMPT,
                },
              })
            );
          }}
        />
      ) : null}
    </header>
  );
}
