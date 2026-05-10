/** SessionStorage bridge: shared vault upload → new chat with architect hero. */

import type { VaultAssetRole } from "@/lib/ingest-message";

export const SHARED_INGEST_HERO_KEY = "hermes-shared-ingest-hero";

export type SharedIngestHeroPayload = {
  jobId: string;
  projectSlug: string;
  fileName: string;
  workspaceSessionKey: string;
  nonce: string;
  assetRole?: VaultAssetRole;
};
