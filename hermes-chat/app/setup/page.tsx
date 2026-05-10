import Link from "next/link";

import { getHermesSetupStatus, type SetupCheck } from "@/lib/setup-status";

export const dynamic = "force-dynamic";

function StatusCard({ check }: { check: SetupCheck }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{check.label}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.links?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {check.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <span
          className={[
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            check.ok
              ? "bg-emerald-500/15 text-emerald-300"
              : check.optional
                ? "bg-amber-500/15 text-amber-300"
                : "bg-destructive/15 text-destructive",
          ].join(" ")}
        >
          {check.ok ? "Ready" : check.optional ? "Optional" : "Needs setup"}
        </span>
      </div>
    </section>
  );
}

export default async function SetupPage() {
  const status = await getHermesSetupStatus();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-5 py-8 sm:py-12">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          HermesChat setup
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Connect Hermes to Codex / ChatGPT
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          HermesChat runs through Hermes. This public build is tested against
          OpenAI Codex / ChatGPT. OpenRouter is optional for extra model routing;
          Deepgram only controls voice input and read-aloud.
        </p>
      </div>

      <div className="grid gap-3">
        <StatusCard check={status.gateway} />
        <StatusCard check={status.codex} />
        <StatusCard check={status.deepgram} />
        <StatusCard check={status.openrouter} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Other provider logins</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Hermes may show Anthropic, Claude Code, Nous, Qwen, and MiniMax login
          options in the dashboard. They are not the supported first-run gate for
          this HermesChat build yet, because chat, Create, images, and web-view
          workflows are tested end to end with Codex / ChatGPT first.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Next step</h2>
        {status.ready ? (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Hermes is connected. You can use chat and Create now.
          </p>
        ) : (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Open the Hermes dashboard, connect OpenAI Codex with your ChatGPT
            subscription, then check again.
          </p>
        )}

        {!status.ready && status.dashboardUrl ? (
          <a
            href={status.dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Open Hermes dashboard
          </a>
        ) : null}

        {!status.ready && !status.dashboardUrl ? (
          <div className="mt-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Dashboard URL is not configured.</p>
            <p className="mt-1">
              Use an SSH tunnel from your computer or PC, then open the local
              dashboard:
            </p>
            <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs text-foreground">
              ssh -L 9119:127.0.0.1:9119 root@YOUR_VPS_IP
              {"\n"}http://localhost:9119
            </pre>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/setup"
            className="inline-flex rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground"
          >
            Check again
          </Link>
          <Link
            href="/chat"
            className={[
              "inline-flex rounded-md border border-border px-4 py-2 text-sm font-semibold",
              status.ready
                ? "text-foreground"
                : "pointer-events-none opacity-50",
            ].join(" ")}
            aria-disabled={!status.ready}
          >
            Open HermesChat
          </Link>
        </div>
      </div>
    </main>
  );
}
