/**
 * Reserved shared-wiki slug for organization-wide library uploads (`HERMES_ORG_GLOBAL_SLUG`).
 * In the browser, set `NEXT_PUBLIC_HERMES_ORG_GLOBAL_SLUG` to the same value so upload URLs match the server.
 */
export function getOrgGlobalSlug(): string {
  if (typeof window === "undefined") {
    const v = process.env.HERMES_ORG_GLOBAL_SLUG?.trim();
    if (v) return v;
  } else {
    const v = process.env.NEXT_PUBLIC_HERMES_ORG_GLOBAL_SLUG?.trim();
    if (v) return v;
  }
  return "org-global";
}
