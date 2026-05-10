/** SessionStorage bridge: vault upload completed in one chat, ingest runs after navigate to workspace session. */

export const VAULT_PENDING_INGEST_KEY = "hermes-pending-vault-ingest";

export type VaultPendingIngestPayload = {
  targetSessionKey: string;
  ingestText: string;
  nonce: string;
  /** Snapshot from Settings / localStorage when the upload finished (optional). */
  ingestModelOverride?: string;
};
