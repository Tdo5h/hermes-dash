"use client";

import { FormEvent, useState } from "react";

type WebsiteIngestResponse = {
  ok?: boolean;
  error?: string;
  hint?: string;
  orgSlug?: string;
  orgLibraryCreated?: boolean;
  manualContext?: boolean;
  fileName?: string;
  pagesCaptured?: number;
  internalLinks?: number;
  externalLinks?: number;
  ingestJobIds?: string[];
  skipped?: { url: string; reason: string }[];
};

export default function CompanySetupPage() {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [fallbackText, setFallbackText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WebsiteIngestResponse | null>(null);
  const showFallback = Boolean(
    fallbackText.trim() || (result?.error && (result.hint || result.skipped?.length))
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = websiteUrl.trim();
    if (!url || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/org/website-ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          companyName: companyName.trim() || undefined,
          maxPages: 12,
          fallbackText: fallbackText.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as WebsiteIngestResponse;
      setResult(data.ok ? data : { ...data, error: data.error || `Request failed (${res.status})` });
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Website ingest failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="main-chat-depth flex min-h-0 flex-1 items-center justify-center bg-[var(--sidebar-depth-canvas)] px-4 py-6 text-[var(--foreground)]">
      <section className="neu-raised w-full max-w-[520px] rounded-lg p-5">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
            Hermes setup
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
            Company website
          </h1>
          <p className="mt-2 text-sm leading-5 text-[var(--muted-foreground)]">
            Add the public company site to the organization brain.
          </p>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">
              Company name
            </span>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Optional"
              className="neu-inset-input h-11 w-full rounded-md px-3 text-sm text-[var(--foreground)] outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">
              Website URL
            </span>
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.co.nz"
              inputMode="url"
              className="neu-inset-input h-11 w-full rounded-md px-3 text-sm text-[var(--foreground)] outline-none"
            />
          </label>

          {showFallback ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Website text fallback
              </span>
              <textarea
                value={fallbackText}
                onChange={(e) => setFallbackText(e.target.value)}
                placeholder="Optional. Paste public website text here if the site blocks Hermes from reading it."
                className="neu-inset-input min-h-28 w-full resize-none rounded-md px-3 py-2 text-sm text-[var(--foreground)] outline-none"
              />
            </label>
          ) : null}

          <button
            type="submit"
            disabled={busy || !websiteUrl.trim()}
            className="neu-raised-active h-11 w-full rounded-md px-4 text-sm font-semibold text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? "Reading website..."
              : fallbackText.trim()
                ? "Add pasted text to Hermes brain"
                : "Add to Hermes brain"}
          </button>
        </form>

        {result ? (
          <div className="neu-recessed mt-4 rounded-md p-3 text-sm">
            {result.ok ? (
              <div className="space-y-1 text-[var(--muted-foreground)]">
                <p className="font-medium text-[var(--foreground)]">Website added.</p>
                <p>Vault: {result.orgSlug}</p>
                <p>
                  {result.manualContext
                    ? "Used pasted website text"
                    : `Pages captured: ${result.pagesCaptured ?? 0}`}
                </p>
                <p>Source: {result.fileName}</p>
                <p>Ingest jobs: {result.ingestJobIds?.length ?? 0}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-destructive">{result.error}</p>
                {result.hint ? (
                  <p className="text-[var(--muted-foreground)]">{result.hint}</p>
                ) : null}
                {result.skipped?.length ? (
                  <div className="space-y-1 text-xs text-[var(--muted-foreground)]">
                    {result.skipped.slice(0, 3).map((s) => (
                      <p key={`${s.url}-${s.reason}`}>{s.reason}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
