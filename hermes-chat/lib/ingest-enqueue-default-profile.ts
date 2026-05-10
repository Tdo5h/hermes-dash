import type { IngestSourceProfile } from "@/lib/shared-ingest-job-store";

/** Set per Chat container: `main` (default), `bt_user1`, or `bt_user2` (business-test). */
export function getIngestEnqueueDefaultProfile(): IngestSourceProfile {
  const raw = process.env.INGEST_ENQUEUE_DEFAULT_PROFILE?.trim();
  if (raw === "bt_user1" || raw === "bt_user2" || raw === "main") {
    return raw;
  }
  return "main";
}
