import path from "path";
import { readFile } from "fs/promises";
import { getHermesDataDir } from "@/lib/hermes-config";

export type HermesAutomation = {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  state: string | null;
  scheduleDisplay: string;
  scheduleExpr: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastDeliveryError: string | null;
  deliver: string | null;
  skills: string[];
  script: string | null;
  model: string | null;
  provider: string | null;
  baseUrl: string | null;
  createdAt: string | null;
  pausedAt: string | null;
  pausedReason: string | null;
  repeatCompleted: number | null;
  repeatTimes: number | null;
  detailMarkdown: string;
};

type RawJob = {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  enabled?: unknown;
  state?: unknown;
  schedule_display?: unknown;
  schedule?: { display?: unknown; expr?: unknown };
  next_run_at?: unknown;
  last_run_at?: unknown;
  last_status?: unknown;
  last_error?: unknown;
  last_delivery_error?: unknown;
  deliver?: unknown;
  skills?: unknown;
  skill?: unknown;
  script?: unknown;
  model?: unknown;
  provider?: unknown;
  base_url?: unknown;
  created_at?: unknown;
  paused_at?: unknown;
  paused_reason?: unknown;
  repeat?: { completed?: unknown; times?: unknown };
};

function isSystemAutomation(job: HermesAutomation): boolean {
  const name = job.name.trim().toLowerCase();
  const prompt = job.prompt.trim().toLowerCase();
  return (
    name === "heartbeat" ||
    prompt === "keep-alive only. reply with exactly one line: heartbeat_ok" ||
    prompt.includes("heartbeat_ok")
  );
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toSkills(v: unknown, single: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asString(item);
      if (s) out.add(s);
    }
  }
  const one = asString(single);
  if (one) out.add(one);
  return [...out];
}

async function readCronScript(root: string, script: string | null): Promise<string | null> {
  if (!script) return null;
  const safeName = path.basename(script);
  if (!safeName || safeName !== script) return null;
  try {
    return await readFile(path.join(root, "home", "cron_scripts", safeName), "utf-8");
  } catch {
    return null;
  }
}

function codeFenceLang(script: string | null): string {
  if (!script) return "";
  if (script.endsWith(".py")) return "python";
  if (script.endsWith(".sh")) return "bash";
  if (script.endsWith(".js") || script.endsWith(".mjs")) return "javascript";
  return "";
}

function automationMarkdown(job: Omit<HermesAutomation, "detailMarkdown">, scriptBody: string | null): string {
  const lines: string[] = [
    `# ${job.name}`,
    "",
    "This automation is stored as a Hermes scheduler job. There is not a separate automation `SKILL.md`; this is the full readable job definition Hermes runs from.",
    "",
    "## Schedule",
    `- **State:** ${job.enabled ? "On" : "Paused"}${job.state ? ` (${job.state})` : ""}`,
    `- **Runs:** ${job.scheduleDisplay}`,
    `- **Cron expression:** ${job.scheduleExpr || "Not set"}`,
    `- **Next run:** ${job.nextRunAt || "Not scheduled"}`,
    `- **Last run:** ${job.lastRunAt || "Not yet"}`,
    `- **Last status:** ${job.lastStatus || "No status yet"}`,
    "",
    "## Task prompt",
    job.prompt || "_No prompt saved._",
    "",
    "## Delivery and runtime",
    `- **Delivery:** ${job.deliver || "Not set"}`,
    `- **Script:** ${job.script || "None"}`,
    `- **Model:** ${job.model || "Default"}`,
    `- **Provider:** ${job.provider || "Default"}`,
    `- **Base URL:** ${job.baseUrl || "Default"}`,
    `- **Skills:** ${job.skills.length ? job.skills.join(", ") : "None"}`,
    "",
    "## History",
    `- **Created:** ${job.createdAt || "Unknown"}`,
    `- **Repeat:** ${job.repeatCompleted ?? 0}${job.repeatTimes == null ? "" : ` / ${job.repeatTimes}`}`,
    `- **Paused at:** ${job.pausedAt || "Not paused"}`,
    `- **Paused reason:** ${job.pausedReason || "None"}`,
    `- **Last error:** ${job.lastError || "None"}`,
    `- **Last delivery error:** ${job.lastDeliveryError || "None"}`,
  ];
  if (job.script) {
    lines.push("", "## Script", scriptBody ? `\`\`\`${codeFenceLang(job.script)}\n${scriptBody.trimEnd()}\n\`\`\`` : "_Script file was named in the job, but could not be read._");
  }
  return lines.join("\n");
}

export async function listHermesAutomations(): Promise<{
  ok: true;
  automations: HermesAutomation[];
  updatedAt: string | null;
} | {
  ok: false;
  error: string;
}> {
  const root = getHermesDataDir();
  if (!root) return { ok: false, error: "HERMES_DATA_DIR is not configured." };

  try {
    const raw = await readFile(path.join(root, "cron", "jobs.json"), "utf-8");
    const parsed = JSON.parse(raw) as { jobs?: RawJob[]; updated_at?: unknown };
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const automations = (await Promise.all(jobs
      .map(async (j): Promise<HermesAutomation | null> => {
        const id = asString(j.id);
        if (!id) return null;
        const name = asString(j.name) || `Automation ${id.slice(0, 6)}`;
        const scheduleExpr = asString(j.schedule?.expr);
        const scheduleDisplay =
          asString(j.schedule_display) ||
          asString(j.schedule?.display) ||
          scheduleExpr ||
          "Manual";
        const script = asString(j.script);
        const base: Omit<HermesAutomation, "detailMarkdown"> = {
          id,
          name,
          prompt: asString(j.prompt) || "",
          enabled: j.enabled !== false,
          state: asString(j.state),
          scheduleDisplay,
          scheduleExpr,
          nextRunAt: asString(j.next_run_at),
          lastRunAt: asString(j.last_run_at),
          lastStatus: asString(j.last_status),
          lastError: asString(j.last_error),
          lastDeliveryError: asString(j.last_delivery_error),
          deliver: asString(j.deliver),
          skills: toSkills(j.skills, j.skill),
          script,
          model: asString(j.model),
          provider: asString(j.provider),
          baseUrl: asString(j.base_url),
          createdAt: asString(j.created_at),
          pausedAt: asString(j.paused_at),
          pausedReason: asString(j.paused_reason),
          repeatCompleted: asNumber(j.repeat?.completed),
          repeatTimes: asNumber(j.repeat?.times),
        };
        const scriptBody = await readCronScript(root, script);
        return { ...base, detailMarkdown: automationMarkdown(base, scriptBody) };
      })))
      .filter((j): j is HermesAutomation => Boolean(j))
      .filter((j) => !isSystemAutomation(j))
      .sort((a, b) => {
        const at = Date.parse(a.nextRunAt || "") || 0;
        const bt = Date.parse(b.nextRunAt || "") || 0;
        return at - bt;
      });

    return {
      ok: true,
      automations,
      updatedAt: asString(parsed.updated_at),
    };
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { ok: true, automations: [], updatedAt: null };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Could not read Hermes automations: ${msg}` };
  }
}
