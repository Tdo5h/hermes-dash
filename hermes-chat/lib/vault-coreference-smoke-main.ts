/**
 * CLI entry for smoke-testing coreference rebuild (paths resolved via tsconfig `@/*`).
 *
 * Usage from hermes-chat/:  
 *   node --import tsx ./lib/vault-coreference-smoke-main.ts <vaultAbsDir> <slug>
 */

import path from "path";
import { runVaultCoreferencePass } from "@/lib/vault-coreference-pass";

async function main(): Promise<void> {
  const vaultAbs = process.argv[2];
  const slug = process.argv[3];
  if (!vaultAbs?.trim() || !slug?.trim()) {
    console.error(
      "Usage: node --import tsx ./lib/vault-coreference-smoke-main.ts <vaultAbsDir> <slug>"
    );
    process.exit(2);
  }
  const doc = await runVaultCoreferencePass({
    vaultRootAbs: path.resolve(vaultAbs.trim()),
    vaultSlug: slug.trim(),
  });
  if (!doc) {
    console.error("Pass returned null (missing vault dir?)");
    process.exit(1);
  }
  const n = doc.topics.length;
  const withWiki = doc.topics.filter((t) =>
    t.mentions.some((m) => m.kind === "wiki")
  ).length;
  console.log(
    JSON.stringify(
      {
        ok: true,
        topics: n,
        topicsWithWikiMentions: withWiki,
        sample_ids: doc.topics.slice(0, 5).map((t) => t.canonical_id),
      },
      null,
      2
    )
  );
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
