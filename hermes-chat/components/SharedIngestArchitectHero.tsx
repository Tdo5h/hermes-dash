"use client";

import { useEffect, useRef, useState } from "react";
import { Orb } from "@/components/ui/orb";
import { IngestAgentFlow } from "@/components/IngestAgentFlow";
import {
  connectingInlineBody,
  ingestDetailLine,
  ingestHeroHeadline,
  ingestProgressLine,
  queuedHeroBody,
  runningHeroBody,
} from "@/lib/shared-ingest-hero-copy";
import {
  normalizeVaultAssetRole,
  type VaultAssetRole,
} from "@/lib/ingest-message";
import { CHAT_AGENT_ORB_COLORS } from "@/lib/architect-orb-presets";
import type { SharedIngestJobPublic } from "@/lib/shared-ingest-job-store";

type Props = {
  projectSlug: string;
  jobId: string;
  fileName: string;
  /** From session handoff before first poll returns job row. */
  assetRole?: VaultAssetRole;
  onComplete: () => void;
  /** `inline` = strip above composer; `full` = centered hero (legacy). */
  variant?: "full" | "inline";
};

export function SharedIngestArchitectHero({
  projectSlug,
  jobId,
  fileName,
  assetRole: assetRoleProp,
  onComplete,
  variant = "full",
}: Props) {
  const [job, setJob] = useState<SharedIngestJobPublic | null | undefined>(
    undefined
  );
  const [ingestServiceHint, setIngestServiceHint] = useState<string | null>(
    null
  );
  const [visibleDetail, setVisibleDetail] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(
          `/api/projects/${encodeURIComponent(projectSlug)}/shared-ingest-status?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        const d = (await r.json()) as {
          job?: SharedIngestJobPublic | null;
          workerOk?: boolean;
          workerMessage?: string | null;
          architectReachable?: boolean | null;
          sharedIngestGatewayReachable?: boolean | null;
        };
        if (cancelled) return;
        setJob(d.job ?? null);
        if (d.workerOk === false && d.workerMessage?.trim()) {
          setIngestServiceHint(d.workerMessage.trim());
        } else if (
          d.sharedIngestGatewayReachable === false ||
          d.architectReachable === false
        ) {
          setIngestServiceHint(
            "The shared ingest gateway did not respond to a health check. Ingests may stay queued until it is back."
          );
        } else {
          setIngestServiceHint(null);
        }
        const st = d.job?.status;
        if (st === "done" || st === "error") {
          onCompleteRef.current();
        }
      } catch {
        if (!cancelled) {
          setJob((current) => (current === undefined ? null : current));
          setIngestServiceHint(
            "Reconnecting to the ingest status feed. Hermes is keeping the current job on screen."
          );
        }
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectSlug, jobId]);

  const role: VaultAssetRole | undefined =
    job?.assetRole !== undefined
      ? normalizeVaultAssetRole(job.assetRole)
      : assetRoleProp !== undefined
        ? normalizeVaultAssetRole(assetRoleProp)
        : undefined;

  const roleForConnecting =
    assetRoleProp !== undefined
      ? normalizeVaultAssetRole(assetRoleProp)
      : undefined;

  const phaseLine = job
    ? ingestProgressLine({
        status: job.status,
        phaseKey: job.phaseKey,
        role,
        isQueuedWaiting: job.isQueuedWaiting,
        slugQueuePosition: job.slugQueuePosition,
      })
    : "Working…";
  const currentDetail =
    job?.status === "running" ? ingestDetailLine(job.phaseLabel, phaseLine) : null;

  useEffect(() => {
    if (!currentDetail) {
      setVisibleDetail(null);
      return;
    }
    if (currentDetail === visibleDetail) return;
    const id = setTimeout(
      () => setVisibleDetail(currentDetail),
      visibleDetail ? 5500 : 0
    );
    return () => clearTimeout(id);
  }, [currentDetail, visibleDetail]);

  if (job === undefined) {
    const connectBody = connectingInlineBody(
      fileName,
      roleForConnecting
    );
    const preHeadline = ingestHeroHeadline(fileName, roleForConnecting);
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
              Connecting
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">
              {connectBody}
            </p>
            <p className="mt-1.5 text-xs font-medium text-muted-foreground">
              {preHeadline}
            </p>
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
            Connecting
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {connectBody}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{preHeadline}</p>
        </div>
      </div>
    );
  }

  if (job === null) {
    return null;
  }

  const headline = ingestHeroHeadline(fileName, role);
  const body =
    job?.status === "queued" && job.isQueuedWaiting
      ? queuedHeroBody()
      : job?.status === "running" || job?.status === "queued"
        ? runningHeroBody(role)
        : job?.status === "error"
          ? job.errorMessage?.trim() ||
            "We couldn’t finish this ingest. You can try uploading again."
          : "Almost done - your file is being wired into the vault. If the list still says “needs ingest,” refresh in a moment.";
  const hasSwarmTasks = Boolean(
    (job.readerTasks?.length ?? 0) > 0 || job.challengeTask || job.mergeTask
  );

  if (variant === "inline") {
    return (
      <div className="flex max-h-[min(48dvh,21rem)] shrink-0 flex-col gap-3 overflow-y-auto border-t border-sidebar-border/30 bg-[var(--sidebar-depth-canvas)] px-3 py-2.5 sm:flex-row">
        <IngestAgentFlow
          compact
          status={job.status}
          phaseKey={job.phaseKey}
          role={role}
          isQueuedWaiting={job.isQueuedWaiting}
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
          {visibleDetail ? (
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              Right now: {visibleDetail}
            </p>
          ) : null}
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">
            {headline}
          </p>
          {ingestServiceHint ? (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500/90">
              {ingestServiceHint}
            </p>
          ) : null}
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
        isQueuedWaiting={job.isQueuedWaiting}
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
          {visibleDetail ? (
            <p className="mt-2 text-sm leading-snug text-muted-foreground max-md:mt-1 max-md:text-xs">
              Right now: {visibleDetail}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground max-md:mt-1 max-md:text-xs">{headline}</p>
          {ingestServiceHint ? (
            <p className="mt-2 text-xs text-amber-600 max-md:mt-1 dark:text-amber-500/90">
              {ingestServiceHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
