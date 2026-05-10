import { canonicalActivityLabelMatch } from "@/lib/hermes-sse-stream";

const ORB_FALLBACK_MAX = 48;

function isGenericIdle(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  const k = t.toLowerCase().replace(/…/g, "...");
  return k === "thinking" || k === "working..." || k === "working" || k === "working…";
}

export function shortThinkingLabel(raw: string): string {
  const s = raw.trim();
  if (!s) return "Working…";
  const lower = s.toLowerCase();
  if (lower.includes("search") && lower.includes("web")) return "Searching the web";
  if (lower.includes("web_extract") || (lower.includes("read") && lower.includes("page"))) return "Reading page";
  if (lower.includes("browser") || lower.includes("brows")) return "Browsing";
  if (lower.includes("terminal") || lower.includes("command")) return "Running command";
  if (lower.includes("execute_code") || lower.includes("running code")) return "Running code";
  if (lower.includes("write_file") || lower.includes("writing file")) return "Writing file";
  if (lower.includes("read_file") || lower.includes("reading file")) return "Reading file";
  if (lower.includes("search_files")) return "Searching files";
  if (lower.includes("memory")) return "Updating memory";
  if (lower.includes("vision") || lower.includes("analyzing image")) return "Analyzing image";
  if (lower.includes("image_edit") || lower.includes("editing image")) return "Editing image";
  if (lower.includes("image_generate") || lower.includes("generating image")) return "Generating image";
  if (lower.includes("delegate")) return "Delegating task";
  if (lower.includes("skills_list") || lower.includes("listing skills")) return "Listing skills";
  if (lower.includes("skill_view") || lower === "skill view") return "Reading a skill";
  if (lower.includes("skill_manage") || lower.includes("updating skills")) return "Updating skills";
  if (lower.includes("mcp")) return "Calling tool";
  if (lower.includes("writing reply") || lower.includes("composing") || (lower.includes("reply") && lower.includes("writing"))) return "Writing reply";
  if (lower === "thinking" || lower.startsWith("thinking")) return "Thinking";
  if (s.length > 48) return `${s.slice(0, 45)}…`;
  return s;
}

export function compactThinkingSummary(statusText: string): string {
  const raw = statusText.trim();
  if (isGenericIdle(raw)) return "Thinking";
  const fromRaw = canonicalActivityLabelMatch(raw);
  if (fromRaw) return fromRaw;
  const short = shortThinkingLabel(statusText);
  if (isGenericIdle(short)) return "Thinking";
  const fromShort = canonicalActivityLabelMatch(short);
  if (fromShort) return fromShort;
  const shortNorm = short.replace(/\s+/g, " ").trim();
  if (shortNorm.length <= ORB_FALLBACK_MAX) return shortNorm;
  return `${shortNorm.slice(0, ORB_FALLBACK_MAX - 1)}…`;
}
