import type { CreativeStudioIntent } from "@/lib/creative-studio-session";

export type ComposerHelperScope = "chat" | "vault" | "builds";

export type ComposerHelperContext = {
  scope: ComposerHelperScope;
  threadHasMessages: boolean;
  hasImages: boolean;
};

export type OrbHelperContext =
  | { surface: "chat-empty" }
  | { surface: "vault-empty" }
  | { surface: "vault-ingest-idle" }
  | { surface: "builds-empty" }
  | { surface: "create"; intent: CreativeStudioIntent };

const CHAT_STARTERS = [
  "make this clearer",
  "compare the options",
  "give me the short version",
  "turn rough notes into a plan",
  "find the risks",
  "write a cleaner draft",
  "explain it simply",
  "suggest what to ask next",
  "make this more polished",
  "list the next steps",
  "help me decide",
  "rewrite this for a normal person",
  "make it shorter",
  "make it warmer",
  "make it sharper",
  "pull out the important bits",
] as const;

const CHAT_FOLLOWUPS = [
  "summarize where we landed",
  "turn this into next steps",
  "list what is still unclear",
  "make a decision log",
  "write the follow-up message",
  "challenge the plan",
  "simplify the answer",
  "make this more practical",
  "pull out action items",
  "give me three options",
  "turn this into a checklist",
  "find the weak spots",
] as const;

const VAULT_STARTERS = [
  "summarize what this vault knows",
  "find the missing pieces",
  "make a clear summary",
  "pull out key facts",
  "turn this into next steps",
  "compare what the files say",
  "list open questions",
  "make a quick reading guide",
  "find risks and assumptions",
  "explain this like I am new",
  "turn the notes into a clean answer",
  "find anything that conflicts",
  "make a glossary",
  "draft a message from this",
] as const;

const VAULT_FOLLOWUPS = [
  "check this against the vault",
  "cite the strongest support",
  "show what is still unknown",
  "turn this into a vault-backed brief",
  "compare the chat with the files",
  "make this answer more evidence-based",
  "list what to add next",
  "find contradictions",
  "make a short handover note",
  "create a practical checklist",
] as const;

const BUILD_STARTERS = [
  "make the layout cleaner",
  "improve the mobile view",
  "polish the buttons",
  "tighten the spacing",
  "make the copy sharper",
  "add a useful empty state",
  "simplify the screen",
  "make it feel more premium",
  "check accessibility",
  "make the interaction smoother",
  "reduce visual noise",
  "create a stronger first view",
] as const;

const BUILD_FOLLOWUPS = [
  "refine the last change",
  "fix the mobile awkward bits",
  "make this easier to scan",
  "polish the final details",
  "explain what changed",
  "check what might break",
  "make the edit less busy",
  "improve the call to action",
  "simplify without losing function",
  "prep a quick test list",
] as const;

const IMAGE_HELPERS = [
  "describe what is in this image",
  "pull out text and numbers",
  "use this as a style reference",
  "suggest how to improve it",
  "turn this into a clean brief",
  "match the mood in a new version",
  "find the useful details",
  "make layout ideas from this",
] as const;

const CREATE_HELPERS: Record<CreativeStudioIntent, readonly string[]> = {
  business_pdf: [
    "make a polished PDF brief",
    "turn notes into a clean document",
    "make it easier to read and revise",
  ],
  deck: [
    "make a slide deck with a clear story",
    "turn this into presentation bullets",
    "make the structure easier to follow",
  ],
  docx: [
    "create an editable document",
    "clean this into a reusable draft",
    "make the structure more professional",
  ],
  email: [
    "write an inbox-safe email",
    "create a subject and clean body copy",
    "make this easy to send",
  ],
  image: [
    "create a visual direction",
    "make an image from a sharp brief",
    "create a cleaner variation",
  ],
  motion: [
    "make a short motion concept",
    "turn this into animated frames",
    "create a clean video direction",
  ],
  web_app: [
    "build a useful one-page tool",
    "make a polished web experience",
    "create the first working version",
  ],
  hifi_html: [
    "make a high-fidelity HTML mockup",
    "create an interactive prototype",
    "make the screen feel finished",
  ],
  critique: [
    "review what is confusing",
    "find the fastest improvements",
    "explain what to change first",
  ],
  surprise: [
    "make something small and playful",
    "create a quick interactive idea",
    "surprise me, but keep it useful",
  ],
};

export function getComposerSuggestions(
  context: ComposerHelperContext
): readonly string[] {
  if (context.hasImages) return IMAGE_HELPERS;
  if (context.scope === "vault") {
    return context.threadHasMessages ? VAULT_FOLLOWUPS : VAULT_STARTERS;
  }
  if (context.scope === "builds") {
    return context.threadHasMessages ? BUILD_FOLLOWUPS : BUILD_STARTERS;
  }
  return context.threadHasMessages ? CHAT_FOLLOWUPS : CHAT_STARTERS;
}

export function getOrbHelper(context: OrbHelperContext): string {
  switch (context.surface) {
    case "chat-empty":
      return "Ask for a draft, a cleaner version, a comparison, a plan, or a simple explanation.";
    case "vault-empty":
      return "Ask about this vault or add files to sharpen answers. I'll work with what you give me.";
    case "vault-ingest-idle":
      return "Your vault is updating in the background. When it finishes, ask for a summary, gaps, risks, or next steps.";
    case "builds-empty":
      return "Published creations live here. Open, edit, download, archive, or start something new.";
    case "create":
      return CREATE_HELPERS[context.intent][0] ?? "create a clean first version";
  }
}

export function getCreateOrbHelpers(intent: CreativeStudioIntent): readonly string[] {
  return CREATE_HELPERS[intent];
}

export const VAULT_INGEST_IDLE_HELPERS = [
  "When this finishes, ask for the short version.",
  "Ask what changed, what matters, and what is missing.",
  "Turn the new material into next steps.",
  "Ask for risks, assumptions, or open questions.",
  "Ask for a clear summary from the vault.",
] as const;
