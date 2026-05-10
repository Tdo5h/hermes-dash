import type { BuildEditSessionPayload } from "@/lib/builds-manifest";

/**
 * Injected as system preamble for /chat sessions created from Builds → Edit.
 * Tells the gateway agent to apply incremental changes to the existing published
 * app, not to scaffold a duplicate tree elsewhere.
 */
export function activeBuildEditSystemPrompt(
  meta: BuildEditSessionPayload
): string {
  const hasLocalApp =
    Boolean(meta.gatewayAppDir) && Boolean(meta.appFolder);
  const lines: string[] = [
    "Build edit mode (mandatory):",
    `- This chat is for **editing an existing entry** in HermesChat **Builds** (build id: **\`${meta.buildId}\`**, display name: **${meta.name}**).`,
    "- **Do not** create a new mini-app in a new folder to duplicate this project. **Reuse** the on-disk app and manifest; apply **minimal, targeted** changes (read → patch) that satisfy the user’s request.",
    `- The published app opens at: ${meta.openUrl}`,
  ];

  if (hasLocalApp) {
    lines.push(
      `- The static site root on the **Hermes gateway** is: **\`${meta.gatewayAppDir}\`** (from manifest \`path\`). Use **read_file**, then edit with the smallest change set—**not** a full rewrite of every file unless the user asked for that.`,
      `- The Builds manifest (launcher metadata) is: **\`${meta.manifestPath}\`**. **read_file** it before/when changing **id**, **name**, **description**, or **path**/**url** for this entry.`,
      "- Update **manifest.json** only when the user changes metadata the manifest actually carries (e.g. rename, description, path/url). **Do not** rewrite the manifest for routine CSS/JS copy tweaks in the app folder."
    );
  } else {
    lines.push(
      "- This build is **URL-only** (no local **path** in the manifest on this service): there is **no** static tree under `/opt/data/builds/...` for this app in context. You may still **read_file** the manifest to adjust **name** / **description** / **url** for this `id` if the user wants launcher changes.",
      "- **Do not** invent a new folder under `/opt/data/builds/` for this `id` or duplicate the site from scratch. If they need new static files, say so and describe what the operator should add—or only change what the manifest can express."
    );
  }

  lines.push(
    "- Put explanations and any code worth reading **in the assistant message**; users do not browse raw server paths in the UI.",
    "- **Write verification (mandatory):** After **write_file** to any path under the builds tree, **read_file** the same path (or a quick **terminal** check) before telling the user the file was updated.",
    `- **Final edit reply:** include the whole-app Hermes viewer link exactly as [Open in Hermes](/chat/builds/open/${meta.buildId}) and include any changed user-facing files as \`/api/builds/file?id=${meta.buildId}&name=<relative-path-under-folder>\` links. Do **not** leave the user with only a raw static builds URL.`
  );

  return lines.join("\n");
}
