import type { SharedIngestJobPublic } from "@/lib/shared-ingest-job-store";
import type {
  SharedIngestPhaseKey,
  SharedIngestReaderTask,
  SharedIngestReviewTask,
} from "@/lib/shared-ingest-job-store";
import type { VaultAssetRole } from "@/lib/ingest-message";

/** Private-vault Hermes verify/re-ingest — same file-row + inline hero pattern as architect jobs. */
export type HermesPrivateReingestJobPublic = {
  ingestKind: "hermes_private";
  jobId: string;
  projectSlug: string;
  relativePath: string;
  fileName: string;
  status: "running" | "error";
  phaseKey: SharedIngestPhaseKey;
  phaseLabel: string;
  errorMessage?: string;
  assetRole?: VaultAssetRole | null;
  reingestVerify?: boolean;
  readerTasks?: SharedIngestReaderTask[];
  challengeTask?: SharedIngestReviewTask;
  mergeTask?: SharedIngestReviewTask;
};

export type WorkspaceVaultIngestJob =
  | SharedIngestJobPublic
  | HermesPrivateReingestJobPublic;

export function isHermesPrivateIngestJob(
  j: WorkspaceVaultIngestJob
): j is HermesPrivateReingestJobPublic {
  return "ingestKind" in j && j.ingestKind === "hermes_private";
}

export function matchWorkspaceVaultIngestJob(
  f: { name: string; relativePath: string },
  jobs: WorkspaceVaultIngestJob[]
): WorkspaceVaultIngestJob | undefined {
  return jobs.find(
    (j) =>
      j.relativePath === f.relativePath ||
      j.fileName === f.name ||
      j.relativePath.endsWith(f.name)
  );
}
