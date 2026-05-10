"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  patchChatSessionLabel,
  fetchSessionTitleSuggestions,
  messagesForTitleApi,
  deleteChatSession,
} from "@/lib/sessions";
import type { ChatMessage } from "@/lib/sessions";

export type RenameChatDialogProps = {
  open: boolean;
  sessionId: string;
  sessionKey: string;
  initialLabel: string;
  onCancel: () => void;
  onSaved: (label: string) => void;
  onSessionDeleted?: (sessionId: string) => void;
  onRequestSummarize?: (sessionId: string, sessionKey: string) => void;
};

export function RenameChatDialog({
  open,
  sessionId,
  sessionKey,
  initialLabel,
  onCancel,
  onSaved,
  onSessionDeleted,
  onRequestSummarize,
}: RenameChatDialogProps) {
  const [value, setValue] = useState(initialLabel);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function filterGarbageSuggestions(list: string[]): string[] {
    return list.filter((s) => {
      const t = s.trim();
      if (/\bmemory\b/i.test(t) && /\d{1,4}[,']?\d*\s*\/\s*\d{1,4}/.test(t)) {
        return false;
      }
      if (/replace\s+or\s+remove\s+an?\s+existing/i.test(t)) return false;
      if (/\bcontext\s*(window|limit|quota)\b/i.test(t)) return false;
      return true;
    });
  }

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
      setSaving(false);
      setSuggestError(null);
      setDeleteConfirm(false);
    }
  }, [open, initialLabel]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, initialLabel]);

  const loadSuggestions = useCallback(async () => {
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestions([]);
    try {
      const r = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}?k=${encodeURIComponent(sessionKey)}`,
        { cache: "no-store" }
      );
      if (!r.ok) {
        setSuggestError("Could not load messages for suggestions");
        return;
      }
      const d = (await r.json()) as { messages?: ChatMessage[] };
      const raw = Array.isArray(d.messages) ? d.messages : [];
      const payload = messagesForTitleApi(raw);
      if (payload.length === 0) {
        return;
      }
      const titles = filterGarbageSuggestions(
        await fetchSessionTitleSuggestions(payload, sessionKey)
      );
      setSuggestions(titles);
    } catch {
      setSuggestError("Could not load suggestions");
    } finally {
      setSuggestLoading(false);
    }
  }, [sessionId, sessionKey]);

  useEffect(() => {
    if (!open) return;
    void loadSuggestions();
  }, [open, loadSuggestions]);

  useEffect(() => {
    if (!deleteConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeleteConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteConfirm]);

  if (!open || !portalTarget) return null;

  async function handleSave() {
    const t = value.replace(/\s+/g, " ").trim();
    if (!t) {
      setError("Enter a name");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await patchChatSessionLabel(sessionId, sessionKey, t);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved(r.label);
    onCancel();
  }

  async function confirmDelete() {
    if (!onSessionDeleted) return;
    setDeleting(true);
    setError(null);
    const r = await deleteChatSession(sessionId, sessionKey);
    setDeleting(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSessionDeleted(sessionId);
    onCancel();
  }

  function handleSummarize() {
    if (!onRequestSummarize) return;
    onCancel();
    queueMicrotask(() => onRequestSummarize!(sessionId, sessionKey));
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-chat-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="relative max-h-[min(90dvh,32rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-sidebar-border/40 bg-[var(--sidebar-depth-canvas)] shadow-xl">
        {deleteConfirm ? (
          <div
            className="absolute inset-0 z-10 flex flex-col justify-center rounded-2xl border border-destructive/30 bg-[var(--sidebar-depth-canvas)] p-4 shadow-lg"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-chat-confirm-title"
            aria-describedby="delete-chat-confirm-desc"
          >
            <h3
              id="delete-chat-confirm-title"
              className="text-sm font-semibold text-foreground"
            >
              Delete this chat?
            </h3>
            <p
              id="delete-chat-confirm-desc"
              className="mt-2 text-xs leading-relaxed text-muted-foreground"
            >
              This chat and all of its messages will be removed from this device
              and account storage. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
              >
                {deleting ? "…" : "Delete"}
              </button>
            </div>
          </div>
        ) : null}
        <div className="border-b border-sidebar-border/30 px-4 py-3">
          <h2
            id="rename-chat-title"
            className="text-sm font-semibold text-foreground"
          >
            Rename chat
          </h2>
        </div>
        <div className="p-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
              if (e.key === "Escape") {
                if (deleteConfirm) setDeleteConfirm(false);
                else onCancel();
              }
            }}
            placeholder="Name this chat"
            className="neu-inset-input mb-2 w-full rounded-lg px-3 py-2 text-sm text-foreground"
            maxLength={120}
            aria-label="Chat name"
            autoFocus
          />
          {suggestLoading || suggestions.length > 0 || suggestError ? (
            <div className="mb-3">
              <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
                Suggestions
              </p>
              {suggestError ? (
                <p className="text-xs text-destructive/80">{suggestError}</p>
              ) : suggestLoading ? (
                <p className="text-xs text-muted-foreground">…</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {suggestions.map((s, i) => (
                    <button
                      key={`${i}-${s.slice(0, 48)}`}
                      type="button"
                      onClick={() => {
                        setValue(s);
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      className="line-clamp-2 rounded-lg border border-sidebar-border/30 bg-background/30 px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-background/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          {error ? (
            <p className="mb-2 text-xs text-destructive/90">{error}</p>
          ) : null}
          {onRequestSummarize ? (
            <div className="mb-3">
              <button
                type="button"
                onClick={handleSummarize}
                className="w-full rounded-lg border border-sidebar-border/30 py-2 text-xs text-foreground hover:bg-background/30"
              >
                Summarize chat
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {onSessionDeleted ? (
              <button
                type="button"
                onClick={() => setDeleteConfirm(true)}
                disabled={deleting}
                className="rounded-lg px-2 py-1.5 text-xs text-destructive/90 hover:underline disabled:opacity-40"
              >
                Delete chat
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="neu-raised rounded-lg px-3 py-1.5 text-xs font-medium text-sidebar-foreground disabled:opacity-40"
              >
                {saving ? "…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
