import {
  listWorkspaceSessions,
  createWorkspaceSession,
  findReusableEmptyWorkspaceSession,
} from "@/lib/workspace-thread";
import { sessionHasAnyMessages } from "@/lib/hermes-chat-store";
import { getProjectVaultConfigError } from "@/lib/project-paths";
import { getActiveProcessingDetails } from "@/lib/session-processing-status";
import type { ProcessingKind } from "@/lib/sidebar-processing-surface";
import { getSourceWebchatsForPrivateReingestInSlug } from "@/lib/private-reingest-job-store";
import { getSourceWebchatsForActiveJobsInSlug } from "@/lib/shared-ingest-job-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    const [sessions, processingDetails, jobSourceWebchats] = await Promise.all([
      listWorkspaceSessions(slug),
      getActiveProcessingDetails(),
      getSourceWebchatsForActiveJobsInSlug(slug),
    ]);
    const privateReingestWebchats = getSourceWebchatsForPrivateReingestInSlug(slug);
    const withMessages: typeof sessions = [];
    for (const s of sessions) {
      if (await sessionHasAnyMessages(s.sessionId)) {
        withMessages.push(s);
      }
    }
    return Response.json({
      sessions: withMessages.map((s) => {
        const p = processingDetails.get(s.sessionId);
        const fromIngestQueue = jobSourceWebchats.has(s.sessionId);
        const fromPrivateReingest = privateReingestWebchats.has(s.sessionId);
        const processing =
          Boolean(p) || fromIngestQueue || fromPrivateReingest;
        const processingKind: ProcessingKind | undefined = (() => {
          if (p?.ingestViaArchitect || fromIngestQueue) return "architect";
          if (fromPrivateReingest || p) return "default";
          return undefined;
        })();
        return {
          id: s.sessionId,
          key: s.sessionKey,
          label: s.label,
          updatedAt: s.updatedAt,
          processing,
          processingKind,
        };
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }
  try {
    let reuseIfEmpty = false;
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        const body = (await req.json()) as { reuseIfEmpty?: unknown };
        reuseIfEmpty = body?.reuseIfEmpty === true;
      } catch {
        /* empty or invalid body — treat as new chat */
      }
    }
    if (reuseIfEmpty) {
      const existing = await findReusableEmptyWorkspaceSession(slug);
      if (existing) {
        return Response.json({
          sessionId: existing.sessionId,
          sessionKey: existing.sessionKey,
        });
      }
    }
    const { sessionId, sessionKey } = await createWorkspaceSession(slug);
    return Response.json({ sessionId, sessionKey });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("not found")) {
      return Response.json({ error: msg }, { status: 404 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
