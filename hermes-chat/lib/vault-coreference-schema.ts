/** Contract version for index/coreference.json (Hermes roadmap pass). */
export const VAULT_COREFERENCE_SCHEMA_VERSION = "1";

/** Where agents load the evidence map (POSIX relative to vault root). */
export const VAULT_COREFERENCE_REL_PATH = "index/coreference.json";

export type CoreferenceAuditTag = "extracted" | "inferred" | "ambiguous";

export type CoreferenceMentionKind =
  | "extracted"
  | "wiki"
  | "segment"
  | "source"
  | "template"
  | "scoring"
  | "manifest"
  | "index_router";

/** One filesystem location tied to a canonical topic/cluster. */
export type CoreferenceMention = {
  path: string;
  kind: CoreferenceMentionKind;
  anchor?: string;
  audit: CoreferenceAuditTag;
};

export type CoreferenceRelatedEdge = {
  to_canonical_id: string;
  audit: CoreferenceAuditTag;
  /** Short provenance note (e.g. wikilink, shared_manifest). */
  provenance?: string;
};

/** Cluster of paths about the same ingest bundle / entity / router row. */
export type CoreferenceTopic = {
  canonical_id: string;
  aliases: string[];
  mentions: CoreferenceMention[];
  related: CoreferenceRelatedEdge[];
};

/** Written by HermesChat roadmap pass; read after INDEX per vault-ingest-read-guide. */
export type VaultCoreferenceFile = {
  schema_version: string;
  vault_slug: string;
  generated_at: string;
  topics: CoreferenceTopic[];
};
