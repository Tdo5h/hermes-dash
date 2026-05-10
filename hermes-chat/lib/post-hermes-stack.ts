/**
 * Client-side POST to `/api/hermes/stack` (same shape as Model routing Save &amp; apply).
 * Requires HERMES_ALLOW_STACK_MODEL_EDITS on the server.
 */
export async function postHermesStackActive(args: {
  presetBundles: Record<string, unknown>;
  active: string;
}): Promise<void> {
  const r = await fetch("/api/hermes/stack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      presets: args.presetBundles,
      active: args.active,
      applyActivePreset: true,
      reload: true,
    }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    error?: string;
    data?: { ok?: boolean; error?: string };
  };
  if (!r.ok) {
    const gw = j.data;
    const err =
      (typeof gw === "object" && gw && "error" in gw && (gw as { error?: string }).error) ||
      j.error;
    throw new Error(err || `HTTP ${r.status}`);
  }
  if (j.data && typeof j.data === "object" && (j.data as { ok?: boolean }).ok === false) {
    const e = (j.data as { error?: string }).error;
    if (e) throw new Error(e);
  }
}
