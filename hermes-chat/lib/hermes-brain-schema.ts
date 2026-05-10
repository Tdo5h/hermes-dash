import type { VaultAssetRole } from "@/lib/ingest-message";

export const HERMES_BRAIN_DIR = "brain";
export const HERMES_BRAIN_MANIFEST_PATH = "brain/manifest.json";
export const HERMES_BRAIN_ENTITIES_PATH = "brain/entities.jsonl";
export const HERMES_BRAIN_FACTS_PATH = "brain/facts.jsonl";
export const HERMES_BRAIN_RELATIONSHIPS_PATH = "brain/relationships.jsonl";
export const HERMES_BRAIN_DOCUMENTS_PATH = "brain/documents.jsonl";
export const HERMES_BRAIN_PEOPLE_PROFILES_PATH = "brain/profiles/people.jsonl";
export const HERMES_BRAIN_COMPANY_PROFILES_PATH = "brain/profiles/companies.jsonl";
export const HERMES_BRAIN_RETRIEVAL_ROUTER_PATH = "brain/retrieval/router.json";
export const HERMES_BRAIN_WEBSITE_CRAWLS_PATH = "brain/website-crawls.jsonl";

export type HermesBrainVisibility = "private" | "shared" | "org_global";

export type HermesBrainConfidence = "low" | "medium" | "high";

export type HermesBrainEvidenceKind =
  | "source"
  | "extracted"
  | "segment"
  | "wiki"
  | "template"
  | "scoring"
  | "branding"
  | "profile"
  | "brain"
  | "ocr"
  | "image"
  | "table";

export type HermesBrainEntityKind =
  | "person"
  | "company"
  | "project"
  | "document"
  | "requirement"
  | "decision"
  | "meeting"
  | "asset"
  | "product"
  | "place"
  | "concept"
  | "template"
  | "rubric"
  | "brand"
  | "image"
  | "table";

export type HermesBrainWebsiteCrawlRecord = HermesBrainRecordBase & {
  kind: "company_website_crawl";
  companyName?: string | null;
  startUrl: string;
  origin: string;
  sourcePath: string;
  pagesCaptured: number;
  internalLinks: string[];
  externalLinks: string[];
  documentRecordId?: string;
  evidence: HermesBrainEvidenceRef[];
};

export type HermesBrainProfileClass =
  | "internal"
  | "external_client"
  | "supplier"
  | "partner"
  | "competitor"
  | "project_contact"
  | "unknown";

export type HermesBrainFactStatus =
  | "active"
  | "superseded"
  | "conflicted"
  | "retracted"
  | "proposed";

export type HermesBrainRelationshipType =
  | "works_for"
  | "contact_for"
  | "client_for"
  | "supplier_for"
  | "partner_for"
  | "owns"
  | "authored"
  | "mentions"
  | "defines_requirement"
  | "scores"
  | "shapes"
  | "applies_to"
  | "depicts"
  | "belongs_to_project"
  | "related_to"
  | "supersedes"
  | "conflicts_with";

export type HermesBrainPathRef = {
  path: string;
  vaultSlug?: string;
  visibility?: HermesBrainVisibility;
  anchor?: string;
};

export type HermesBrainEvidenceRef = HermesBrainPathRef & {
  kind: HermesBrainEvidenceKind;
  quote?: string;
  page?: number;
  section?: string;
  confidence?: HermesBrainConfidence;
};

export type HermesBrainRecordBase = {
  id: string;
  vaultSlug: string;
  visibility: HermesBrainVisibility;
  createdAt: string;
  updatedAt: string;
  sourceRunId?: string;
};

export type HermesBrainDocumentRecord = HermesBrainRecordBase & {
  kind: "document";
  sourcePath: string;
  sourceSha256?: string;
  assetRole: VaultAssetRole;
  title?: string;
  summary?: string;
  extractedPath?: string;
  segmentPath?: string;
  extractionMapPath?: string;
  templatePath?: string;
  scoringPath?: string;
  brandingPath?: string;
  entityIds: string[];
  factIds: string[];
  relationshipIds: string[];
  evidence: HermesBrainEvidenceRef[];
};

export type HermesBrainEntityRecord = HermesBrainRecordBase & {
  kind: HermesBrainEntityKind;
  canonicalName: string;
  aliases: string[];
  profileClass?: HermesBrainProfileClass;
  summary?: string;
  attributes: Record<string, string | number | boolean | string[] | null>;
  evidence: HermesBrainEvidenceRef[];
  confidence: HermesBrainConfidence;
};

export type HermesBrainFactRecord = HermesBrainRecordBase & {
  statement: string;
  subjectEntityIds: string[];
  predicate?: string;
  objectEntityIds?: string[];
  objectValue?: string | number | boolean | null;
  status: HermesBrainFactStatus;
  tags: string[];
  conflictGroupId?: string;
  validFrom?: string;
  validUntil?: string;
  evidence: HermesBrainEvidenceRef[];
  confidence: HermesBrainConfidence;
};

export type HermesBrainRelationshipRecord = HermesBrainRecordBase & {
  fromEntityId: string;
  type: HermesBrainRelationshipType;
  toEntityId?: string;
  toValue?: string;
  status: HermesBrainFactStatus;
  evidence: HermesBrainEvidenceRef[];
  confidence: HermesBrainConfidence;
};

export type HermesBrainPersonProfileRecord = HermesBrainEntityRecord & {
  kind: "person";
  profileClass: HermesBrainProfileClass;
  companyEntityIds: string[];
  roleTitles: string[];
  emails: string[];
  phones: string[];
  projectEntityIds: string[];
  cvEvidence: HermesBrainEvidenceRef[];
};

export type HermesBrainCompanyProfileRecord = HermesBrainEntityRecord & {
  kind: "company";
  profileClass: HermesBrainProfileClass;
  domains: string[];
  peopleEntityIds: string[];
  projectEntityIds: string[];
};

export type HermesBrainRetrievalLane =
  | "router"
  | "exact"
  | "semantic"
  | "graph"
  | "document"
  | "specialist"
  | "org_global";

export type HermesBrainQueryClass =
  | "simple_lookup"
  | "entity_question"
  | "project_question"
  | "comparison"
  | "creation"
  | "client_profile"
  | "global_company"
  | "conflict_check";

export type HermesBrainCoverageRequirement =
  | "read_router"
  | "search_aliases"
  | "read_profiles"
  | "read_entity_notes"
  | "read_evidence_sources"
  | "check_scoring"
  | "check_templates"
  | "check_branding"
  | "check_org_global"
  | "check_conflicts";

export type HermesBrainRetrievalPlan = {
  query: string;
  queryClass: HermesBrainQueryClass;
  lanes: HermesBrainRetrievalLane[];
  requiredChecks: HermesBrainCoverageRequirement[];
  exactTerms: string[];
  entityHints: string[];
  mustRead: HermesBrainPathRef[];
};

export type HermesBrainRetrievalRouterDocument = {
  documentRecordId: string;
  sourcePath: string;
  sourceName: string;
  assetRole: VaultAssetRole;
  updatedAt: string;
  lanes: HermesBrainRetrievalLane[];
  primaryPaths: HermesBrainPathRef[];
  specialistPaths: HermesBrainPathRef[];
  evidencePaths: HermesBrainPathRef[];
  reason: string;
};

export type HermesBrainRetrievalRouter = {
  schemaVersion: 1;
  vaultSlug: string;
  visibility: HermesBrainVisibility;
  generatedAt: string;
  mustReadFirst: HermesBrainPathRef[];
  documents: HermesBrainRetrievalRouterDocument[];
  byAssetRole: Partial<Record<VaultAssetRole, string[]>>;
  notes: string[];
};

export type HermesBrainCoverageReport = {
  plan: HermesBrainRetrievalPlan;
  completedChecks: HermesBrainCoverageRequirement[];
  missingChecks: HermesBrainCoverageRequirement[];
  evidenceRead: HermesBrainEvidenceRef[];
  canAnswer: boolean;
  reason?: string;
};

export type HermesBrainManifest = {
  schemaVersion: 1;
  vaultSlug: string;
  visibility: HermesBrainVisibility;
  generatedAt: string;
  sourceRuns: {
    runId: string;
    sourcePath: string;
    assetRole: VaultAssetRole;
    sourceSha256?: string;
    documentRecordId?: string;
    outputPaths: string[];
    completedAt?: string;
  }[];
};
