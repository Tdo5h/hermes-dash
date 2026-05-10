"use client";

import { useEffect, useRef, useState } from "react";
import { Orb } from "@/components/ui/orb";
import { IngestAgentFlow } from "@/components/IngestAgentFlow";
import {
  ingestDetailLine,
  ingestHeroHeadline,
  ingestProgressLine,
} from "@/lib/shared-ingest-hero-copy";
import { CHAT_AGENT_ORB_COLORS } from "@/lib/architect-orb-presets";
import { normalizeVaultAssetRole } from "@/lib/ingest-message";
import type {
  SharedIngestPhaseKey,
  SharedIngestReaderTask,
  SharedIngestReviewTask,
} from "@/lib/shared-ingest-job-store";
type PollJob = {
  jobId: string;
  projectSlug: string;
  fileName: string;
  relativePath: string;
  status: "running" | "done" | "error";
  phaseKey: SharedIngestPhaseKey;
  phaseLabel: string;
  errorMessage?: string;
  assetRole?: string | null;
  reingestVerify?: boolean;
  readerTasks?: SharedIngestReaderTask[];
  challengeTask?: SharedIngestReviewTask;
  mergeTask?: SharedIngestReviewTask;
};

type Props = {
  projectSlug: string;
  jobId: string;
  fileName: string;
  /** Called once when the job reaches `done` or `error` (passes this hero’s `jobId`). */
  onComplete: (jobId: string) => void;
  variant?: "full" | "inline";
};

export function PrivateHermesReingestHero({
  projectSlug,
  jobId,
  fileName,
  onComplete,
  variant = "full",
}: Props) {
  const [job, setJob] = useState<PollJob | null | undefined>(undefined);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const finishedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let finishTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const r = await fetch(
          `/api/projects/${encodeURIComponent(projectSlug)}/private-reingest-status?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        const d = (await r.json()) as { job?: PollJob | null };
        if (cancelled) return;
        setJob(d.job ?? null);
        const st = d.job?.status;
        if (
          (st === "done" || st === "error") &&
          !finishedRef.current
        ) {
          finishedRef.current = true;
          finishTimer = setTimeout(
            () => {
              if (!cancelled) onCompleteRef.current(jobId);
            },
            st === "error" ? 18000 : 7000
          );
        }
      } catch {
        if (!cancelled) setJob((current) => (current === undefined ? null : current));
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      if (finishTimer) clearTimeout(finishTimer);
      clearInterval(id);
    };
  }, [projectSlug, jobId]);

  if (job === undefined) {
    const connect = `Connecting to Hermes for ${fileName}.`;
    if (variant === "inline") {
      return (
        <div className="flex max-h-[min(42dvh,18rem)] shrink-0 gap-3 overflow-y-auto border-t border-sidebar-border/30 bg-[var(--sidebar-depth-canvas)] px-3 py-2.5">
          <div className="relative size-14 shrink-0 self-start sm:size-16">
            <Orb
              agentState="thinking"
              colors={CHAT_AGENT_ORB_COLORS}
              className="size-full"
            />
          </div>
          <div className="min-w-0 flex-1 py-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Private ingest
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{connect}</p>
            <p className="mt-1.5 text-xs font-medium text-muted-foreground">{fileName}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-[min(72dvh,32rem)] flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
        <div className="relative size-64">
          <Orb
            agentState="thinking"
            colors={CHAT_AGENT_ORB_COLORS}
            className="size-full"
          />
        </div>
        <div className="max-w-md text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Private ingest
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{connect}</p>
          <p className="mt-2 text-sm text-muted-foreground">{fileName}</p>
        </div>
      </div>
    );
  }

  if (job === null) {
    return null;
  }

  const err = job.status === "error";
  const role =
    job.assetRole != null && String(job.assetRole).trim()
      ? normalizeVaultAssetRole(job.assetRole)
      : undefined;
  const phaseLine = ingestProgressLine({
    status: job.status,
    phaseKey: job.phaseKey,
    role,
  });
  const hasSwarmTasks = Boolean(
    (job.readerTasks?.length ?? 0) > 0 || job.challengeTask || job.mergeTask
  );
  const currentDetail =
    job.status === "running" && !hasSwarmTasks
      ? ingestDetailLine(job.phaseLabel, phaseLine)
      : null;
  const body = err
    ? job.errorMessage?.trim() ||
      "Hermes could not finish this verify pass. Try again or check server logs."
    : job.status === "done"
      ? "Private ingest finished. You can ask about this file in chat or check Files."
      : "Hermes is reading this privately and wiring it into this vault only.";
  const headline = ingestHeroHeadline(fileName, role);

  if (variant === "inline") {
    return (
      <div className="flex max-h-[min(48dvh,21rem)] shrink-0 flex-col gap-3 overflow-y-auto border-t border-sidebar-border/30 bg-[var(--sidebar-depth-canvas)] px-3 py-2.5 sm:flex-row">
        <IngestAgentFlow
          compact
          status={job.status}
          phaseKey={job.phaseKey}
          role={role}
          readerTasks={job.readerTasks}
          challengeTask={job.challengeTask}
          mergeTask={job.mergeTask}
          jobId={job.jobId}
        />
        <div className="min-w-0 flex-1 py-0.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {phaseLine}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{body}</p>
          {currentDetail ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {currentDetail}
            </p>
          ) : null}
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">{fileName}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[min(72dvh,32rem)] w-full max-w-6xl flex-1 flex-col items-center justify-center gap-5 px-4 py-8 max-md:min-h-0 max-md:justify-start max-md:gap-2 max-md:px-1 max-md:py-1">
      <IngestAgentFlow
        status={job.status}
        phaseKey={job.phaseKey}
        role={role}
        readerTasks={job.readerTasks}
        challengeTask={job.challengeTask}
        mergeTask={job.mergeTask}
        jobId={job.jobId}
      />
      {!hasSwarmTasks ? (
        <div className="max-w-md text-center max-md:max-w-[22rem]">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground max-md:text-[10px] max-md:leading-tight max-md:tracking-[0.14em]">
            {phaseLine}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground max-md:mt-1 max-md:text-xs max-md:leading-snug">{body}</p>
          <p className="mt-2 text-sm text-muted-foreground max-md:mt-1 max-md:text-xs">{headline}</p>
          {currentDetail ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground max-md:mt-1 max-md:leading-snug">
              {currentDetail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
