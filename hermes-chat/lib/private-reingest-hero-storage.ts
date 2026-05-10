/** SessionStorage: private vault Hermes re-verify → same chat session shows inline hero + file orb. */

import type { VaultAssetRole } from "@/lib/ingest-message";

export const PRIVATE_REINGEST_HERO_KEY = "hermes-private-reingest-hero";

export type PrivateReingestHeroPayload = {
  jobId: string;
  projectSlug: string;
  fileName: string;
  workspaceSessionKey: string;
  nonce: string;
  assetRole?: VaultAssetRole;
};
