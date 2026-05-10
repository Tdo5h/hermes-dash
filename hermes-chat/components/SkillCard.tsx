"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  Edit3Icon,
  FileTextIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Response } from "@/components/ui/response";
import { Switch } from "@/components/ui/switch";
import { formatHermesDate } from "@/lib/hermes-date-format";
import type { HermesUserSkill } from "@/lib/hermes-user-skills";

export function SkillCard({ skill }: { skill: HermesUserSkill }) {
  const router = useRouter();
  const isUserSkill = skill.owner === "user";
  const [pinned, setPinned] = useState(skill.pinned);
  const [busyPin, setBusyPin] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markdown = useMemo(() => {
    const raw = skill.content.trim();
    return raw || "_This skill file is empty._";
  }, [skill.content]);

  async function setPinnedRemote(next: boolean) {
    if (!isUserSkill || !skill.pinnable || busyPin) return;
    setBusyPin(true);
    setError(null);
    setPinned(next);
    try {
      const res = await fetch(`/api/hermes/skills/${encodeURIComponent(skill.id)}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        pinned?: boolean;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPinned(Boolean(data.pinned));
    } catch (e) {
      setPinned(!next);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPin(false);
    }
  }

  async function deleteSkill() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/hermes/skills/${encodeURIComponent(skill.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="neu-raised group rounded-lg bg-[var(--sidebar-depth-canvas)] p-3 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-sidebar-foreground">
            {skill.name}
          </h2>
          <p className="mt-1 line-clamp-3 text-xs leading-snug text-muted-foreground">
            {skill.description}
          </p>
        </div>
        {isUserSkill ? (
          <label
            className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-[11px] font-medium text-muted-foreground"
            data-hermes-tip={
              pinned
                ? "Pinned skills stay under your control."
                : "Pin what matters. Unpinned skills can be tidied, merged, or archived later when Hermes keeps the library clean."
            }
          >
            <span className={pinned ? "text-sidebar-foreground" : ""}>
              {pinned ? "Pinned" : "Unpinned"}
            </span>
            <Switch
              size="default"
              checked={pinned}
              disabled={!skill.pinnable || busyPin}
              onCheckedChange={(next) => void setPinnedRemote(Boolean(next))}
              aria-label={`${pinned ? "Unpin" : "Pin"} ${skill.name}`}
            />
          </label>
        ) : (
          <span
            className="shrink-0 rounded-md border border-sidebar-border/25 px-2 py-1 text-[11px] font-medium text-muted-foreground"
            data-hermes-tip="Updated from the main Hermes stack, then deployed to this tenant."
          >
            Stack managed
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        <span className="rounded-md border border-sidebar-border/25 px-2 py-1">
          {skill.source === "primary" ? "Main library" : "Legacy read-only"}
        </span>
        <span className="rounded-md border border-sidebar-border/25 px-2 py-1">
          {isUserSkill ? "User skill" : "HermesChat app skill"}
        </span>
        <span className="rounded-md border border-sidebar-border/25 px-2 py-1">
          {skill.state}
        </span>
        <span className="rounded-md border border-sidebar-border/25 px-2 py-1">
          Used {skill.useCount ?? 0}
        </span>
        <span className="rounded-md border border-sidebar-border/25 px-2 py-1">
          Last {formatHermesDate(skill.lastUsedAt)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="neu-raised inline-flex col-span-2 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-primary"
          data-hermes-tip="Read the full skill instructions in a cleaner view."
        >
          <FileTextIcon className="size-3.5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
          {expanded ? "Hide details" : "View details"}
          <ChevronDownIcon
            className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {isUserSkill ? (
          <>
            <Link
              href={`/chat/skills/new?edit=${encodeURIComponent(skill.id)}`}
              className="neu-raised inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-primary"
              data-hermes-tip="Refine as you go. Use Edit when the instructions need sharper triggers, clearer limits, or a better way to repeat the result you want."
            >
              <Edit3Icon className="size-3.5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
              Edit
            </Link>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="neu-raised inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-foreground"
              data-hermes-tip="Remove this user skill from the active library."
            >
              <Trash2Icon className="size-3.5 text-muted-foreground transition-colors group-hover:text-sidebar-foreground" />
              Delete
            </button>
          </>
        ) : (
          <span
            className="neu-recessed col-span-2 inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground"
            data-hermes-tip="This skill is part of the HermesChat stack and is updated by stack deploys."
          >
            Stack managed
          </span>
        )}
      </div>

      {expanded ? (
        <div className="neu-recessed mt-3 max-h-[28rem] overflow-y-auto rounded-lg p-3">
          <Response className="prose prose-sm max-w-none text-xs leading-relaxed text-foreground dark:prose-invert">
            {markdown}
          </Response>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : null}

      {confirmDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`delete-skill-${skill.id}`}
        >
          <div className="main-chat-depth neu-raised w-full max-w-sm rounded-lg bg-[var(--sidebar-depth-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id={`delete-skill-${skill.id}`} className="text-sm font-semibold">
                  Delete skill?
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  This removes <span className="font-medium text-foreground">{skill.name}</span> from Hermes&apos; active skill library. A recoverable copy is kept in the server archive.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="neu-raised rounded-lg p-1.5 text-muted-foreground"
                aria-label="Close"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="neu-raised rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteSkill()}
                className="neu-raised rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground"
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
