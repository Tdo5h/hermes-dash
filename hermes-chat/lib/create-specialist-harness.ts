import type { CreativeStudioSessionPayload } from "@/lib/creative-studio-session";

type HarnessInputs = {
  hasVault: boolean;
  hasThemeImages: boolean;
  hasIncludeImages: boolean;
  hasUseImages: boolean;
  hasRawFiles: boolean;
  hasPeople: boolean;
  hasTemplate: boolean;
  hasDesignDna: boolean;
  hasSourceText: boolean;
  hasExactCopy: boolean;
};

function hasItems<T>(items: T[] | undefined): boolean {
  return Array.isArray(items) && items.length > 0;
}

function harnessInputs(meta: CreativeStudioSessionPayload): HarnessInputs {
  const brief = meta.createBrief;
  return {
    hasVault: Boolean(brief?.vault),
    hasThemeImages: hasItems(brief?.assets?.themeImages),
    hasIncludeImages: hasItems(brief?.assets?.includeImages),
    hasUseImages: hasItems(brief?.assets?.useImages),
    hasRawFiles: hasItems(brief?.assets?.rawFiles),
    hasPeople: hasItems(brief?.people),
    hasTemplate: Boolean(brief?.template),
    hasDesignDna: Boolean(brief?.designDna?.systems?.length),
    hasSourceText: Boolean(
      brief?.user.sourceMaterial?.trim() || brief?.user.dataNotes?.trim()
    ),
    hasExactCopy: Boolean(brief?.user.exactCopy?.trim()),
  };
}

function outputSpecialist(meta: CreativeStudioSessionPayload): string {
  const outputLabel = meta.createBrief?.output.displayName || "requested artifact";
  switch (meta.intent) {
    case "business_pdf":
      return `Formal Document Builder: create a print-first ${outputLabel}; turn source facts into clear sections, preserve exact wording only where marked, build HTML first, export PDF when tooling is available, and check page breaks.`;
    case "deck":
      return `Deck Builder: create a story-led slide deck; choose a tight narrative arc, use one idea per slide, make the visual system consistent, and verify slides do not overflow.`;
    case "docx":
      return `Editable Document Builder: create a polished editable document; keep headings, tables, lists, and source structure maintainable, then export DOCX when tooling is available.`;
    case "email":
      return "Email Builder: create inbox-safe subject options, preheader, polished human body copy, one clear CTA, lightweight light-theme HTML preview, and a strong plain-text fallback.";
    case "image":
      return "Image Director: produce the final bitmap through the configured image tool; use theme images as style references, place include/content images as requested, and adapt use-images when transformation is allowed.";
    case "motion":
      return "Motion Builder: create a storyboard-first short with 2-4 beats, one primary message, one visual motif, and inspectable HTML/frames first; use at most one selected image as the hero asset unless the brief explicitly asks for more, and export video/GIF only if local tooling proves it can do so.";
    case "web_app":
      return `Web Builder: create a complete ${outputLabel}; prioritize real content, responsive layout, working interactions, asset integrity, and a publishable Builds entry.`;
    case "hifi_html":
      return "HTML Prototype Builder: create a single-file high-fidelity prototype with stable layout, polished visual hierarchy, and working interactions.";
    case "critique":
      return "Critique Specialist: review against the brief, selected inputs, usability, visual hierarchy, accessibility, and implementation risk; produce prioritized fixes.";
    case "surprise":
      return "Format Picker + Builder: choose the strongest format for the brief, state the choice internally, then build one coherent artifact rather than many half-finished ideas.";
  }
}

function qaSpecialist(meta: CreativeStudioSessionPayload): string {
  switch (meta.intent) {
    case "business_pdf":
      return "QA Reviewer: verify source facts, exact-copy handling, print CSS, page breaks, exported PDF existence, manifest links, and absence of placeholders.";
    case "deck":
      return "QA Reviewer: inspect slide count, narrative flow, visible text, image usage, responsive/presenter behavior for HTML decks, PPTX structural validity when relevant, and manifest links.";
    case "docx":
      return "QA Reviewer: open or inspect generated files, check headings/tables/lists, source fidelity, DOCX existence when promised, and manifest links.";
    case "email":
      return "QA Reviewer: check subject/preheader/body/CTA, plain-text fallback, preview rendering, native-mail-safe styling, no base64/protected image dependency, low spam risk, and no broken assets.";
    case "image":
      return "QA Reviewer: confirm the generated image file/URL exists, references were actually used, and the final response does not fake a bitmap or substitute HTML.";
    case "motion":
      return "QA Reviewer: check the preview runs, frames are not blank, timing is coherent, only 2-4 beats are used unless requested, text is readable on phone and desktop, the stage has no scrollbars/overlap, export files exist only when verified, and limitations are stated plainly.";
    case "web_app":
    case "hifi_html":
      return "QA Reviewer: use Playwright/browser inspection when available; check desktop/mobile framing, nonblank render, broken assets, console errors, overflow, contrast, controls, and manifest links.";
    case "critique":
      return "QA Reviewer: ensure critique findings are specific, ordered by severity, and tied to the brief rather than generic taste.";
    case "surprise":
      return "QA Reviewer: verify the chosen format is actually finished, usable, and published or linked correctly.";
  }
}

function sourceSpecialist(
  inputs: HarnessInputs,
  intent: CreativeStudioSessionPayload["intent"]
): string | null {
  const needsSource =
    inputs.hasVault ||
    inputs.hasRawFiles ||
    inputs.hasSourceText ||
    inputs.hasPeople ||
    inputs.hasTemplate;
  if (!needsSource) return null;
  const clauses: string[] = [];
  if (inputs.hasVault) {
    clauses.push(
      "read the selected vault before drafting; use LOG, INDEX, router, SCHEMA, then extracted/ and wiki/; sources/ binaries are last resort"
    );
  }
  if (inputs.hasRawFiles) {
    clauses.push("read uploaded file tool paths directly and respect each file role");
  }
  if (inputs.hasTemplate) {
    clauses.push("inspect the template outline/structure and carry over only the selected parts");
  }
  if (inputs.hasPeople) {
    clauses.push("use selected people for audience, names, roles, contact details, and tone");
  }
  if (inputs.hasSourceText) {
    clauses.push("distill source text into reusable facts and structure, not pasted filler");
  }
  const motionSuffix =
    intent === "motion"
      ? " For motion, reduce sources to a tiny beat list and do not put every fact, person, or file visibly on screen."
      : "";
  return `Source Researcher: ${clauses.join("; ")}.${motionSuffix}`;
}

function styleSpecialist(
  inputs: HarnessInputs,
  intent: CreativeStudioSessionPayload["intent"]
): string | null {
  if (
    !inputs.hasThemeImages &&
    !inputs.hasIncludeImages &&
    !inputs.hasUseImages &&
    !inputs.hasDesignDna
  ) return null;
  const clauses: string[] = [];
  if (inputs.hasDesignDna) {
    clauses.push(
      "read the selected Design DNA references and translate their layout, spacing, typography, components, density, and mobile behavior as requested without copying logos, brand names, proprietary copy, or exact assets"
    );
  }
  if (inputs.hasThemeImages) {
    clauses.push(
      "translate theme images into palette, mood, layout, texture, typography, and contrast"
    );
  }
  if (inputs.hasIncludeImages) {
    clauses.push("place include-images visibly when requested and verify local paths/URLs");
  }
  if (inputs.hasUseImages) {
    clauses.push(
      "adapt use-images as editable source material: crop, reframe, recolor, mask, clean up, composite, restyle, or derive elements/backgrounds as the brief allows"
    );
  }
  const motionSuffix =
    intent === "motion"
      ? " For motion, pick one dominant style reference, one motion vocabulary, and one hero visual role before building."
      : "";
  return `Style Director: ${clauses.join("; ")}; do not paste style-reference images as content unless the brief asks.${motionSuffix}`;
}

function runStateInstruction(frontier: boolean): string {
  if (!frontier) {
    return "- **State discipline:** keep a short private checklist for brief, route, build, QA, and publish. Write durable notes only when the artifact is large enough that context loss is likely.";
  }
  return "- **Durable run state:** for substantial Builds outputs, create `/opt/data/builds/<slug>/_hermes-create/` after choosing the slug and keep concise `brief.md`, `route.md`, `sources.md` when sources are used, `style.md` when visual references are used, and `qa.md`. If no Builds folder is appropriate, use `/opt/data/hermes-runs/create/<slug>/` only when it prevents context loss.";
}

export function createSpecialistHarnessPrompt(
  meta: CreativeStudioSessionPayload
): string {
  const mode = meta.createBrief?.creationMode === "standard" ? "standard" : "frontier";
  const frontier = mode === "frontier";
  const inputs = harnessInputs(meta);
  const routerSpecialist = frontier
    ? "Router: choose the strongest practical route for the brief; inspect the needed candidate skills/design systems, score for artifact fit/source fit/visual fit/export reliability, and challenge the winner once before building."
    : "Router: choose the smallest good route; inspect only the candidate skills/design systems needed for this artifact and challenge the winner once.";
  const specialists = [
    "Brief Curator: extract the user goal, must-haves, non-goals, exact-copy constraints, output format, and what would make the result feel excellent.",
    sourceSpecialist(inputs, meta.intent),
    styleSpecialist(inputs, meta.intent),
    routerSpecialist,
    outputSpecialist(meta),
    qaSpecialist(meta),
    "Publisher: fix only concrete QA failures, then publish/link real files. Do not announce files, images, PDFs, DOCX, videos, or Builds entries that were not verified.",
  ].filter(Boolean);

  const retryBudget = frontier
    ? "Creative Studio is the best-results path: prefer quality over speed, use up to two targeted QA/fix loops, and broaden the route only after a concrete failure signal proves the chosen route cannot satisfy the brief."
    : "Standard mode gets one targeted QA/fix loop for substantial artifacts. Keep simple text/email/image requests lightweight.";

  return [
    "Hermes Create specialist harness (native, no sidecar):",
    "- **Harness shape:** Hermes is the parent orchestrator. Specialists are bounded execution phases; use actual child/delegated agents only when the runtime exposes them and the subtask is independent.",
    "- **Do not over-orchestrate:** one coherent finished artifact beats many parallel half-results. Keep the loop narrow until a failure signal justifies broadening.",
    runStateInstruction(frontier),
    `- **Attempt policy:** ${retryBudget}`,
    "- **Execution contracts:** each specialist phase must know its inputs, allowed files/tools, completion condition, and output path before acting.",
    "- **Specialists for this run:**",
    ...specialists.map((line) => `  - ${line}`),
    inputs.hasExactCopy
      ? "- **Exact copy:** preserve marked wording exactly where user-facing; everywhere else, rewrite and design normally."
      : "- **Copy policy:** write user-facing copy from the brief and sources; never paste app meta labels as artifact content.",
  ].join("\n");
}
