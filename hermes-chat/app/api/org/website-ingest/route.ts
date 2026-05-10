import { getIngestEnqueueDefaultProfile } from "@/lib/ingest-enqueue-default-profile";
import {
  recordHermesBrainIngestRun,
  recordHermesBrainWebsiteCrawl,
} from "@/lib/hermes-brain-ingest";
import { getOrgGlobalSlug } from "@/lib/org-global-slug";
import {
  companyWebsiteCrawlToMarkdown,
  companyWebsiteSourceName,
  crawlCompanyWebsite,
} from "@/lib/org-website-crawl";
import { getProjectVaultConfigError } from "@/lib/project-paths";
import { ensureProjectSlug, readProject, saveProjectFile } from "@/lib/project-service";
import { enqueueSharedIngestJob } from "@/lib/shared-ingest-job-store";

export const dynamic = "force-dynamic";

type WebsiteIngestBody = {
  url?: unknown;
  companyName?: unknown;
  maxPages?: unknown;
  respectRobots?: unknown;
  fallbackText?: unknown;
};

function numberOrUndefined(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function noPagesError(skipped: { url: string; reason: string }[]): {
  error: string;
  hint?: string;
} {
  const firstReason = skipped[0]?.reason;
  if (firstReason?.toLowerCase().includes("cloudflare challenge")) {
    return {
      error: firstReason,
      hint:
        "The site is public, but its protection is challenging server readers. Paste the public page text in the fallback box, or allow the Hermes VPS IP in that site's security rules.",
    };
  }
  return {
    error:
      firstReason ? `No pages were captured. First skipped reason: ${firstReason}` : "No pages were captured from that website.",
  };
}

function manualCompanyWebsiteTextToMarkdown(params: {
  url: string;
  companyName: string | null;
  text: string;
}): string {
  const now = new Date().toISOString();
  return [
    "---",
    "hermes_ingest_kind: company_website_manual_context",
    `website_url: ${JSON.stringify(params.url)}`,
    `company_name: ${JSON.stringify(params.companyName || "")}`,
    `captured_at: ${JSON.stringify(now)}`,
    "---",
    "",
    "# Company website context",
    "",
    params.companyName ? `Company: ${params.companyName}` : "Company: _not supplied_",
    `Website: ${params.url}`,
    "Capture method: user-pasted public website text",
    "",
    "## What Hermes should learn",
    "",
    "- Treat this as public organization-level company context.",
    "- Extract official names, services, products, locations, industries, claims, values, links, and contact/profile clues.",
    "- Update org-global company profile, relevant people/client lists, `branding/BRAND_KIT.md`, `wiki/entities/companies/`, and Hermes Brain records when supported.",
    "- Keep all facts source-backed to this pasted public website text and the website URL.",
    "",
    "## Pasted website text",
    "",
    params.text,
    "",
  ].join("\n");
}

export async function POST(req: Request) {
  const cfgErr = getProjectVaultConfigError();
  if (cfgErr) {
    return Response.json({ error: cfgErr }, { status: 503 });
  }

  let body: WebsiteIngestBody;
  try {
    body = (await req.json()) as WebsiteIngestBody;
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  const companyName =
    typeof body.companyName === "string" && body.companyName.trim()
      ? body.companyName.trim()
      : null;
  const fallbackText =
    typeof body.fallbackText === "string" && body.fallbackText.trim().length >= 40
      ? body.fallbackText.trim()
      : "";
  const orgSlug = getOrgGlobalSlug();
  let project = await readProject(orgSlug);
  let orgLibraryCreated = false;
  if (project && project.visibility !== "shared") {
    return Response.json(
      { error: `Organization library '${orgSlug}' must be a shared vault.` },
      { status: 409 }
    );
  }

  try {
    const crawl = await crawlCompanyWebsite(url, {
      maxPages: numberOrUndefined(body.maxPages),
      respectRobots: body.respectRobots !== false,
    });
    if (crawl.pages.length === 0) {
      if (fallbackText) {
        if (!project) {
          project = await ensureProjectSlug(orgSlug, "Organization Library", {
            visibility: "shared",
          });
          orgLibraryCreated = true;
        }
        const md = manualCompanyWebsiteTextToMarkdown({
          url: crawl.startUrl,
          companyName,
          text: fallbackText,
        });
        const saved = await saveProjectFile(
          orgSlug,
          companyWebsiteSourceName(crawl.startUrl).replace(
            "company-website-",
            "company-website-manual-"
          ),
          Buffer.from(md, "utf8"),
          { assetRole: "org_global" }
        );
        let brainRecord:
          | Awaited<ReturnType<typeof recordHermesBrainIngestRun>>
          | null = null;
        try {
          brainRecord = await recordHermesBrainIngestRun({
            projectSlug: orgSlug,
            visibility: project.visibility,
            fileName: saved.fileName,
            relativePath: saved.relativePath,
            assetRole: "org_global",
            completedAt: new Date().toISOString(),
            summary: `Captured pasted public website context for ${
              companyName || crawl.origin
            } after automated crawling was blocked.`,
          });
        } catch (brainErr: unknown) {
          console.error("[website-ingest] manual brain record failed:", brainErr);
        }

        const ingestJobIds: string[] = [];
        if (!saved.skippedWrite) {
          const common = {
            projectSlug: orgSlug,
            relativePath: saved.relativePath,
            fileName: saved.fileName,
            ingestSourceProfile: getIngestEnqueueDefaultProfile(),
            mimeType: "text/markdown",
            duplicate: saved.duplicate,
          };
          const orgJob = await enqueueSharedIngestJob({
            ...common,
            assetRole: "org_global",
          });
          ingestJobIds.push(orgJob.jobId);

          const brandJob = await enqueueSharedIngestJob({
            ...common,
            assetRole: "company_branding",
          });
          ingestJobIds.push(brandJob.jobId);
        }

        return Response.json({
          ok: true,
          orgSlug,
          orgLibraryCreated,
          manualContext: true,
          fileName: saved.fileName,
          relativePath: saved.relativePath,
          pagesCaptured: 0,
          internalLinks: crawl.discoveredInternalLinks.length,
          externalLinks: crawl.discoveredExternalLinks.length,
          skipped: crawl.skipped,
          ingestJobIds,
          brainRecorded: brainRecord != null,
          ...(brainRecord
            ? {
                brainDocumentRecordId: brainRecord.documentRecordId,
                brainRouterPath: brainRecord.routerPath,
              }
            : {}),
        });
      }
      const msg = noPagesError(crawl.skipped);
      return Response.json(
        {
          ...msg,
          skipped: crawl.skipped,
        },
        { status: 422 }
      );
    }

    const md = companyWebsiteCrawlToMarkdown(crawl, { companyName });
    if (!project) {
      project = await ensureProjectSlug(orgSlug, "Organization Library", {
        visibility: "shared",
      });
      orgLibraryCreated = true;
    }
    const saved = await saveProjectFile(
      orgSlug,
      companyWebsiteSourceName(crawl.startUrl),
      Buffer.from(md, "utf8"),
      { assetRole: "org_global" }
    );
    let brainRecord:
      | Awaited<ReturnType<typeof recordHermesBrainWebsiteCrawl>>
      | null = null;
    try {
      brainRecord = await recordHermesBrainWebsiteCrawl({
        projectSlug: orgSlug,
        visibility: project.visibility,
        crawl,
        companyName,
        fileName: saved.fileName,
        relativePath: saved.relativePath,
        markdown: md,
      });
    } catch (brainErr: unknown) {
      console.error("[website-ingest] brain record failed:", brainErr);
    }

    const ingestJobIds: string[] = [];
    if (!saved.skippedWrite) {
      const common = {
        projectSlug: orgSlug,
        relativePath: saved.relativePath,
        fileName: saved.fileName,
        ingestSourceProfile: getIngestEnqueueDefaultProfile(),
        mimeType: "text/markdown",
        duplicate: saved.duplicate,
      };
      const orgJob = await enqueueSharedIngestJob({
        ...common,
        assetRole: "org_global",
      });
      ingestJobIds.push(orgJob.jobId);

      const brandJob = await enqueueSharedIngestJob({
        ...common,
        assetRole: "company_branding",
      });
      ingestJobIds.push(brandJob.jobId);
    }

    return Response.json({
      ok: true,
      orgSlug,
      orgLibraryCreated,
      fileName: saved.fileName,
      relativePath: saved.relativePath,
      pagesCaptured: crawl.pages.length,
      internalLinks: crawl.discoveredInternalLinks.length,
      externalLinks: crawl.discoveredExternalLinks.length,
      skipped: crawl.skipped,
      ingestJobIds,
      brainRecorded: brainRecord != null,
      ...(brainRecord
        ? {
            brainDocumentRecordId: brainRecord.documentRecordId,
            brainRouterPath: brainRecord.routerPath,
          }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Website ingest failed";
    return Response.json({ error: msg }, { status: 400 });
  }
}
