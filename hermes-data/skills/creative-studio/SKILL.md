---
name: creative-studio
description: >
  Current HermesChat Create execution playbook. Use the active Create brief, Open Design
  catalog, selected vault inputs, image references, people/profile context, templates, and
  the Builds manifest to create websites, HTML apps, slide decks, PDFs, DOCX-style documents,
  emails, images, critiques, and open-ended mini builds.
triggers:
  - HermesChat Create session
  - user asks to create, make, build, design, draft, publish, or revise a website, app, deck, PDF, DOCX, email, image, or critique
related_skills: [hermeschat-builds-manifest, vault-ingest-read-guide, project-vault, shared-wiki-vault-io]
---

# Creative Studio

Use this skill for HermesChat **Create** work. The Next.js app already builds a reviewed Create brief before Hermes starts. Treat that brief as the source of truth: preferred output, prompt, selected style/theme images, images to include, vault data/files, notes, people/profile cards, and template carry-over.

## Brief Priority

The reviewed Create request is higher priority than any Open Design example, placeholder, template copy, or default style habit.

- Use Open Design skills as execution playbooks, not as permission to ignore the user's selected output, prompt, images, vault data, people, template, route hints, or extra directions.
- Treat app labels such as `CREATE REQUEST`, `USER_BRIEF_HIGH_PRIORITY`, route hints, asset notes, and vault notes as instructions/context.
- Do not paste the brief's meta wording into the finished artifact. A sentence like "a polished outbound email that explains..." describes the job; it is not visible copy.
- Preserve or closely follow wording only when it is clearly user-facing copy: supplied subject lines, preheaders, CTA labels, quoted passages, legal wording, contact details, product/service names, or drafted body copy.
- If a skill example conflicts with the user request, adapt the skill. The user request wins.

## Primary Engine

Open Design is the primary creation engine.

- Skills: `/opt/data/open-design/skills/<skill>/SKILL.md`
- Design systems: `/opt/data/open-design/design-systems/<system>/DESIGN.md`
- Prompt references: `/opt/data/open-design/prompt-templates/`

Choose 3-7 plausible Open Design skills and 3-7 plausible design systems. Read only the relevant `SKILL.md`, `DESIGN.md`, assets, references, or templates. Do not scan the whole catalog.

Legacy Huashu / old HermesChat deck/PDF skills are fallback inspiration only. Do not use `hermeschat-create-deck-from-brief`, `hermeschat-one-page-pdf-from-vault`, or `vault-brief-generation` as separate primary workflows; their useful checks are folded into this skill.

## Create Intents

The current Create picker supports:

- `web_app` / Website / HTML app: static HTML/CSS/JS unless the brief truly needs more.
- `deck` / Slide deck / Presentation: HTML deck with clear next/back controls and keyboard navigation.
- `business_pdf` / PDF / Business document: print-first HTML canonical, then PDF export.
- `docx` / Document: polished document content; HTML preview/export when useful.
- `email`: inbox-safe subject, preheader, lightweight HTML email body, plain-text fallback, and preview build when useful.
- `image`: bitmap deliverable through `image_generate` or `image_edit`; no HTML/SVG fake image fallback.
- `motion`: storyboarded motion/video package; inspectable HTML/CSS/JS or frames first, MP4/GIF only when export tooling is verified.
- `critique`: review existing output with Open Design critique/tweaks patterns.
- `surprise`: small playful or useful mini-build, still published cleanly.

## Vault And Inputs

When the brief names vault data, read the vault through the current retrieval layer:

1. `LOG.md`
2. `INDEX.md`
3. `index/coreference.json` when present
4. `SCHEMA.md`
5. role folders such as `templates/`, `scoring/`, `branding/`
6. `wiki/` and `extracted/`
7. `sources/` only when the extracted layer is missing or exact original layout is needed

Use `vault-ingest-read-guide` for path rules. Shared vaults live under `/vault-shared/<slug>/`; private vaults live under `projects/<slug>/` or `/opt/data/projects/<slug>/`.

For image references listed as `/api/images/<uuid>.png`, resolve to `/var/hermes-chat/media/webchat/<uuid>.png` or search `/var/hermes-chat` for the UUID. Style/theme images guide palette, typography, mood, and composition. Content images should be copied into the build and used visibly when the brief asks.

If the Create request includes extracted theme/style guidance, use it. If it includes content images with a placement, copy those files into the deliverable and use them visibly unless there is a clear reason not to; explain any omission.

## Image Generation

Use Hermes `image_generate` and `image_edit` only. Do not pass a model id; the gateway uses the active plan `image_gen.model` through OpenRouter.

For `image_edit` with user attachments, pass the exact local paths from the message or resolved `/var/hermes-chat/media/webchat/<uuid>.<ext>` paths. If the tool says `Not a file`, first check for a UUID/extension typo and verify the path with `test -f`, `stat`, or a small PIL/open check before retrying. Do not repeat the same failing image call unchanged.

After a successful image call, run a quick QA pass when possible. `image_edit`/`image_generate` may return shorthand like `tool_images/<file>.png`; `vision_analyze` needs either an HTTP URL or the real local path, usually `/opt/data/tool_images/<file>.png`. Check that the output is the requested image artifact, uses required references, preserves required logos/subjects when asked, and has no obvious broken/cut-off subjects, unreadable main mark, or excessive gibberish text.

Do not assume Fal, FLUX-as-a-service, or `FAL_KEY`. OpenRouter billing or 402 errors belong to the active plan.

For image intent, the image itself is the deliverable. For websites/decks/PDFs/emails, generated or uploaded images are supporting assets.

## Publishing

All non-image Create deliverables must be published to HermesChat Builds.

1. Write the static tree under `/opt/data/builds/<app-slug>/`.
2. Read `/opt/data/builds/manifest.json`, merge the new or updated app into the existing `apps[]`, and never replace the manifest with only the current app.
3. Read the manifest back and verify valid JSON plus a live entry whose `id` and `path` point at the build folder.
4. Verify the entry file exists now, usually `/opt/data/builds/<app-slug>/index.html`, and is non-empty.
5. If this is a Create session, attach the chat to the build with `POST /api/builds/attach-create-session` when the session id and new build id are known.
6. Return useful `/api/builds/file?id=<id>&name=<relative-path>` links for PDFs, HTML, DOCX, email previews, or assets.

Do not claim the artifact appears in Builds or Apps unless both the manifest entry and the build files verify. If verification fails, say it is only a direct file/artifact and report the publish failure.

Use `hermeschat-builds-manifest` for manifest details and permission recovery.

## Planning And Quality Pass

Before building, do a compact route-and-fit plan:

1. Confirm the artifact type and the user's must-haves.
2. Confirm which selected images, vault data, people, templates, and style notes must be honored.
3. Pick the Open Design skill/design-system route and challenge whether it really fits.
4. For simple text-only or plain email work, keep the process light and focus on writing quality.
5. For web apps, decks, PDFs, DOCX-style documents, email previews, image outputs, and motion outputs, be deliberate before writing files.

Before the final reply or publish, run one quality pass and fix obvious failures:

- user inputs ignored or contradicted
- selected content images missing
- style/theme guidance absent
- broken/missing assets
- TODO/lorem/placeholder text
- brief meta wording copied into visible content
- overlapping text, clipped sections, or unreadable contrast
- ugly native scrollbars on designed surfaces unless intentional
- mobile viewport or safe-area problems
- primary controls, links, slides, or downloads not working

If you cannot verify something, say that plainly instead of pretending the artifact is checked.

## Output-Specific Rules

### Websites And Apps

- Use `viewport-fit=cover`, matching `theme-color`, `apple-mobile-web-app-status-bar-style=black-translucent`, `100dvh`, and safe-area padding for phone browser chrome.
- Avoid unnecessary frameworks and dependencies in static builds.
- Verify mobile and desktop layout when possible.

### Slide Decks

- Use a proven deck pattern from Open Design.
- Prefer fixed slides with explicit Next/Back controls over scroll-snap decks unless the brief asks for scrolling.
- Check slide count, no TODO/lorem text, assets exist, and navigation works.

### PDFs

- Build print-first HTML under the build folder.
- Export with:

```bash
node /opt/hermes-pdf-export/export_document_pdf.mjs --html /opt/data/builds/<slug>/index.html --out /opt/data/builds/<slug>/document.pdf --format A4
```

Use `--format Letter` when requested. Verify page count and non-empty text with PyMuPDF when possible.

### Emails

- Produce subject, preheader, responsive HTML body, and plain-text fallback.
- Treat `email.html` as the real sendable/pasteable email artifact, not just a browser preview.
- Prioritize deliverability and predictable native-mail rendering over spectacle. The default should feel like a well-designed human email, not a web landing page, poster, or image-heavy campaign.
- Use a white or very light background with dark readable text. Do not build full dark-background emails, gradient shells, or designs whose identity depends on background colour surviving.
- Put critical layout, colours, backgrounds, spacing, borders, typography, CTA, and image sizing inline on the elements. Do not rely on `<head>` CSS, classes, CSS variables, external CSS, scripts, or web fonts for the email to look right after paste.
- Build mobile-first with outer wrappers at `width:100%; max-width:100%; margin:0;` and avoid fixed-only 600/640px shells. A desktop max-width wrapper is fine only when the pasted email still fills a phone cleanly.
- Add `bgcolor` attributes on important `body`, `table`, and `td` elements. Prefer solid `background-color` values; do not rely on gradients or background images for essential colour.
- Avoid images by default. If images are explicitly needed, use at most one small supporting image in the preview/source, with real text carrying the message. Do not use base64/data images, protected image URLs, background-image-only hero art, or screenshot emails.
- Keep links restrained: one primary CTA unless the user explicitly asked for a newsletter. Avoid clickbait, fake urgency, all caps, excessive punctuation, spammy sales phrasing, and "cold drop" copy.
- For promotional or bulk-style messages, include sender identity and a simple opt-out/unsubscribe or reply-based opt-out line.
- Include explicit inline `background-color`, `color`, and `-webkit-text-fill-color` on important surfaces/text so mobile mail dark mode and paste sanitizers do not destroy the design.
- Publish a preview HTML build when useful, but keep `email.html`, `plain-text.txt`, and `subject-lines.txt` as the send-ready package.

### Motion / Video

- Treat motion as a storyboarded short, not a collage of all selected inputs.
- Before building, define a private motion recipe: aspect ratio, duration/loop length, 2-4 beats, one primary message, one hero subject or asset, palette, type scale, movement vocabulary, and asset roles.
- Keep input use deliberately narrow. Use the main prompt as the brief; use at most one dominant style image and at most one hero/include/use image unless the user explicitly asks for more.
- Treat vaults, files, people, templates, DNA, and source material as planning context unless the user says they must appear. Reduce source material to short captions or beats; do not animate paragraphs or data dumps.
- Default to 6-12 seconds, 2-4 scenes/beats, one new idea per beat, and no more than 5-6 visible elements at once.
- Keep on-screen text large and short: roughly 3-8 words per beat. Preserve exact wording only for marked short lines that fit the storyboard.
- Use progressive disclosure, opacity layering, consistent color meanings, and a small transition vocabulary. Avoid many simultaneous loops, particle spam, random decorative effects, tiny labels, and constant motion everywhere.
- Publish an inspectable `index.html` stage or frame package first. Export MP4/GIF only when ffmpeg/HyperFrames/Pillow/browser capture tooling has been verified for the run.
- QA phone and desktop framing, blank frames, caption readability, cut-off/overlap, scrollbars on the stage, timing coherence, and actual media file existence when exports are promised.
- Use `motion-video-builds` for package shape, render commands, manifest publishing, and export verification.

### DOCX-Style Documents

- Produce the polished document body first.
- Use HTML preview/PDF export if the UI needs a viewable artifact.
- Do not pretend a native `.docx` exists unless you actually generated one.

## Build Hygiene

- Check for stale build folders before overwriting.
- Never write empty placeholder files over real content.
- Verify important file writes with `test -f`, `stat`, `wc`, or reading the manifest back.
- Keep claims source-backed. If a vault fact is uncertain, phrase it as a follow-up or recommendation, not a fabricated fact.
- Keep final replies short: what was built, where to open it, and direct file links.
