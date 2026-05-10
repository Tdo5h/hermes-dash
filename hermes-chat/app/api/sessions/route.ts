import { after } from "next/server";
import { readFile, writeFile, access } from "fs/promises";
import { isHeartbeatNoiseLabel } from "@/lib/heartbeat-noise";
import { getHermesChatSessionsJsonPath } from "@/lib/hermes-chat-paths";
import { getMessagesJsonPath, readSessionsStore } from "@/lib/hermes-chat-store";
import { dedupeSessionsForSidebar } from "@/lib/sidebar-sessions";
import { transcriptSidebarEnrichment } from "@/lib/session-transcript-flags";
import { getActiveProcessingDetails } from "@/lib/session-processing-status";
import {
  buildProcessingSurface,
  kindForWebchatId,
  mergePrivateHermesReingestIntoSurface,
  mergeSharedIngestQueueIntoSurface,
} from "@/lib/sidebar-processing-surface";
import { getPrivateHermesReingestSidebarActivity } from "@/lib/private-reingest-job-store";
import { getSidebarActivityFromIngestQueue } from "@/lib/shared-ingest-job-store";
import { parseBuildEditPayload } from "@/lib/builds-manifest";
import { parseCreativeStudioPayload } from "@/lib/creative-studio-session";
import { maybeRunCreateKanbanJanitor } from "@/lib/create-kanban-cleanup";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { sessionHasMessagesDb, pruneOrphanSessionsDb } from "@/lib/db/repositories";

const SESSIONS_PATH = getHermesChatSessionsJsonPath();

const MAX_SIDEBAR = 50;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

function isWebchatKey(key: string): boolean {
  return key.startsWith("webchat:") || key.includes(":webchat:");
}

function extractWebchatId(key: string): string {
  const idx = key.lastIndexOf("webchat:");
  return idx >= 0 ? key.slice(idx + 8) : key;
}

async function messageFileExists(sessionId: string): Promise<boolean> {
  if (shouldUseChatDatabase()) {
    return sessionHasMessagesDb(sessionId);
  }
  try {
    await access(getMessagesJsonPath(sessionId));
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const data = await readSessionsStore();

    const [processingDetails, ingestSidebarActivity] = await Promise.all([
      getActiveProcessingDetails(),
      getSidebarActivityFromIngestQueue(),
    ]);
    const privateReingestSidebarActivity = getPrivateHermesReingestSidebarActivity();
    const processingIds = new Set(processingDetails.keys());

    const allRows = Object.entries(data)
      .filter(([key, value]) => {
        if (!isWebchatKey(key)) return false;
        const v = value as { label?: string; origin?: { label?: string } };
        if (!v.label && !v.origin?.label) return false;
        return true;
      })
      .map(([key, value]) => {
        const v = value as {
          sessionId?: string;
          label?: string;
          origin?: { label?: string };
          updatedAt?: number;
          chatType?: string;
          projectId?: string;
          buildEdit?: unknown;
          creativeStudio?: unknown;
        };
        const webId = isWebchatKey(key) ? extractWebchatId(key) : null;
        const chatType = v.chatType || "direct";
        const projectId =
          typeof v.projectId === "string" && v.projectId.trim()
            ? v.projectId.trim()
            : null;
        let buildId: string | undefined;
        let buildName: string | undefined;
        if (chatType === "build_edit" && v.buildEdit != null) {
          const p = parseBuildEditPayload(v.buildEdit);
          if (p) {
            buildId = p.buildId;
            buildName = p.name;
          }
        }
        let createIntent: string | undefined;
        let creativePublishedId: string | undefined;
        let creativePublishedName: string | undefined;
        if (chatType === "creative_studio" && v.creativeStudio != null) {
          const cs = parseCreativeStudioPayload(v.creativeStudio);
          if (cs) {
            createIntent = cs.intent;
            if (cs.publishedBuildId) {
              creativePublishedId = cs.publishedBuildId;
              creativePublishedName =
                cs.publishedBuildName ?? undefined;
            }
          }
        }
        const effectiveBuildId = buildId ?? creativePublishedId;
        const effectiveBuildName = buildName ?? creativePublishedName;
        return {
          id: v.sessionId || webId || key,
          key,
          webchatId: webId,
          label:
            v.label ||
            v.origin?.label ||
            key.split(":").pop() ||
            "Chat",
          updatedAt: v.updatedAt || 0,
          chatType,
          projectId,
          processing: webId ? processingIds.has(webId) : false,
          ...(effectiveBuildId
            ? {
                buildId: effectiveBuildId,
                buildName: effectiveBuildName ?? null,
              }
            : {}),
          ...(createIntent ? { createIntent } : {}),
        };
      })
      .filter((s) => !isHeartbeatNoiseLabel(s.label));

    const processingSurface = mergePrivateHermesReingestIntoSurface(
      mergeSharedIngestQueueIntoSurface(
        buildProcessingSurface(
          processingDetails,
          allRows.map((r) => ({
            webchatId: r.webchatId,
            id: r.id,
            chatType: r.chatType,
            projectId: r.projectId,
          }))
        ),
        ingestSidebarActivity
      ),
      privateReingestSidebarActivity
    );

    const mainCandidates = allRows.filter(
      (s) =>
        s.chatType !== "workspace" &&
        s.chatType !== "build_edit" &&
        s.chatType !== "creative_studio" &&
        !(s as { projectId?: string | null }).projectId
    );

    const buildEditCandidates = allRows.filter(
      (s) => s.chatType === "build_edit"
    );

    const creativeStudioCandidates = allRows.filter(
      (s) => s.chatType === "creative_studio"
    );

    const deduped = dedupeSessionsForSidebar(mainCandidates).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
    const sessionsOut = deduped.slice(0, MAX_SIDEBAR);

    const dedupedBuildEdits = dedupeSessionsForSidebar(
      buildEditCandidates
    ).sort((a, b) => b.updatedAt - a.updatedAt);
    const buildEditsOut = dedupedBuildEdits.slice(0, MAX_SIDEBAR);

    const dedupedCreativeStudio = dedupeSessionsForSidebar(
      creativeStudioCandidates
    ).sort((a, b) => b.updatedAt - a.updatedAt);
    const creativeStudioOut = dedupedCreativeStudio.slice(0, MAX_SIDEBAR);

    const enriched = await Promise.all(
      sessionsOut.map(async (s) => {
        const sid = String(s.webchatId || s.id);
        const { hasImages, messageCount, promptCount } =
          await transcriptSidebarEnrichment(sid);
        const wid = s.webchatId;
        return {
          ...s,
          hasImages,
          messageCount,
          promptCount,
          processingKind: kindForWebchatId(
            processingSurface,
            wid,
            Boolean(wid && processingIds.has(wid))
          ),
        };
      })
    );

    const buildEditsEnriched = await Promise.all(
      buildEditsOut.map(async (s) => {
        const sid = String(s.webchatId || s.id);
        const { hasImages, messageCount, promptCount } =
          await transcriptSidebarEnrichment(sid);
        const wid = s.webchatId;
        return {
          ...s,
          hasImages,
          messageCount,
          promptCount,
          processingKind: kindForWebchatId(
            processingSurface,
            wid,
            Boolean(wid && processingIds.has(wid))
          ),
        };
      })
    );

    const creativeStudioEnriched = await Promise.all(
      creativeStudioOut.map(async (s) => {
        const sid = String(s.webchatId || s.id);
        const { hasImages, messageCount, promptCount } =
          await transcriptSidebarEnrichment(sid);
        const wid = s.webchatId;
        return {
          ...s,
          hasImages,
          messageCount,
          promptCount,
          processingKind: kindForWebchatId(
            processingSurface,
            wid,
            Boolean(wid && processingIds.has(wid))
          ),
        };
      })
    );

    after(pruneOrphanWebchats);
    after(() => maybeRunCreateKanbanJanitor());

    return Response.json({
      sessions: enriched,
      buildEditSessions: buildEditsEnriched,
      creativeStudioSessions: creativeStudioEnriched,
      processingSurface,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

async function pruneOrphanWebchats() {
  try {
    if (shouldUseChatDatabase()) {
      await pruneOrphanSessionsDb(ORPHAN_AGE_MS, Date.now());
      return;
    }
    const raw = await readFile(SESSIONS_PATH, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const now = Date.now();
    let changed = false;

    for (const [key, value] of Object.entries(data)) {
      if (!isWebchatKey(key)) continue;
      const v = value as { updatedAt?: number; sessionId?: string; label?: string };
      const age = now - (v.updatedAt || 0);
      if (age < ORPHAN_AGE_MS) continue;

      const sid = v.sessionId;
      const hasTranscript = sid && (await messageFileExists(sid));

      if (!hasTranscript || !v.label) {
        delete data[key];
        changed = true;
      }
    }

    if (changed) {
      await writeFile(SESSIONS_PATH, JSON.stringify(data, null, 2));
    }
  } catch {
    // best-effort cleanup
  }
}
