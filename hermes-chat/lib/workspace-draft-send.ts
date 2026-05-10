/** SessionStorage bridge: first message from workspace draft page after session is created. */

import type { VaultAssetRole } from "@/lib/ingest-message";

export const WORKSPACE_DRAFT_INITIAL_KEY = "hermes-workspace-draft-initial";

export type WorkspaceDraftInitialPayload = {
  sessionId: string;
  text: string;
  nonce: string;
  /** Optional ingest model id captured when the draft message was queued. */
  ingestModelOverride?: string;
  /** Role chosen in paste modal; already baked into `text` for plain-ingest. */
  assetRole?: VaultAssetRole;
};
