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
import { useState } from "react";
import { Response } from "@/components/ui/response";
import { Switch } from "@/components/ui/switch";
import type { HermesAutomation } from "@/lib/hermes-automations";
import { formatHermesDateTime } from "@/lib/hermes-date-format";

export function AutomationCard({ job }: { job: HermesAutomation }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(job.enabled);
  const [busyToggle, setBusyToggle] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setEnabledRemote(next: boolean) {
    if (busyToggle) return;
    setBusyToggle(true);
    setError(null);
    setEnabled(next);
    try {
      const res = await fetch(`/api/hermes/jobs/${encodeURIComponent(job.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        enabled?: boolean;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (typeof data.enabled === "boolean") setEnabled(data.enabled);
      router.refresh();
    } catch (e) {
      setEnabled(!next);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyToggle(false);
    }
  }

  async function deleteAutomation() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/hermes/jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setConfirmDelete(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article
      className="neu-raised group rounded-lg bg-[var(--sidebar-depth-canvas)] p-3 transition-colors"
      data-hermes-tip="A scheduled Hermes task. Edit it to change timing, instructions, delivery, or output."
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-sidebar-foreground">
            {job.name}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {job.prompt || "No task prompt saved."}
          </p>
        </div>
        <label
          className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-[11px] font-medium text-muted-foreground"
          data-hermes-tip={
            enabled
              ? "Turn this off to pause the automation without deleting it."
              : "Turn this on to let Hermes run this automation on schedule."
          }
        >
          <span className={enabled ? "text-sidebar-foreground" : ""}>
            {enabled ? "On" : "Paused"}
          </span>
          <Switch
            size="default"
            checked={enabled}
            disabled={busyToggle}
            onCheckedChange={(next) => void setEnabledRemote(Boolean(next))}
            aria-label={`${enabled ? "Pause" : "Resume"} ${job.name}`}
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <div
          className="neu-recessed rounded-md px-2 py-1.5"
          data-hermes-tip="When Hermes should run this automation."
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/75">
            Runs
          </div>
          <div className="mt-0.5 truncate text-foreground/90">
            {job.scheduleDisplay}
          </div>
        </div>
        <div
          className="neu-recessed rounded-md px-2 py-1.5"
          data-hermes-tip="The next scheduled run time."
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/75">
            Next
          </div>
          <div className="mt-0.5 truncate text-foreground/90">
            {formatHermesDateTime(job.nextRunAt)}
          </div>
        </div>
        <div
          className="neu-recessed rounded-md px-2 py-1.5"
          data-hermes-tip="The last time this automation ran."
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/75">
            Last
          </div>
          <div className="mt-0.5 truncate text-foreground/90">
            {formatHermesDateTime(job.lastRunAt)}
          </div>
        </div>
        <div
          className="neu-recessed rounded-md px-2 py-1.5"
          data-hermes-tip="The last saved result from the scheduler."
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/75">
            Status
          </div>
          <div className="mt-0.5 truncate text-foreground/90">
            {job.lastStatus || job.state || "Ready"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="neu-raised col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-primary"
          data-hermes-tip="Show the full automation definition, including prompt, schedule, delivery, and script."
        >
          <FileTextIcon className="size-3.5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
          {expanded ? "Hide details" : "View details"}
          <ChevronDownIcon
            className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        <Link
          href={`/chat/automations/new?edit=${encodeURIComponent(job.id)}`}
          className="neu-raised inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-primary"
          data-hermes-tip="Edit schedule, task instructions, delivery, or expected output."
        >
          <Edit3Icon className="size-3.5 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
          Edit
        </Link>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="neu-raised inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-foreground"
          data-hermes-tip="Delete this automation from the scheduler."
        >
          <Trash2Icon className="size-3.5 text-muted-foreground transition-colors group-hover:text-sidebar-foreground" />
          Delete
        </button>
      </div>

      {expanded ? (
        <div className="neu-recessed mt-3 max-h-[30rem] overflow-y-auto rounded-lg p-3">
          <Response className="prose prose-sm max-w-none text-xs leading-relaxed text-foreground dark:prose-invert">
            {job.detailMarkdown}
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
          aria-labelledby={`delete-automation-${job.id}`}
        >
          <div className="main-chat-depth neu-raised w-full max-w-sm rounded-lg bg-[var(--sidebar-depth-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id={`delete-automation-${job.id}`} className="text-sm font-semibold">
                  Delete automation?
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  This removes <span className="font-medium text-foreground">{job.name}</span> from the Hermes scheduler.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="neu-raised rounded-lg p-1.5 text-muted-foreground hover:text-sidebar-foreground"
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
                onClick={() => void deleteAutomation()}
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
