import { withSharedIngestExclusive } from "@/lib/shared-ingest-serial";
import { drainHermesCompletionStreamBody } from "@/lib/hermes-drain-completion-stream";
import { recordHermesBrainIngestRun } from "@/lib/hermes-brain-ingest";
import { isUseMappedIngestActivityHeadline } from "@/lib/hermes-sse-stream";
import {
  getChatModel,
  getHermesArchitectBaseUrl,
  getHermesArchitectToken,
  getIngestChatModel,
  getIngestSwarmEffortConfig,
} from "@/lib/hermes-config";
import {
  buildIngestUserMessage,
  normalizeVaultAssetRole,
  type VaultAssetRole,
} from "@/lib/ingest-message";
import { ensureTemplateArtifactsForUpload } from "@/lib/template-ingest-artifacts";
import { activeWorkspaceSystemPrompt } from "@/lib/project-prompt";
import {
  applyIngestSourceProfile,
  postIngestQueueDonePush,
} from "@/lib/ingest-worker-profile";
import { sendPushToSubset } from "@/lib/push";
import { listVaultUploadedFiles, mimeTypeForVaultBasename, readProject } from "@/lib/project-service";
import { shouldUseChatDatabase } from "@/lib/db/client";
import { recordVaultIngestFailureCircuitDb } from "@/lib/db/repositories";
import { sharedVaultAutoIngestEnv } from "@/lib/shared-vault-ingest-config";
import {
  buildSharedIngestTouchedPathsHint,
  countActiveSharedIngestJobsForSlug,
  guessPhaseFromActivity,
  initializeSharedIngestSwarm,
  markSharedIngestJobDone,
  markSharedIngestJobError,
  markSharedIngestJobRunning,
  type SharedIngestJob,
  updateSharedIngestChallengeTask,
  updateSharedIngestMergeTask,
  updateSharedIngestJobPhase,
  type SharedIngestPhaseKey,
} from "@/lib/shared-ingest-job-store";
import {
  getSharedIngestSwarmReaderDefinitions,
  runSharedIngestSwarm,
  sharedIngestRequestTuning,
} from "@/lib/shared-ingest-swarm";
import { scheduleDebouncedVaultCoreferencePass } from "@/lib/vault-coreference-schedule";

async function recordIngestCircuitFailureIfDb(
  projectSlug: string,
  sourceRelativePath: string,
  message: string
): Promise<void> {
  if (!shouldUseChatDatabase()) return;
  const cfg = sharedVaultAutoIngestEnv();
  const now = Date.now();
  await recordVaultIngestFailureCircuitDb(
    projectSlug,
    sourceRelativePath,
    message,
    cfg.circuitMaxFailures,
    cfg.circuitPauseMs,
    now
  );
}

function gatewayTimeoutMs(): number | null {
  const raw = process.env.HERMES_CHAT_GATEWAY_TIMEOUT_MS?.trim();
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 0x7fffffff);
}

function sharedIngestSwarmEnabled(): boolean {
  const raw = process.env.HERMES_SHARED_INGEST_SWARM?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

const REINGEST_VERIFY_PREAMBLE = [
  "**Re-ingest mode (verify / repair):** HermesChat user requested a **re-sync** for a file **still in** `sources/`. Treat as **integrity check**, not a brand-new story.",
  "- **Read first:** `INDEX.md`, `index/ingest_manifest.json` (if present), current `extracted/`, and the role-appropriate tree (`templates/`, `scoring/`, or `segments/` for default). Do **not** assume prior deletes left the vault clean — rebuild only what is missing or invalid.",
  "- **No duplicates:** do **not** add a second `wiki/entities/…` page for the same entity — open existing, **merge**, extend **Sources** when `vault_profile.yaml` or this run touches wiki.",
  "- **Log:** append **LOG.md** with `reingest_verify` in the line and a short list of what was checked or repaired.",
  "",
].join("\n");

const FOCUSED_READER_CONTRACT = [
  "**Focused reader contract:** Treat ingest as a set of narrow reader passes. Use only the passes that fit the asset role, but finish with a coverage check before marking done.",
  "- **Text reader:** extract clean text, headings, tables, and media references with source paths.",
  "- **Detail reader:** identify people, organizations, dates, decisions, requirements, services, products, and other reusable facts.",
  "- **Structure reader:** capture section order, tone, layout, table/image placement, and reusable patterns when the upload is a style/structure example.",
  "- **Rule reader:** isolate requirements, standards, checks, thresholds, grading rules, and pass/fail cues when the upload is review rules.",
  "- **Relationship reader:** link related entities and topics; merge with existing notes instead of creating duplicates.",
  "- **Retrieval reader:** update router/INDEX/LOG so later Hermes answers read all relevant evidence paths, not the first matching chunk.",
].join("\n");

function buildSharedIngestAutomationPreamble(
  assetRole: VaultAssetRole,
  options?: { reingestVerify?: boolean }
): string {
  const prefix = options?.reingestVerify ? REINGEST_VERIFY_PREAMBLE : "";
  const slugNote =
    "Use absolute paths under `/vault-shared/<slug>/` for this vault (same as `/opt/hermes/projects/<slug>/`).";
  const orgGlobalLog =
    " When the user message names **contextVaultSlug** (organization library uploads), include that slug in the **LOG.md** line for provenance.";
  const readerContractLine =
    "**Reader contract (HermesChat v1):** **LOG.md** → **INDEX.md** → **`index/coreference.json`** (when present — merge all `mentions[]` for topics you use) → **SCHEMA.md** route the vault; **canonical text for agents** is **`extracted/`** and **`wiki/`** (then **`scoring/`** / **`templates/`** by role). **`sources/`** holds raw uploads — use for originals or when no extracted sibling exists, **not** as the default read for Q&A when **`extracted/*.md`** is present. **`segments/*.jsonl`** is the chunk layer — not the default first read unless INDEX points there.";

  if (assetRole === "output_template") {
    return (
      prefix +
      [
        "Automated WikiVault ingest run (no end-user chat).",
        readerContractLine,
        FOCUSED_READER_CONTRACT,
        "Execute **layout-and-tone template** ingest for the uploaded source without asking questions.",
        slugNote,
        "Use the app-native **output_template** ingest branch: run `extract.py`, then produce `templates/<source_stem>/outline.md` and `structure.yaml` (do **not** run factual-RAG `segment.py` / `segments/*.jsonl` for this source). Update INDEX.md and LOG.md.",
        "Verify before finishing: extracted `.md` + `.meta.json` exist; `templates/<source_stem>/outline.md` and `structure.yaml` exist; LOG.md has a new line.",
        "Do not use web, browser, or general chat; your toolset is ingest-only. Do not call markitdown/marker directly unless extract.py failed and you are diagnosing.",
        "Mandatory: append a dated one-line entry to `/vault-shared/<slug>/LOG.md` (create if missing) summarizing template structure outputs.",
        "Prefer **write_file** on disk for LOG.md / INDEX.md / templates/; use **workspace_knowledge_write** only as a Postgres mirror when internal Chat API is configured.",
      ].join("\n")
    );
  }

  if (assetRole === "scoring_criteria") {
    return (
      prefix +
      [
        "Automated WikiVault ingest run (no end-user chat).",
        readerContractLine,
        FOCUSED_READER_CONTRACT,
        "Execute **review rules** ingest for the uploaded source without asking questions.",
        slugNote,
        "Use the app-native **scoring_criteria** ingest branch: run `extract.py`, then populate `scoring/<source_stem>/` with `extracted.md`, `BLURB.md` (from user notes in the message when present), and `meta.json`. Maintain `scoring/README.md` or a labelled Review rules section in INDEX.md. **Do not** merge into `wiki/`. **Do not** write main `segments/*.jsonl` for default vault RAG for this source. Append LOG.md with role scoring_criteria.",
        "**Terminal:** This run is headless — **never** `python3 -c '...'` (gateway **approval_required**; no user to approve). Use **`write_file` → `/tmp/extract_*.py`** then **`python3 /tmp/...`**, or **`extract.py`** / heredoc script file only.",
        "Verify before finishing: `extracted/<filename>.md` exists; `scoring/<source_stem>/extracted.md` and `BLURB.md` exist; LOG.md has a new line.",
        "Do not use web, browser, or general chat; your toolset is ingest-only. Do not call markitdown/marker directly unless extract.py failed and you are diagnosing.",
        "Mandatory: append a dated one-line entry to `/vault-shared/<slug>/LOG.md` (create if missing) summarizing review-rule ingest paths.",
        "Prefer **write_file** on disk for LOG.md / INDEX.md / scoring/; use **workspace_knowledge_write** only as a Postgres mirror when internal Chat API is configured.",
      ].join("\n")
    );
  }

  if (assetRole === "company_branding") {
    return (
      prefix +
      [
        "Automated WikiVault ingest run (no end-user chat).",
        readerContractLine,
        FOCUSED_READER_CONTRACT,
        "Execute **brand details** ingest for the uploaded source (often a pasted `.md` plus optional reference images under `sources/`).",
        slugNote,
        "Follow the **user message** branch for `company_branding`: create or update **`branding/BRAND_KIT.md`** with canonical naming, site URL, colors, product/service terms, and an **Image prompts** subsection. Run **`extract.py`** on the markdown source when applicable; merge pasted **reference image paths** listed in the source into BRAND_KIT **Sources**.",
        "You may call **`web_search`** only to supplement **public** facts from an **official website URL** mentioned in the paste — attribute briefly in BRAND_KIT; do not invent credentials.",
        "Optionally merge into **`wiki/entities/companies/…`** only when a matching entity note already exists. Update INDEX.md and LOG.md with `asset_role: company_branding`.",
        "Verify before finishing: `branding/BRAND_KIT.md` exists and is non-empty; LOG.md has a new line; extracted text exists for the markdown source when the pipeline expects it.",
        "Prefer **write_file** on disk for LOG.md / INDEX.md / branding/; use **workspace_knowledge_write** only as a Postgres mirror when internal Chat API is configured.",
      ].join("\n")
    );
  }

  return (
    prefix +
    [
      "Automated WikiVault ingest run (no end-user chat).",
      readerContractLine,
      FOCUSED_READER_CONTRACT,
      "Execute the full ingest pipeline for the uploaded source without asking questions.",
      slugNote,
      "Use the app-native general vault ingest branch in order: run `extract.py` → `segment.py` → append `index/ingest_manifest.json` → **`wiki/` entity merge** unless `vault_profile.yaml` sets **`entity_extraction: minimal`** → update INDEX.md → append LOG.md.",
      "After **§5 wiki entity merge:** each updated **`wiki/entities/…`** note must extend **Sources** with **`extracted/<stem>.md`**, **`extracted/<stem>.extraction_map.json`** and **`extracted/<stem>.quality.json`** when present, relevant **`extracted/*_docx_media/*`** paths when images/OCR carry facts, and any OCR artifact paths the pipeline recorded — so HermesChat Q&A can aggregate text + images + map layers, not a single chunk.",
      "Undo safety: keep each Sources bullet source-specific and include `wiki_paths` in the ingest manifest for every wiki/brand note touched by this source.",
      "Verify before finishing: extracted `.md` + `.meta.json` exist; `segments/*.jsonl` exists with ≥1 line; LOG.md has a new line.",
      "Do not use web, browser, or general chat; your toolset is ingest-only. Do not call markitdown/marker directly unless extract.py failed and you are diagnosing.",
      "Mandatory: append a dated one-line entry to `/vault-shared/<slug>/LOG.md` (create if missing) summarizing what was ingested and key outputs — users and other tenants read this for shared-ingest feedback on shared disk." +
        orgGlobalLog,
      "Prefer **write_file** on disk for LOG.md / INDEX.md / wiki/; use **workspace_knowledge_write** only as a Postgres mirror when internal Chat API is configured.",
    ].join("\n")
  );
}

/**
 * Server-side shared ingest: shared ingest gateway + job store updates.
 * `pushTarget`: worker uses `"http"` (POST internal notify on Chat); Next.js (legacy) was `"next"`. Ingest is driven by `shared-ingest-worker`, not the web app.
 */
export async function runSharedIngestForJob(
  job: SharedIngestJob,
  options: {
    pushTarget: "http" | "next";
    pushSubscriptionEndpoint?: string | null;
  }
): Promise<void> {
  await applyIngestSourceProfile(job.ingestSourceProfile);
  const project = await readProject(job.projectSlug);
  if (!project) {
    await markSharedIngestJobError(
      job.jobId,
      "Vault not found (cannot run shared ingest)."
    );
    return;
  }

  const {
    jobId,
    fileName,
    relativePath,
    assetRole: rawAssetRole,
    contextVaultSlug,
  } = job;
  const skippedWrite = false;
  const mimeType =
    job.mimeType?.trim() || mimeTypeForVaultBasename(fileName);
  const duplicate = job.duplicate === true;
  const reingestVerify = job.reingestVerify === true;
  const assetRole = normalizeVaultAssetRole(rawAssetRole ?? "general_reference");
  if (project.visibility !== "shared") return;
  if (skippedWrite) return;

  const baseRaw = getHermesArchitectBaseUrl();
  const token = getHermesArchitectToken()?.trim();
  if (!baseRaw?.trim() || !token) {
    console.warn(
      "[shared-upload-ingest] skip: set shared ingest gateway URL and token"
    );
    const msg =
      "Chat is not configured for shared ingest.";
    await markSharedIngestJobError(jobId, msg);
    await recordIngestCircuitFailureIfDb(project.slug, relativePath, msg);
    return;
  }
  const base = baseRaw.replace(/\/$/, "");
  const modelId = getIngestChatModel() ?? getChatModel();
  const ingestTuning = getIngestSwarmEffortConfig();

  const uploadedRows = await listVaultUploadedFiles(project.slug);
  const uploadedFiles = uploadedRows.map((r) => ({
    relativePath: r.relativePath,
    name: r.name,
  }));

  const workspacePreamble = activeWorkspaceSystemPrompt({
    projectSlug: project.slug,
    projectName: project.name,
    uploadedFiles,
    workspaceVisibility: "shared",
  });

  const userText = buildIngestUserMessage({
    projectSlug: project.slug,
    projectName: project.name,
    fileName,
    relativePath,
    mimeType,
    duplicate,
    assetRole,
    ...(contextVaultSlug?.trim()
      ? { contextVaultSlug: contextVaultSlug.trim() }
      : {}),
    workspaceVisibility: "shared",
    ...(reingestVerify ? { reingestVerify: true } : {}),
  });

  const messages: { role: "system" | "user"; content: string }[] = [
    {
      role: "system",
      content: [
        buildSharedIngestAutomationPreamble(assetRole, {
          reingestVerify,
        }),
        "",
        workspacePreamble,
      ].join("\n"),
    },
    { role: "user", content: userText },
  ];

  const completionTimeoutMs = gatewayTimeoutMs();
  const runAbort = new AbortController();
  const timeoutId =
    completionTimeoutMs != null
      ? setTimeout(() => runAbort.abort(), completionTimeoutMs)
      : null;

  let runIdForOuterCatch: string | null = null;

  try {
    await withSharedIngestExclusive(async () => {
      const runId = await markSharedIngestJobRunning(jobId);
      if (runId == null) {
        await markSharedIngestJobError(
          jobId,
          "Ingest could not be started (job is no longer pending)."
        );
        return;
      }
      runIdForOuterCatch = runId;
      const useSwarm = sharedIngestSwarmEnabled();
      if (useSwarm) {
        const readerTasks = getSharedIngestSwarmReaderDefinitions(assetRole).map(
          (task) => ({
            id: task.id,
            label: task.label,
            description: task.description,
          })
        );
        await initializeSharedIngestSwarm(jobId, { runId, readerTasks });
      }

      let lastWrittenKey: SharedIngestPhaseKey | "" = "";
      let lastWrittenPhaseLine = "";

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
        signal: runAbort.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        console.error(
          "[shared-upload-ingest] completions error:",
          res.status,
          errText.slice(0, 400)
        );
        const msg = `Shared ingest request failed (${res.status}). ${errText.slice(0, 200)}`;
        await markSharedIngestJobError(jobId, msg, { runId });
        await recordIngestCircuitFailureIfDb(project.slug, relativePath, msg);
        return;
      }

      try {
        // Background ingest: job phases only; no ChatMessage row — see AGENTS.md "HermesChat inference cost".
        await drainHermesCompletionStreamBody(res.body, {
          onActivityHeadline: (headline) => {
            const g = guessPhaseFromActivity(headline);
            const useMapped = isUseMappedIngestActivityHeadline(headline);
            const phaseLine = useMapped ? g.label : headline.trim();
            if (g.key === lastWrittenKey && phaseLine === lastWrittenPhaseLine) {
              return;
            }
            lastWrittenKey = g.key;
            lastWrittenPhaseLine = phaseLine;
            void updateSharedIngestJobPhase(jobId, g.key, phaseLine);
          },
        });
      } catch (streamErr: unknown) {
        const errMsg =
          streamErr instanceof Error ? streamErr.message : String(streamErr);
        await markSharedIngestJobError(jobId, errMsg, { runId });
        await recordIngestCircuitFailureIfDb(project.slug, relativePath, errMsg);
        return;
      }

      let templateArtifactPaths: string[] = [];
      if (assetRole === "output_template") {
        await updateSharedIngestJobPhase(
          jobId,
          "structuring",
          "Checking reusable template files"
        );
        const ensured = await ensureTemplateArtifactsForUpload({
          projectSlug: project.slug,
          fileName,
          relativePath,
        });
        templateArtifactPaths = [
          `/vault-shared/${project.slug}/${ensured.outlineRelPath}`,
          `/vault-shared/${project.slug}/${ensured.structureRelPath}`,
        ];
      }

      let swarmOutputPaths: string[] = [];
      let swarmSummary: string | undefined;
      if (useSwarm) {
        await updateSharedIngestJobPhase(
          jobId,
          "relationships",
          "Spawning focused readers"
        );
        try {
          const swarm = await runSharedIngestSwarm({
            gateway: {
              base,
              token,
              modelId,
              signal: runAbort.signal,
              ...ingestTuning,
            },
            project,
            job,
            role: assetRole,
            runId,
          });
          swarmOutputPaths = swarm.outputPaths;
          swarmSummary = swarm.summary;
        } catch (swarmErr: unknown) {
          const msg =
            swarmErr instanceof Error ? swarmErr.message : String(swarmErr);
          console.error("[shared-upload-ingest] ingest swarm failed:", msg);
          await updateSharedIngestChallengeTask(
            jobId,
            {
              status: "error",
              progress: 0,
              detail: "Swarm challenge did not finish",
              errorMessage: msg.slice(0, 300),
            },
            { runId }
          );
          await updateSharedIngestMergeTask(
            jobId,
            {
              status: "skipped",
              progress: 0,
              detail: "Base ingest saved; swarm pack skipped",
            },
            { runId }
          );
        }
      }

      const touchedPaths = buildSharedIngestTouchedPathsHint({
        projectSlug: project.slug,
        fileName,
        assetRole,
      });
      const brainPaths = [
        `/vault-shared/${project.slug}/brain/manifest.json`,
        `/vault-shared/${project.slug}/brain/documents.jsonl`,
        `/vault-shared/${project.slug}/brain/retrieval/router.json`,
      ];
      const touchedPathsWithBrain = [...new Set([...touchedPaths, ...brainPaths])];
      const touchedPathsWithSwarm = [
        ...new Set([
          ...touchedPathsWithBrain,
          ...templateArtifactPaths,
          ...swarmOutputPaths,
        ]),
      ];
      try {
        await recordHermesBrainIngestRun({
          projectSlug: project.slug,
          visibility: project.visibility,
          fileName,
          relativePath,
          assetRole,
          runId,
          completedAt: new Date().toISOString(),
          outputPaths: touchedPathsWithSwarm,
          ...(swarmSummary ? { summary: swarmSummary } : {}),
        });
      } catch (brainErr: unknown) {
        console.error("[shared-upload-ingest] brain record failed:", brainErr);
      }
      await markSharedIngestJobDone(jobId, {
        projectSlug: project.slug,
        fileName,
        touchedPaths: touchedPathsWithSwarm,
        runId,
      });
      const activeAfter = await countActiveSharedIngestJobsForSlug(
        project.slug
      );
      if (activeAfter > 0) {
        return;
      }

      scheduleDebouncedVaultCoreferencePass(project.slug);

      if (options.pushTarget === "http") {
        try {
          await postIngestQueueDonePush({
            profile: job.ingestSourceProfile,
            projectName: project.name,
            projectSlug: project.slug,
            reingestVerify,
          });
        } catch (pushErr: unknown) {
          console.error(
            "[shared-upload-ingest] push (http queue done):",
            pushErr
          );
        }
        return;
      }

      const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
      const url = site
        ? `${site.replace(/\/$/, "")}/chat/workspace/${encodeURIComponent(project.slug)}`
        : undefined;
      try {
        await sendPushToSubset(
          {
            title: reingestVerify
              ? "Vault re-sync complete"
              : "Vault ingest complete",
            body: reingestVerify
              ? `${project.name} is ready. All queued re-sync work has finished.`
              : `${project.name} is ready. All queued ingest work has finished.`,
            ...(url ? { url } : {}),
            kind: "vault",
            tag: `vault-shared-${project.slug}`,
          },
          options.pushSubscriptionEndpoint?.trim()
            ? [options.pushSubscriptionEndpoint.trim()]
            : null
        );
      } catch (pushErr: unknown) {
        console.error(
          "[shared-upload-ingest] push (queue done):",
          pushErr
        );
      }
    });
  } catch (outer: unknown) {
    let msg = outer instanceof Error ? outer.message : String(outer);
    const baseUrl = getHermesArchitectBaseUrl();
    if (
      baseUrl &&
      (msg === "fetch failed" ||
        /failed to fetch|network|ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(msg))
    ) {
      msg = `${msg} — could not reach the shared ingest gateway at ${baseUrl}. Ensure the Chat service can reach its tenant Hermes gateway and the shared-wiki mount is writable by that gateway.`;
    }
    await markSharedIngestJobError(
      jobId,
      msg,
      runIdForOuterCatch != null ? { runId: runIdForOuterCatch } : undefined
    );
    await recordIngestCircuitFailureIfDb(project.slug, relativePath, msg);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}
