import { drainHermesCompletionStreamBody } from "@/lib/hermes-drain-completion-stream";
import { recordHermesBrainIngestRun } from "@/lib/hermes-brain-ingest";
import { isUseMappedIngestActivityHeadline } from "@/lib/hermes-sse-stream";
import { guessPhaseFromActivity } from "@/lib/shared-ingest-job-store";
import {
  getChatModel,
  getHermesBaseUrl,
  getHermesToken,
  getIngestChatModel,
  getIngestSwarmEffortConfig,
} from "@/lib/hermes-config";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { getVaultAssetRoleByPathDb } from "@/lib/db/repositories";
import { buildIngestUserMessage, normalizeVaultAssetRole } from "@/lib/ingest-message";
import { activeWorkspaceSystemPrompt } from "@/lib/project-prompt";
import {
  initializePrivateIngestSwarm,
  markPrivateIngestJobRunning,
  updatePrivateIngestChallengeTask,
  updatePrivateIngestJobPhase,
  updatePrivateIngestMergeTask,
  updatePrivateIngestReaderTask,
  completePrivateReingestJob,
  failPrivateReingestJob,
} from "@/lib/private-reingest-job-store";
import {
  type ProjectRecord,
  listVaultUploadedFiles,
  mimeTypeForVaultBasename,
  readProject,
} from "@/lib/project-service";
import { ensureTemplateArtifactsForUpload } from "@/lib/template-ingest-artifacts";
import {
  getSharedIngestSwarmReaderDefinitions,
  runSharedIngestSwarm,
  sharedIngestRequestTuning,
  type IngestSwarmStateAdapter,
} from "@/lib/shared-ingest-swarm";
import path from "path";

/** Fast validation (no Hermes) — used by API before returning 202. */
export async function findVaultSourceRow(
  projectSlug: string,
  fileNameOrRelativePath: string
): Promise<{
  meta: ProjectRecord;
  row: { name: string; relativePath: string; size: number };
  files: Awaited<ReturnType<typeof listVaultUploadedFiles>>;
}> {
  const meta = await readProject(projectSlug);
  if (!meta) {
    throw new Error("Project not found");
  }
  if (meta.visibility !== "private") {
    throw new Error("Private vault required");
  }

  const raw = fileNameOrRelativePath.trim();
  const files = await listVaultUploadedFiles(projectSlug);
  const row =
    files.find((f) => f.relativePath === raw) ||
    files.find((f) => f.name === raw) ||
    files.find((f) => f.relativePath.endsWith(`/${path.posix.basename(raw)}`));

  if (!row) {
    throw new Error("File not found under sources/");
  }
  return { meta, row, files };
}

function privateReadableRoot(projectSlug: string): string {
  return `projects/${projectSlug}/`;
}

function buildPrivateTouchedPathsHint(params: {
  projectSlug: string;
  fileName: string;
  assetRole: ReturnType<typeof normalizeVaultAssetRole>;
}): string[] {
  const base = params.fileName.replace(/^.*[\\/]/, "");
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const root = privateReadableRoot(params.projectSlug);
  const out = [
    `${root}SCHEMA.md`,
    `${root}INDEX.md`,
    `${root}LOG.md`,
    `${root}index/ingest_manifest.json`,
    `${root}sources/${base}`,
    `${root}extracted/${base}.md`,
  ];
  if (params.assetRole === "output_template") {
    out.push(
      `${root}templates/${stem}/outline.md`,
      `${root}templates/${stem}/structure.yaml`
    );
  } else if (params.assetRole === "scoring_criteria") {
    out.push(
      `${root}scoring/${stem}/extracted.md`,
      `${root}scoring/${stem}/BLURB.md`
    );
  } else if (params.assetRole === "company_branding") {
    out.push(`${root}branding/BRAND_KIT.md`);
  } else {
    out.push(`${root}segments/${base}.md.jsonl`);
  }
  return [...new Set(out)];
}

function buildPrivateIngestAutomationPreamble(params: {
  projectSlug: string;
  assetRole: ReturnType<typeof normalizeVaultAssetRole>;
  reingestVerify: boolean;
}): string {
  const verifyPrefix = params.reingestVerify
    ? "This is a verify/repair pass. Read existing INDEX, LOG, extracted files, brain files, and source artifacts first. Re-run extraction only when missing, stale, empty, or clearly wrong.\n"
    : "";
  return [
    verifyPrefix +
      "Automated private WikiVault ingest run. Do not answer the user in chat.",
    "Privacy boundary: this is a private vault. Read and write only under `projects/" +
      params.projectSlug +
      "/`. Never read `/vault-shared/`, never write shared files, and never use another private vault unless the user explicitly named it.",
    "Use the same 2026 Hermes brain flow as shared ingest: extract text and media, preserve tables/images/OCR uncertainty, build or update wiki/entity notes, update INDEX.md, append LOG.md, then produce a source-backed brain record.",
    "Focused reader contract: do not stop at the first snippet. Sample across the whole extracted source, source map, quality report, tables, media sidecars, and existing wiki notes.",
    params.assetRole === "output_template"
      ? "Template role: capture reusable structure, section order, typography/tone clues, and image/table placement under templates/<source_stem>/ without copying private facts as reusable facts."
      : params.assetRole === "scoring_criteria"
        ? "Review rules role: store rules under scoring/<source_stem>/ and do not merge them into normal facts unless they are explicit source facts."
        : params.assetRole === "company_branding"
          ? "Brand role: update branding/BRAND_KIT.md with source-backed names, voice, visual cues, image grounding, and useful Create instructions."
          : "Knowledge role: merge salient people, organizations, projects, dates, decisions, and reusable facts into wiki/entities with Sources that point back to extracted files and media/OCR artifacts.",
    "Mandatory outputs: extracted markdown, INDEX.md update, LOG.md entry, and brain manifest/router records. Keep uncertainty visible instead of inventing missing details.",
  ].join("\n");
}

const privateSwarmState: IngestSwarmStateAdapter = {
  updateReaderTask: updatePrivateIngestReaderTask,
  updateChallengeTask: updatePrivateIngestChallengeTask,
  updateMergeTask: updatePrivateIngestMergeTask,
};

/**
 * Headless private ingest against the tenant Hermes gateway.
 * It does not send an ingest prompt into visible chat and never uses the shared worker/queue.
 */
export async function runPrivateVaultReingestHeadless(
  projectSlug: string,
  fileNameOrRelativePath: string,
  preloaded?: Awaited<ReturnType<typeof findVaultSourceRow>>,
  options?: { jobId?: string; reingestVerify?: boolean }
): Promise<void> {
  const { meta, row, files } =
    preloaded ??
    (await findVaultSourceRow(projectSlug, fileNameOrRelativePath));

  const base = getHermesBaseUrl()?.replace(/\/$/, "");
  const token = getHermesToken()?.trim();
  if (!base || !token) {
    throw new Error("Set HERMES_URL and HERMES_TOKEN for HermesChat");
  }

  const roleStr = shouldUseChatDatabase()
    ? await getVaultAssetRoleByPathDb(projectSlug, row.relativePath)
    : null;
  const assetRole = normalizeVaultAssetRole(roleStr ?? "general_reference");
  const reingestVerify = options?.reingestVerify !== false;
  const jobId = options?.jobId?.trim();
  const runId = jobId ? markPrivateIngestJobRunning(jobId) : null;

  const userText = buildIngestUserMessage({
    projectSlug: meta.slug,
    projectName: meta.name,
    fileName: row.name,
    relativePath: row.relativePath,
    mimeType: mimeTypeForVaultBasename(row.name),
    workspaceVisibility: "private",
    assetRole,
    reingestVerify,
  });

  const uploadedFiles = files.map((r) => ({
    relativePath: r.relativePath,
    name: r.name,
  }));
  const workspacePreamble = activeWorkspaceSystemPrompt({
    projectSlug: meta.slug,
    projectName: meta.name,
    uploadedFiles,
    workspaceVisibility: "private",
  });

  const modelId = getIngestChatModel() ?? getChatModel();
  const ingestTuning = getIngestSwarmEffortConfig();
  const messages: { role: "system" | "user"; content: string }[] = [
    {
      role: "system",
      content: [
        buildPrivateIngestAutomationPreamble({
          projectSlug: meta.slug,
          assetRole,
          reingestVerify,
        }),
        "",
        workspacePreamble,
      ].join("\n"),
    },
    { role: "user", content: userText },
  ];

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: true,
        stream_tool_progress: true,
        stream_options: { include_usage: true },
        ...sharedIngestRequestTuning(ingestTuning, "review"),
      }),
    });

    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      throw new Error(
        res.status
          ? `Hermes ${res.status}: ${t.slice(0, 200)}`
          : "Hermes returned no body"
      );
    }

    let lastWrittenKey = "";
    let lastWrittenPhaseLine = "";
    await drainHermesCompletionStreamBody(res.body, {
      onActivityHeadline: (headline) => {
        if (!jobId) return;
        const g = guessPhaseFromActivity(headline);
        const useMapped = isUseMappedIngestActivityHeadline(headline);
        const phaseLine = useMapped ? g.label : headline.trim();
        if (g.key === lastWrittenKey && phaseLine === lastWrittenPhaseLine) return;
        lastWrittenKey = g.key;
        lastWrittenPhaseLine = phaseLine;
        updatePrivateIngestJobPhase(jobId, g.key, phaseLine);
      },
    });

    let templateArtifactPaths: string[] = [];
    if (assetRole === "output_template") {
      const ensured = await ensureTemplateArtifactsForUpload({
        projectSlug: meta.slug,
        fileName: row.name,
        relativePath: row.relativePath,
      });
      templateArtifactPaths = [
        `projects/${meta.slug}/${ensured.outlineRelPath}`,
        `projects/${meta.slug}/${ensured.structureRelPath}`,
      ];
    }

    let swarmOutputPaths: string[] = [];
    let swarmSummary: string | undefined;
    if (jobId && runId && process.env.HERMES_SHARED_INGEST_SWARM !== "0") {
      const readerTasks = getSharedIngestSwarmReaderDefinitions(assetRole).map(
        (task) => ({
          id: task.id,
          label: task.label,
          description: task.description,
        })
      );
      await initializePrivateIngestSwarm(jobId, { runId, readerTasks });
      updatePrivateIngestJobPhase(jobId, "relationships", "Spawning focused readers");
      const swarm = await runSharedIngestSwarm({
        gateway: {
          base,
          token,
          modelId,
          signal: new AbortController().signal,
          ...ingestTuning,
        },
        project: meta,
        job: {
          jobId,
          projectSlug: meta.slug,
          relativePath: row.relativePath,
          fileName: row.name,
          status: "running",
          phaseKey: "relationships",
          phaseLabel: "Spawning focused readers",
          updatedAt: Date.now(),
          assetRole,
          mimeType: mimeTypeForVaultBasename(row.name),
          reingestVerify,
        },
        role: assetRole,
        runId,
        state: privateSwarmState,
      });
      swarmOutputPaths = swarm.outputPaths;
      swarmSummary = swarm.summary;
    }

    const touchedPaths = buildPrivateTouchedPathsHint({
      projectSlug: meta.slug,
      fileName: row.name,
      assetRole,
    });
    const brainPaths = [
      `projects/${meta.slug}/brain/manifest.json`,
      `projects/${meta.slug}/brain/documents.jsonl`,
      `projects/${meta.slug}/brain/retrieval/router.json`,
    ];
    const touchedPathsWithBrain = [
      ...new Set([
        ...touchedPaths,
        ...brainPaths,
        ...templateArtifactPaths,
        ...swarmOutputPaths,
      ]),
    ];
    await recordHermesBrainIngestRun({
      projectSlug: meta.slug,
      visibility: "private",
      fileName: row.name,
      relativePath: row.relativePath,
      assetRole,
      ...(runId ? { runId } : {}),
      completedAt: new Date().toISOString(),
      outputPaths: touchedPathsWithBrain,
      ...(swarmSummary ? { summary: swarmSummary } : {}),
    });
    if (jobId) {
      completePrivateReingestJob(jobId, {
        touchedPaths: touchedPathsWithBrain,
        ...(runId ? { runId } : {}),
      });
    }
  } catch (e) {
    if (jobId) {
      const m = e instanceof Error ? e.message : String(e);
      failPrivateReingestJob(jobId, m, runId ? { runId } : undefined);
    }
    throw e;
  }
}
