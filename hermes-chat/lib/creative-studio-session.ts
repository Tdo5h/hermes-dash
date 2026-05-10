/** HermesChat Create tab → new session metadata (stored on session row). */

import {
  parseCreateProductionBrief,
  type CreateProductionBrief,
} from "@/lib/create-production-types";
import { createSpecialistHarnessPrompt } from "@/lib/create-specialist-harness";
import type {
  CreateKanbanCleanupStatus,
  CreateKanbanSnapshot,
  CreateKanbanTask,
} from "@/lib/hermes-kanban";

export const CREATIVE_STUDIO_INTENTS = [
  "business_pdf",
  "deck",
  "docx",
  "email",
  "image",
  "motion",
  "web_app",
  "hifi_html",
  "critique",
  "surprise",
] as const;

export type CreativeStudioIntent = (typeof CREATIVE_STUDIO_INTENTS)[number];

export type CreativeStudioSessionPayload = {
  intent: CreativeStudioIntent;
  /** Optional one-line user hint from the intent dialog. */
  seedPrompt?: string;
  /** Structured Create request used by Hermes-native production adapters. */
  createBrief?: CreateProductionBrief;
  /** Optional workspace vault for brand/docs context (Create flow). */
  referenceVaultSlug?: string;
  referenceVaultName?: string;
  /** Hermes 0.13 Kanban board used as this Create chat's orchestration ledger. */
  kanbanBoardSlug?: string;
  kanbanBoardName?: string;
  kanbanRootTaskId?: string;
  kanbanTaskIds?: string[];
  /** Final Create board readout kept after the temporary Kanban board is deleted. */
  kanbanSnapshot?: CreateKanbanSnapshot;
  kanbanCleanedAt?: string;
  kanbanCleanupStatus?: CreateKanbanCleanupStatus;
  kanbanCleanupError?: string;
  /**
   * When set, this Create chat is grouped under the published app in the sidebar
   * (same bucket as edit chats). Set via POST /api/builds/attach-create-session.
   */
  publishedBuildId?: string;
  /** Denormalized manifest name for sidebar rows (optional). */
  publishedBuildName?: string;
};

const INTENT_LABEL: Record<CreativeStudioIntent, string> = {
  business_pdf: "Business document (PDF)",
  deck: "Slide deck",
  docx: "Document (DOCX)",
  email: "Email",
  image: "Image / visual",
  motion: "Video / motion",
  web_app: "Web app / landing",
  hifi_html: "Hi-fi HTML prototype",
  critique: "Design critique",
  surprise: "Up to you",
};

const OPEN_DESIGN_ROOT = "/opt/data/open-design";
const OPEN_DESIGN_SKILLS = `${OPEN_DESIGN_ROOT}/skills`;
const OPEN_DESIGN_DESIGN_SYSTEMS = `${OPEN_DESIGN_ROOT}/design-systems`;
const OPEN_DESIGN_PROMPT_TEMPLATES = `${OPEN_DESIGN_ROOT}/prompt-templates`;

/** Short Open Design routing hints for the gateway. */
const INTENT_REFERENCE_HINTS: Record<CreativeStudioIntent, string> = {
  business_pdf:
    "Open Design primary candidates usually include `finance-report`, `digital-eguide`, `pm-spec`, `invoice`, `meeting-notes`, `docs-page`, and `dashboard`; score them against the brief before choosing. For formal reports, tenders, or letters, the Hermes main skill `pdf-generation-pymupdf` is also a valid route when the Create brief selects or strongly implies it. Build print-ready HTML first when PDF is needed, then export PDF with the available gateway/export tooling.",
  deck:
    "Open Design deck candidates usually include `guizang-ppt`, `simple-deck`, `replit-deck`, `weekly-update`, and `html-ppt-*` skills; score deck structure, visual fit, and export reliability before choosing.",
  docx:
    "Open Design document candidates usually include `pm-spec`, `meeting-notes`, `eng-runbook`, `hr-onboarding`, `invoice`, `finance-report`, `docs-page`, and `digital-eguide`; create an editable source first, then produce DOCX when export tooling is available.",
  email:
    "Open Design email candidates must prioritize deliverability, native-mail paste safety, readable plain text, and predictable rendering over visual spectacle. Use light, text-first email patterns with critical styles inline; avoid dark full-bleed backgrounds, image-heavy layouts, base64/data images, protected image URLs, and cold-marketing defaults.",
  image:
    "Use Open Design only for art direction and composition scouting (`image-poster`, `social-carousel`, `magazine-poster`, and `prompt-templates/image` can help). The actual deliverable must be one bitmap from `image_edit` or `image_generate`, not an Open Design HTML/SVG substitute.",
  motion:
    "Open Design motion candidates currently include `hyperframes`, `motion-frames`, and `sprite-animation`. Treat motion as a storyboarded short, not a collage. Do not route to external text-to-video or audio generation providers unless a working provider has been explicitly configured; create inspectable HTML/CSS/JS motion source first and export MP4/GIF only when local tooling supports it.",
  web_app:
    "Open Design prototype candidates usually include `web-prototype`, `saas-landing`, `dashboard`, `pricing-page`, `docs-page`, `blog-post`, `mobile-app`, `mobile-onboarding`, and `gamified-app`; score output fit and design-system fit before choosing.",
  hifi_html:
    "Open Design HTML candidates usually include `web-prototype`, `saas-landing`, `dashboard`, `docs-page`, `mobile-app`, `social-carousel`, `magazine-poster`, and `html-ppt-*`; prefer the skill whose example/template best matches the requested surface.",
  critique:
    "Use Open Design `critique` and `tweaks` skills as the primary review loop; score the existing output against the user's brief and selected inputs.",
  surprise:
    "Run the Open Design router across all relevant skills and design systems, then choose the highest-scoring coherent direction.",
};

export function isCreativeStudioIntent(s: string): s is CreativeStudioIntent {
  return (CREATIVE_STUDIO_INTENTS as readonly string[]).includes(s);
}

export function parseCreativeStudioPayload(
  raw: unknown
): CreativeStudioSessionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const intentRaw = typeof o.intent === "string" ? o.intent.trim() : "";
  if (!isCreativeStudioIntent(intentRaw)) return null;
  const seed =
    typeof o.seedPrompt === "string" && o.seedPrompt.trim()
      ? o.seedPrompt.trim()
      : undefined;
  const publishedBuildId =
    typeof o.publishedBuildId === "string" && o.publishedBuildId.trim()
      ? o.publishedBuildId.trim()
      : undefined;
  const publishedBuildName =
    typeof o.publishedBuildName === "string" && o.publishedBuildName.trim()
      ? o.publishedBuildName.trim()
      : undefined;
  const referenceVaultSlug =
    typeof o.referenceVaultSlug === "string" && o.referenceVaultSlug.trim()
      ? o.referenceVaultSlug.trim()
      : undefined;
  const referenceVaultName =
    typeof o.referenceVaultName === "string" && o.referenceVaultName.trim()
      ? o.referenceVaultName.trim()
      : undefined;
  const kanbanBoardSlug =
    typeof o.kanbanBoardSlug === "string" && o.kanbanBoardSlug.trim()
      ? o.kanbanBoardSlug.trim()
      : undefined;
  const kanbanBoardName =
    typeof o.kanbanBoardName === "string" && o.kanbanBoardName.trim()
      ? o.kanbanBoardName.trim()
      : undefined;
  const kanbanRootTaskId =
    typeof o.kanbanRootTaskId === "string" && o.kanbanRootTaskId.trim()
      ? o.kanbanRootTaskId.trim()
      : undefined;
  const kanbanTaskIds = Array.isArray(o.kanbanTaskIds)
    ? o.kanbanTaskIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    : undefined;
  const kanbanSnapshot = parseCreateKanbanSnapshot(o.kanbanSnapshot);
  const kanbanCleanedAt =
    typeof o.kanbanCleanedAt === "string" && o.kanbanCleanedAt.trim()
      ? o.kanbanCleanedAt.trim()
      : undefined;
  const kanbanCleanupStatus = parseKanbanCleanupStatus(o.kanbanCleanupStatus);
  const kanbanCleanupError =
    typeof o.kanbanCleanupError === "string" && o.kanbanCleanupError.trim()
      ? o.kanbanCleanupError.trim()
      : undefined;
  const createBrief = parseCreateProductionBrief(o.createBrief);
  return {
    intent: intentRaw,
    ...(seed ? { seedPrompt: seed } : {}),
    ...(createBrief ? { createBrief } : {}),
    ...(referenceVaultSlug ? { referenceVaultSlug } : {}),
    ...(referenceVaultName ? { referenceVaultName } : {}),
    ...(kanbanBoardSlug ? { kanbanBoardSlug } : {}),
    ...(kanbanBoardName ? { kanbanBoardName } : {}),
    ...(kanbanRootTaskId ? { kanbanRootTaskId } : {}),
    ...(kanbanTaskIds && kanbanTaskIds.length > 0 ? { kanbanTaskIds } : {}),
    ...(kanbanSnapshot ? { kanbanSnapshot } : {}),
    ...(kanbanCleanedAt ? { kanbanCleanedAt } : {}),
    ...(kanbanCleanupStatus ? { kanbanCleanupStatus } : {}),
    ...(kanbanCleanupError ? { kanbanCleanupError } : {}),
    ...(publishedBuildId ? { publishedBuildId } : {}),
    ...(publishedBuildName ? { publishedBuildName } : {}),
  };
}

function parseKanbanCleanupStatus(raw: unknown): CreateKanbanCleanupStatus | undefined {
  if (raw !== "deleted" && raw !== "archived" && raw !== "skipped" && raw !== "failed") {
    return undefined;
  }
  return raw;
}

function parseCreateKanbanTask(raw: unknown): CreateKanbanTask | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : "";
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : "";
  const status = typeof o.status === "string" && o.status.trim() ? o.status.trim() : "";
  if (!id || !title || !status) return null;
  const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const nullableNum = (value: unknown): number | null | undefined =>
    value === null ? null : num(value);
  const nullableString = (value: unknown): string | null | undefined => {
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const s = value.trim();
    return s ? s : null;
  };
  return {
    id,
    title,
    status,
    ...(nullableString(o.body) !== undefined ? { body: nullableString(o.body) } : {}),
    ...(nullableString(o.assignee) !== undefined ? { assignee: nullableString(o.assignee) } : {}),
    ...(num(o.priority) !== undefined ? { priority: num(o.priority) } : {}),
    ...(num(o.created_at) !== undefined ? { created_at: num(o.created_at) } : {}),
    ...(nullableNum(o.started_at) !== undefined ? { started_at: nullableNum(o.started_at) } : {}),
    ...(nullableNum(o.completed_at) !== undefined ? { completed_at: nullableNum(o.completed_at) } : {}),
    ...(nullableString(o.result) !== undefined ? { result: nullableString(o.result) } : {}),
    ...(nullableString(o.latest_summary) !== undefined ? { latest_summary: nullableString(o.latest_summary) } : {}),
    ...(nullableString(o.last_failure_error) !== undefined ? { last_failure_error: nullableString(o.last_failure_error) } : {}),
    ...(nullableNum(o.worker_pid) !== undefined ? { worker_pid: nullableNum(o.worker_pid) } : {}),
    ...(nullableNum(o.current_run_id) !== undefined ? { current_run_id: nullableNum(o.current_run_id) } : {}),
  };
}

function parseCreateKanbanSnapshot(raw: unknown): CreateKanbanSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const boardSlug =
    typeof o.boardSlug === "string" && o.boardSlug.trim()
      ? o.boardSlug.trim()
      : undefined;
  if (!boardSlug) return undefined;
  const tasks = Array.isArray(o.tasks)
    ? o.tasks.map(parseCreateKanbanTask).filter(Boolean)
    : [];
  return {
    boardSlug,
    tasks: tasks as CreateKanbanTask[],
    ...(typeof o.cleanedAt === "string" && o.cleanedAt.trim()
      ? { cleanedAt: o.cleanedAt.trim() }
      : {}),
    ...(parseKanbanCleanupStatus(o.cleanupStatus)
      ? { cleanupStatus: parseKanbanCleanupStatus(o.cleanupStatus) }
      : {}),
  };
}

export function creativeStudioIntentLabel(intent: CreativeStudioIntent): string {
  return INTENT_LABEL[intent];
}

/** Strong starter line for the composer (combined with optional user hint). */
export function defaultSeedPromptForIntent(intent: CreativeStudioIntent): string {
  const m: Record<CreativeStudioIntent, string> = {
    business_pdf:
      "Create a document from my description using Open Design skill/design-system selection. For PDF, build print-ready HTML first, then export `document.pdf` when export tooling is available. Register shipped files in Builds and link the real files.",
    deck:
      "Create a deck from my description using the best-scoring Open Design deck skill and design system; publish to Builds when done.",
    docx:
      "Create an editable document from my description using the best-scoring Open Design document skill and design system. Produce DOCX when export tooling is available, and also ship a readable source or HTML fallback in Builds.",
    email:
      "Create an inbox-safe email from my description. Prioritize a sendable message that is unlikely to be treated as spam: honest subject options, preheader text, polished body copy, one clear CTA, light mobile-safe HTML with critical styles inline, no fragile image dependency, and a readable plain-text fallback. Publish an HTML preview to Builds when useful.",
    image:
      "Create one bitmap image or visual asset from my description. Use Open Design only to improve art direction/composition, then use the configured `image_gen` image model: call `image_edit` when reference/content/adaptable images are supplied, otherwise call `image_generate`. Do not create HTML/SVG/vector/web output as a substitute unless I explicitly ask for it. Final reply should show the generated image and only link the image file.",
    motion:
      "Create a short storyboarded motion piece from my description using the best-scoring Open Design motion skill. Keep the input set lean: one primary message, one style direction, one hero subject/asset, and 2-4 beats. Prefer inspectable HTML/CSS/JS frames/source first; export MP4/GIF only when available tooling supports it, and publish previews to Builds when useful.",
    web_app:
      "Create a web app or landing page from my description using the best-scoring Open Design skill and design system; publish to Builds when done.",
    hifi_html:
      "Build a single-file, high-fidelity interactive HTML prototype using the best-scoring Open Design skill and design system; publish to Builds when done.",
    critique:
      "Review the UI or design I describe using Open Design `critique` / `tweaks` patterns; give actionable fixes.",
    surprise:
      "You choose: a tiny game, a playful one-screen experiment, or a small interactive toy. Publish to Builds if it’s a web deliverable.",
  };
  return m[intent];
}

export function createCreativeStudioSessionLabel(
  payload: CreativeStudioSessionPayload
): string {
  return `Create: ${creativeStudioIntentLabel(payload.intent)}`;
}

const BUILDS_FILE_LINK_INSTRUCTION =
  "In your **final assistant message** after a successful publish, include a Hermes viewer link for the whole creation using exactly `[Open in Hermes](/chat/builds/open/<manifest-app-id>)`, then include markdown links for **each** user-facing file under that build (PDF, DOCX, HTML entrypoint, etc.) using exactly `[display-name](/api/builds/file?id=<manifest-app-id>&name=<relative-path-under-folder>)` where `<relative-path-under-folder>` is the path under the app folder (e.g. `document.pdf`, `index.html`, `export/report.docx`). HermesChat renders file links as **Download** and **Preview** cards for HTML/SVG/PDF/images. Do **not** leave the user with only a raw static URL such as the builds server URL; use the real `id` from `manifest.json`.";

const EMAIL_SAFE_CREATE_CONTRACT = [
  "- **Email deliverable contract:** treat `email.html` as the real sendable/pasteable email artifact, not a browser mockup or poster. `index.html` may be a nicer preview wrapper, but it must not be the only polished version.",
  "- **Required email files:** create `email.html`, `plain-text.txt`, and `subject-lines.txt` with the recommended subject and preheader. Add `index.html` only as a Builds preview/download wrapper when useful.",
  "- **Inbox-safe default:** deliverability and predictable rendering outrank visual spectacle. The default email should feel like a well-designed human message, not a web landing page, poster, or image-heavy campaign.",
  "- **Native email path:** Hermes may copy the rich HTML to the clipboard and open the user's normal mail app. Assume Apple Mail, Gmail, Outlook, or mobile mail may strip `<head>` CSS, remove images, rewrite dark mode, ignore media queries, and penalize suspicious HTML.",
  "- **Light theme default:** use a white or very light background with dark readable text. Do not create full dark-background emails, full-bleed hero art, gradient shells, or designs whose identity depends on background colour surviving.",
  "- **Inline first:** put critical layout, colour, background, spacing, border, typography, CTA, and image sizing styles inline on the exact elements. Do not rely on classes, CSS variables, external CSS, scripts, web fonts, or `<style>` blocks for the email to look right.",
  "- **Mobile width:** build mobile-first with outer wrappers at `width:100%; max-width:100%; margin:0;` and avoid fixed-only 600/640px shells. A centered desktop max-width wrapper is allowed only when the pasted email still fills a phone cleanly.",
  "- **Background survival:** add old-school `bgcolor` attributes on important `body`, `table`, and `td` elements as a fallback for mail clients that strip CSS. Prefer solid `background-color` values; do not rely on CSS gradients or background images for essential colour.",
  "- **Images:** avoid images by default for native-send emails. If images are explicitly needed, use at most one small supporting image in the preview/source, with real text carrying the message. Do not use base64/data images, protected Cloudflare Access URLs, external images recipients cannot fetch, background-image-only hero art, or screenshot emails.",
  "- **Links and spam risk:** use one primary link/CTA unless the user explicitly asks for a newsletter. Avoid clickbait, fake urgency, all caps, excessive punctuation, spammy sales phrasing, and 'cold drop' style copy. Write clear, permission-aware, human copy.",
  "- **Footer rules:** for promotional or bulk-style messages, include sender identity and a simple opt-out/unsubscribe or reply-based opt-out line. For one-to-one emails, keep the footer minimal and natural.",
  "- **Dark mode resistance:** for important surfaces and text, include explicit `background-color`, `color`, and `-webkit-text-fill-color` inline. Prefer simple solid backgrounds over CSS effects that mail clients often drop.",
  "- **Fallback quality:** keep important copy as real HTML text and include a readable plain-text fallback. If the design depends on an image, the email must still make sense with images blocked.",
].join("\n");

const MOTION_FOCUSED_CREATE_CONTRACT = [
  "- **Motion deliverable contract:** treat motion as a storyboarded short, not a collage of every selected input. The product is a short inspectable HTML/CSS/JS motion build or a verified frame/video package with clear pacing.",
  "- **Input discipline:** use the main prompt as the brief. Use at most one theme/style image as visual direction and at most one include/use image as a hero asset unless the user explicitly asks otherwise. People, templates, vaults, files, DNA, and source text are planning context; do not surface all of them as on-screen content.",
  "- **Before coding:** write a private motion recipe: format/aspect ratio, total duration or loop length, 2-4 beats, one primary message, one hero subject/object, palette, type scale, movement vocabulary, and asset roles.",
  "- **Scene budget:** default to 6-12 seconds, 2-4 scenes/beats, one new idea per beat, no more than 5-6 visible elements at once, at least 15% empty space, and no more than one camera move or transition idea per beat.",
  "- **Text budget:** captions and titles should be short; target 3-8 words per beat. Do not animate paragraphs or dense source copy. If exact wording is supplied, use only the necessary marked line(s) on screen.",
  "- **Motion restraint:** use progressive disclosure, opacity layering, consistent color meanings, and a small transition vocabulary. Avoid many simultaneous loops, random decorative effects, tiny text, and constantly moving everything.",
  "- **Implementation default:** ship inspectable `index.html` with CSS/JS animation, stable stage dimensions, responsive 16:9/9:16 handling when needed, play/replay or loop behavior, and export MP4/GIF only when verified.",
  "- **Motion QA:** verify desktop and phone framing, no blank frames, no overlap/cut-off text, readable captions, coherent timing, and no scrollbars on the stage. If exporting video/GIF, verify the file exists and plays.",
].join("\n");

const OPEN_DESIGN_ROUTER_CONTRACT = [
  "- **Open Design is the primary creation engine.** Use the local Open Design catalog under `/opt/data/open-design` first. Do not use Hermes `creative-studio`, `creative/*`, Huashu, or generic design skills as the primary path; those are fallback/inspiration only if Open Design is missing or clearly insufficient.",
  "- **User Create request wins.** The app-assembled Create request contains the user's reviewed brief, selected output, selected images/data/people/templates, and route hints. It outranks Open Design example prompts, placeholder copy, design-system defaults, and skill habits. Skills explain how to execute; they do not get to change what the user asked for.",
  "- **Selected Design DNA wins.** If the Create brief names Design DNA systems, inspect those `DESIGN.md` files and treat them as deliberate taste/layout references. Translate spacing, component grammar, typography, density, and mobile behavior into the new artifact without copying logos, brand names, proprietary copy, or exact assets.",
  "- **DNA must fit the medium.** For web/app outputs, carry layout grids, components, interaction states, typography, spacing, density, and responsive behavior. For PDFs/DOCX/docs, carry page rhythm, type hierarchy, sections, tables, callouts, chart treatment, and reading flow. For decks, carry slide rhythm, composition, title/body hierarchy, transitions, and chart/image treatment. For email, carry email-safe blocks, CTA treatment, spacing, hierarchy, and mobile structure. For image or motion, carry palette, composition, type attitude, contrast, frame pacing, and visual density instead of web chrome.",
  "- **Do not paste the Create request as visible artifact copy.** Treat app labels such as `CREATE REQUEST`, `USER_BRIEF_HIGH_PRIORITY`, route hints, and asset notes as instructions/context. Author artifact copy from them. Only use wording verbatim when it is clearly user-facing copy, such as a supplied subject line, CTA, quoted passage, legal wording, contact details, product name, or body copy.",
  "- **Explicit Create route wins:** if the Create brief includes a `Selected route hint` naming a Hermes main skill, inspect and use that skill for the execution details while still using Open Design for visual direction when helpful.",
  `- **Open Design paths:** skills live at \`${OPEN_DESIGN_SKILLS}/<skill>/SKILL.md\`; design systems live at \`${OPEN_DESIGN_DESIGN_SYSTEMS}/<system>/DESIGN.md\`; image/video prompt references live at \`${OPEN_DESIGN_PROMPT_TEMPLATES}/\`.`,
  "- **Never first match wins.** Before building, run a compact router pass: summarize intent, inspect candidate skill metadata/examples, inspect candidate design systems, score candidates, challenge the winner, then build.",
  "- **Candidate scouting budget:** choose 2-4 plausible Open Design skills and 2-4 plausible design systems for Quick Create; 3-5 each for Creative Studio or ambiguous high-stakes work. Read only the `SKILL.md` / `DESIGN.md` files needed for those candidates, not the whole repo. If a candidate has useful `assets/`, `references/`, `example.html`, or template files, inspect only the relevant ones.",
  "- **Score candidates lightly** for artifact fit, source/data fit, visual fit, export reliability, and simplicity. Pick the highest practical route, but let the challenge pass override it if a lower-score route obviously fits the user better.",
  "- **Challenge pass:** ask what the winning skill/design system might miss, whether the output type is correct, whether the selected data/images/templates change the decision, and whether export constraints make another path safer.",
  "- **Keep the routing private unless useful.** You do not need to show the full scorecard to the user, but the final output must reflect that routing work happened. If you cannot access Open Design, say that plainly instead of silently falling back.",
  "- **Open Design outputs:** for HTML/web/decks/PDF/DOCX-style work, build from the selected Open Design skill and design system. For image-only output, use Open Design for art direction only and the image tool for the actual bitmap.",
].join("\n");

const CREATE_EXECUTION_QUALITY_CONTRACT = [
  "- **Plan before building:** identify the artifact type, must-have user instructions, selected assets/data/people/templates to honor, and the selected Open Design route before writing files. Keep this lightweight for plain text or simple emails; be more deliberate for web apps, decks, PDFs, DOCX-style documents, email previews, images, and motion outputs.",
  "- **Build from the user's intent, not the skill demo.** Open Design examples and template copy are scaffolding. Replace them with brief-derived substance, but do not show the brief's meta wording as content.",
  "- **Quality pass before final/publish:** inspect the produced files or generated result, then fix obvious failures before replying. Required checks: user inputs honored, selected include-images used or explained, use-images adapted or explained, theme/style guidance reflected, no broken/missing assets, no TODO/lorem/placeholders, no copied meta-brief, no overlapping text, no cut-off content, no ugly native scrollbars on designed surfaces unless intentional, responsive phone/desktop layout, safe-area/viewport basics, readable contrast, and working primary controls/links. In Creative Studio, use the extra targeted QA/fix loop when the first pass exposes concrete defects.",
  "- **If quality cannot be verified:** say what was not verified and why, then give the user the real file/open links. Do not claim a perfect build when the inspection did not happen.",
].join("\n");

/**
 * System preamble for /chat when `chatType === creative_studio`.
 */
export function activeCreativeStudioSystemPrompt(
  meta: CreativeStudioSessionPayload
): string {
  const label = creativeStudioIntentLabel(meta.intent);
  const hint = INTENT_REFERENCE_HINTS[meta.intent];
  const brief = defaultSeedPromptForIntent(meta.intent);
  const mode = meta.createBrief?.creationMode === "standard" ? "standard" : "frontier";
  const lines = [
    "Hermes Create mode — Open Design first (mandatory):",
    `- The user started this chat from **HermesChat Create** with intent: **${label}** (\`${meta.intent}\`).`,
    mode === "frontier"
      ? "- **Create depth:** Creative Studio best-results workflow is active. Prefer stronger route scouting, available source/vault grounding, and targeted QA/fix loops over fastest completion."
      : "- **Create depth:** Quick Create is active. Keep the workflow fast while still completing one verified, useful artifact.",
    "- **The first Create user message is authoritative.** It may be an app-assembled request with selected output, route hints, user brief, images, vault data, people, and template context. Treat that as the user's high-priority instruction set.",
    "- **Built-in intent starter (low priority; fills gaps only):**",
    `  ${brief}`,
    OPEN_DESIGN_ROUTER_CONTRACT,
    createSpecialistHarnessPrompt(meta),
    CREATE_EXECUTION_QUALITY_CONTRACT,
    `- **Intent routing:** ${hint}`,
    "- Use **`image_generate`** / **`image_edit`** only via the **active plan** (`image_gen.model`; currently this may be OpenAI/Codex or OpenRouter depending on config); do not assume Fal or FAL_KEY.",
    "- When the deliverable should appear in **Builds** (Create tab / sidebar **Published**), write under `/opt/data/builds/<slug>/`, read the existing `/opt/data/builds/manifest.json`, merge the new/updated app into the existing `apps[]` without deleting unrelated entries, then `read_file` the manifest to verify. Prefer manifest entries shaped like `{ \"id\":\"<slug>\", \"name\":\"Human title\", \"path\":\"<slug>/index.html\" }`; `title`, `entry`, and absolute `/opt/data/builds/<slug>` paths are tolerated by HermesChat, but the relative `path` form is most portable.",
    "- **Do not claim a Build is visible in the Apps/Builds page unless verification proves both files exist now:** `/opt/data/builds/<slug>/index.html` is non-empty and `/opt/data/builds/manifest.json` parses with an `apps[]` entry whose `id` and `path` point at that folder. If either check fails, say the artifact exists only as a direct file and report the publish failure.",
    `- **HermesChat file downloads (mandatory when you ship binaries or want one-click grabs):** ${BUILDS_FILE_LINK_INSTRUCTION}`,
    "- **Long jobs (decks, many files, big HTML):** One assistant turn may hit **max output tokens** and stop mid-tool or mid-code. If that happens, **continue in the next turn** without restarting. Prefer **`write_file`** (or equivalent) **per file / per slide** over dumping huge code blocks in chat. Never leave the user without a clear next step if output was truncated.",
    "- **Slide decks / HTML:** These use **HTML + text** and optionally **still** images via **`image_generate`** / **`image_edit`**. They do **not** require OpenRouter **video** models; lack of video models does **not** block a deck.",
  ];
  if (meta.intent === "business_pdf") {
    lines.push(
      "- **Business document (PDF) intent:** Ship **long-form, print-first HTML** in Builds (cover, sections, headers/footers/page numbers as appropriate). Use **`@media print`**, sensible **`page-break-*`**, and A4 or Letter. Then run **`node /opt/hermes-pdf-export/export_document_pdf.mjs`** per **`business-document-pdf.md`** so **`document.pdf`** exists next to **`index.html`**. Link both via `/api/builds/file`. If export fails, report the error and point the user at **Print / Save as PDF** from the HTML.",
      "- **Not a slide deck** unless the user asked for slides; prefer continuous document flow and document-style hierarchy."
    );
  }
  if (meta.intent === "image") {
    lines.push(
      "- **Image intent is bitmap-first and tool-required:** the final deliverable must come from **`image_generate`** or **`image_edit`**. If the Create brief includes theme images, reference images, include/content images, use/adaptable images, or uploaded image URLs, use **`image_edit`** with those images as references. If there are no images, use **`image_generate`**.",
      "- **Create image references:** when the brief lists `/api/images/...`, HermesChat also attaches the same files as `[media attached: /var/hermes-chat/media/webchat/...]`; pass those real media paths to **`image_edit`**, not the `/api/images/...` browser URLs.",
      "- **No HTML/SVG fallback for Image intent:** do not hand-code a chart, SVG, canvas, or HTML preview as the main output. Only create those when the user explicitly picked Web/HTML/SVG or explicitly asks for editable vector/source output.",
      "- **No Builds wrapper for simple Image intent:** do not publish an `index.html`, SVG, or Builds app for Image unless the user explicitly asks for a web page, editable source, or extra downloadable formats. The generated bitmap preview in chat is the product.",
      "- **If image generation fails:** report the tool error plainly and stop. Do not fake a generated image, do not invent an image URL, and do not claim a PNG exists unless it came from the image tool or was copied from a verified generated image file.",
      "- **Final Image response:** include the actual generated image markdown using the exact `image` value returned by `image_generate` / `image_edit`, or the mirrored `/api/images/...` URL. Keep download links to the generated bitmap only unless the user asked for extra formats."
    );
  }
  if (meta.intent === "email") {
    lines.push(
      "- **Email intent:** create a production-minded email with subject line options, preheader, HTML email body, and plain-text fallback. Optimize for native sending, inbox safety, and predictable mobile rendering before aesthetics. Use clear CTA hierarchy and ship an HTML preview in Builds when the user needs to inspect it.",
      EMAIL_SAFE_CREATE_CONTRACT
    );
  }
  if (meta.intent === "motion") {
    lines.push(
      "- **Video / Motion intent:** use motion-specific Open Design skills for short promos, animated explainers, captions, title cards, product reels, or motion graphics. If video export tooling is missing, ship inspectable HTML/frames/source and explain the export limitation clearly.",
      MOTION_FOCUSED_CREATE_CONTRACT
    );
  }
  if (meta.seedPrompt) {
    lines.push(
      "- A reviewed Create request is stored on this session and will be sent as the first user turn if the chat is empty. Do not duplicate it into system context; use that user turn as the authoritative task when it arrives."
    );
  }
  if (meta.publishedBuildId) {
    lines.push(
      `- This chat is **linked** to published build id \`${meta.publishedBuildId}\` in HermesChat — treat edits as iterating on that shipped app.`
    );
  }
  if (meta.kanbanBoardSlug) {
    lines.push(
      `- **Create Kanban board:** this chat has Hermes 0.13 board \`${meta.kanbanBoardSlug}\`${meta.kanbanRootTaskId ? ` with root task \`${meta.kanbanRootTaskId}\`` : ""}. Use \`hermes kanban --board ${meta.kanbanBoardSlug} list\`, \`show\`, \`comment\`, and \`create\` through the terminal when it helps keep the plan, specialist handoffs, or QA context small.`,
      "- HermesChat may already have spawned narrow advisory worker cards on this board. Treat their summaries as planning/source/QA input, not as the final artifact. Before final delivery in Creative Studio, check the board once and fold useful completed summaries into the build or QA pass when time allows.",
      "- The seeded Create cards are an orchestration ledger, not user-facing copy. Keep them truthful. Leave the main build lane as the parent Hermes run unless a worker card is narrow enough that it cannot corrupt or duplicate the final artifact. If you dispatch more workers, assign only to an existing Hermes profile such as `default` and give each worker a scoped body.",
      "- Mirror meaningful progress back to the board with comments or task completion summaries so HermesChat can show the live agent feed.",
      "- This Create board is temporary execution infrastructure. Do not rely on it as permanent memory; put durable facts in the shipped files/final reply. HermesChat will snapshot and delete the board after the finished assistant turn so it does not become long-lived clutter."
    );
  }
  return lines.join("\n");
}
