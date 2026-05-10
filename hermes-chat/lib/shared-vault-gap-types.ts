/** Client-safe types for shared-ingest-status `gapHints` (avoid importing vault-ingest-gap in "use client"). */

export type SharedVaultGapHint = {
  relativePath: string;
  name: string;
  kind: "missing_extracted" | "circuit_paused" | "auto_exhausted";
  detail?: string;
};
