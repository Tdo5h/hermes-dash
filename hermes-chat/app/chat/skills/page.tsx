import Link from "next/link";
import {
  ArrowLeftIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { SettingsCogButton } from "@/components/SettingsCogButton";
import { SkillCard } from "@/components/SkillCard";
import { listHermesUserSkills } from "@/lib/hermes-user-skills";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const result = await listHermesUserSkills();
  const visibleSkills = result.ok
    ? result.skills.filter((skill) => skill.state !== "archived" && skill.state !== "deleted")
    : [];

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
          <h1 className="text-sm font-medium tracking-tight">Skills</h1>
          <p className="text-[10px] text-muted-foreground">
            Reusable ways for Hermes to handle work you repeat.
          </p>
        </div>
        <Link
          href="/chat/skills/new"
          className="neu-raised group inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground hover:text-sidebar-primary"
          data-hermes-tip="Create a reusable skill for work you want Hermes to repeat well."
        >
          <PlusIcon className="size-4 text-muted-foreground transition-colors group-hover:text-sidebar-primary" />
          Create skill
        </Link>
        <SettingsCogButton className="shrink-0" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <section className="neu-raised mb-3 rounded-lg bg-[var(--sidebar-depth-canvas)] p-3">
          <div className="flex items-start gap-3">
            <span className="neu-raised flex size-9 shrink-0 items-center justify-center rounded-lg text-sidebar-primary">
              <ShieldCheckIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                Teach Hermes once. Reuse it whenever it fits.
              </h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                Skills are reusable instructions for work you do again and again. Create one for a process, lookup, writing style, or workflow, then ask Hermes to use it when that kind of task comes up.
              </p>
            </div>
          </div>
        </section>

        {!result.ok ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {result.error}
          </p>
        ) : visibleSkills.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-sm">
              <SparklesIcon className="mx-auto size-8 text-sidebar-primary" />
              <h2 className="mt-3 text-base font-semibold">No active skills yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create one when you want Hermes to remember a reusable way of working.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleSkills.map((skill) => (
              <SkillCard key={`${skill.source}:${skill.id}`} skill={skill} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
