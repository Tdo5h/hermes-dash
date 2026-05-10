import Link from "next/link";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  PlusIcon,
} from "lucide-react";
import { AutomationCard } from "@/components/AutomationCard";
import { SettingsCogButton } from "@/components/SettingsCogButton";
import { listHermesAutomations } from "@/lib/hermes-automations";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const result = await listHermesAutomations();

  return (
    <div className="main-chat-depth flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--sidebar-depth-canvas)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-sidebar-border/25 px-3 py-2">
        <Link
          href="/chat"
          className="neu-raised rounded-lg p-1.5 text-muted-foreground hover:text-sidebar-foreground"
          aria-label="Back to chat"
          data-hermes-tip="Go back to the main Hermes chat."
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-medium tracking-tight">Automations</h1>
          <p className="text-[10px] text-muted-foreground">
            Background work Hermes can run on a schedule.
          </p>
        </div>
        <Link
          href="/chat/automations/new"
          className="neu-raised group inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-primary"
          data-hermes-tip="Create a scheduled Hermes task. Tell Hermes what to do, when to run it, and what kind of update you want back."
        >
          <PlusIcon className="size-4 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
          Create automation
        </Link>
        <SettingsCogButton className="shrink-0" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {!result.ok ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {result.error}
          </p>
        ) : result.automations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-sm">
              <CalendarClockIcon className="mx-auto size-8 text-sidebar-primary" />
              <h2 className="mt-3 text-base font-semibold">No automations yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create one when a useful Hermes task should happen on its own.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {result.automations.map((job) => (
              <AutomationCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
