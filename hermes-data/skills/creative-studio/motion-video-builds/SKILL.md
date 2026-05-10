---
name: motion-video-builds
description: >
  Use when creating HermesChat motion/video deliverables: animated HTML motion frames,
  title cards, sprite-style explainers, short MP4/GIF exports, storyboard frames, and
  Builds-published motion packages from uploaded images and vault context.
triggers:
  - Video / Motion
  - Motion Frames
  - animated HTML
  - title card
  - motion graphics
  - sprite-style explainer
  - short video export
  - MP4 export
  - GIF teaser
related_skills: [creative-studio, hermeschat-builds-manifest, project-vault]
---

# Motion / Video Builds

Use this skill for HermesChat Create jobs where the requested output is motion: animated HTML, motion frames, title cards, sprite-style explainers, short video loops, GIF previews, or code-based motion graphics. The goal is a user-openable Builds artifact plus direct downloadable exports, not just a static design description.

## Overview

HermesChat users view outputs in the web app. For motion work, produce a publishable package under `/opt/data/builds/<slug>/` that includes a browser preview and, when requested, rendered media. A good motion build usually has:

- `index.html` — animated HTML/CSS/JS preview or source composition.
- `<slug>.mp4` — 16:9 rendered video when the brief asks for video/motion.
- optional `teaser.gif` — small looping preview for quick review.
- `poster.png` — still frame for preview/poster use.
- optional `storyboard.png` — contact sheet of key frames.
- `assets/` — copied uploaded images, referenced relatively from HTML.
- `README.md` — concise provenance: selected route, vault facts used, image roles used, source uncertainties preserved.

## Input Discipline

Motion fails quickly when it tries to use every selected Create input as visible content. Start with a small motion recipe before writing files:

- one primary message
- one hero subject, object, or asset
- one dominant style direction
- 2-4 beats or scenes
- one movement vocabulary
- one aspect ratio and duration/loop length

Use selected vaults, files, people, templates, DNA, and source material as context unless the user explicitly says they must appear. Reduce source material into captions or beats; do not animate paragraphs, long notes, or data dumps. Use at most one style image and one hero/include/use image by default. Add more visible material only when the brief clearly needs it.

## When to Use

Use this skill when:

- The Create brief says `Preferred output: Video / motion`, `Create category: Video / Motion`, or subtype `Motion Frames`.
- The user asks to “see what you can do with animation”, “make motion frames”, “title cards”, “animated HTML”, “sprite animation”, or “code-based motion graphics”.
- The output needs to use uploaded images as moving side strips, inline stamps, backgrounds, or style references.
- Vault facts, people profiles, or trip/project context need to shape the motion text.

Do not use this for plain static websites, PDFs, or email unless they include a motion/video export requirement.

## Open Design Routing

Read the active Create brief first, then choose a small set of plausible Open Design skills and design systems. Do not scan the whole Open Design catalog.

Common motion routes:

1. `/opt/data/open-design/skills/motion-frames/SKILL.md` — best default for subtype `Motion Frames`; produces a single full-bleed animated hero/poster with CSS motion.
2. `/opt/data/open-design/skills/hyperframes/SKILL.md` — use when a true timed video composition, captions, audio, multi-scene render, or GSAP timeline is required.
3. `/opt/data/open-design/skills/sprite-animation/SKILL.md` — use for pixel/sprite explainers and retro animated educational frames.

For visual systems, pick only what matches the brief and references. For grungy editorial travel/motion, useful directions include WIRED-style editorial density, neobrutalist raw contrast, vintage/retro grit, or The Verge-style high-energy editorial motion. Avoid introducing a palette that conflicts with the user’s stated preferences.

## Vault and Asset Intake

When vault data is selected, use the active vault retrieval layer before writing copy:

1. `LOG.md`
2. `INDEX.md`
3. `index/coreference.json`
4. `SCHEMA.md`
5. `wiki/` entity notes
6. `extracted/` canonical markdown
7. source files only if exact originals are needed

For image references:

- Resolve `/api/images/<uuid>.<ext>` to `/var/hermes-chat/media/webchat/<uuid>.<ext>` when present.
- Style/theme references guide mood, typography, palette, and brand treatment; do not insert them as content unless the brief says to.
- Content images should be copied into `assets/` and used visibly where the brief requests.
- Verify image dimensions with Pillow or an equivalent tool before composing.

## Build Pattern

For normal HermesChat Builds publishing:

1. Create `/opt/data/builds/<slug>/assets/`.
2. Copy content assets into `assets/` using stable filenames.
3. Create `index.html` with relative asset paths. Prefer a 16:9 stage for motion frames.
4. If making a rendered export, generate `<slug>.mp4` and optional `teaser.gif`.
5. Create `poster.png`, `storyboard.png`, or both for quick inspection.
6. Add a short `README.md` with provenance and any vault uncertainty.
7. Update `/opt/data/builds/manifest.json` preserving existing `apps[]`.
8. Read the manifest back and validate JSON.
9. Return Builds instructions plus direct file links.

For reviewed Hermes Create production requests that name an explicit output root such as `/opt/data/hermes-runs/<run-id>`:

1. Use that output root for all final user-facing files; do not move the package to `/opt/data/builds/` or update the Builds manifest unless the brief explicitly asks.
2. Copy staged content/style assets into `<output-root>/assets/` using stable local names.
3. Produce a complete package in the output root: `index.html`, rendered MP4, optional `teaser.gif`, `poster.png`, `storyboard.png`, `README.md`, source renderer, copied assets, and for Hyperframes-style routes `source-composition.html`, `hyperframes.json`, `meta.json`, and optionally `package.json` scripts.
4. Verify the package directly in the output root and return concise absolute file paths only when the acceptance checks ask for paths-only delivery.

## Rendering Options

### HTML/CSS-only preview

Good for inspectable animated motion frames:

- CSS keyframes for background drift, side strips, route draw, kinetic type, grain/scanlines, and stamps.
- Relative assets only.
- No local server instructions in the final reply. Builds serves the page.

### HyperFrames

Use HyperFrames when the job needs formal composition timing, captions, audio, TTS, multi-scene transition rules, or a more exact render pipeline. Follow the HyperFrames skill for data attributes, GSAP timeline registration, finite repeats, lint/validate/inspect where available, and render rules.

For reviewed Hermes Creative Studio production requests with an explicit output root (for example `/opt/data/hermes-runs/<run-id>`), write and verify final user-facing files directly under that root unless the brief explicitly asks for Builds publishing. A good package is `index.html` preview, `hyperframes-source/` source composition, rendered MP4, `teaser.gif`, `poster.png`, `storyboard.png`, `README.md`, copied `assets/`, and any verification JSON. Keep the final reply to concise file paths if the brief requests that.

Practical HyperFrames render loop:

1. Create/edit `hyperframes-source/index.html` with deterministic GSAP timeline registration.
2. Run `npx hyperframes lint <source> --json`.
3. Run `npx hyperframes inspect <source> --json --samples 9` and save the JSON when useful; fix overflow/contrast/layout issues before rendering.
4. Render directly when available: `npx hyperframes render <source> -o <root>/<name>.mp4 -f 24 -q standard --workers 2 --strict`.
5. If the compiler warns about unmapped fonts, switch CSS to mapped deterministic fonts such as `League Gothic`, `Inter`, `Space Mono`, or other names listed in the warning, then re-run lint/inspect/render.
6. Generate poster/storyboard/GIF from the final rendered MP4, not from a stale fallback render, and verify dimensions with Pillow/ffprobe.

A robust HyperFrames-style deliverable package should include both inspectable source and rendered media: `source-composition.html` with composition metadata and timeline registration, `hyperframes.json`, `meta.json`, `index.html` preview shell, rendered MP4, poster/storyboard/GIF when requested, copied assets, and a renderer or render notes. If the CLI scaffold/render is flaky, keep the HyperFrames source composition but render deterministic finals with Pillow + ffmpeg, then validate the HTML/source separately.

### Pillow + ffmpeg fallback

For short title-card/motion-frame demos, a deterministic Python frame renderer is acceptable and often faster than full browser capture:

- Use Pillow to compose frames from uploaded assets, vault text, route lines, grit/grain, overlays, and typography.
- Prefer writing the renderer to `/tmp/<slug>.py`, reading it back, then running it with `terminal("python3 /tmp/<slug>.py")`; the `execute_code` sandbox can lack Pillow even when shell `python3` has it. See `references/pillow-terminal-renderer-quirk.md`.
- Render frames to `/tmp/<slug>/frame_%04d.jpg`, not into the build folder.
- Encode with ffmpeg:

```bash
ffmpeg -y -framerate 20 -i /tmp/<slug>/frame_%04d.jpg \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
  /opt/data/builds/<slug>/<slug>.mp4
```

Optional GIF preview:

```bash
ffmpeg -y -i /opt/data/builds/<slug>/<slug>.mp4 \
  -vf 'fps=10,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse' \
  /opt/data/builds/<slug>/teaser.gif
```

This fallback works well for grungy poster-motion, route maps, animated side strips, kinetic text beats, and short title-card experiments. Keep it deterministic: seeded noise, no uncontrolled randomness in final frame generation.

## Verification Checklist

Before replying:

- [ ] All deliverables exist: `index.html`, media exports, poster/storyboard, README, and assets.
- [ ] For explicit output-root production requests, all final user-facing files are under the requested root, not silently republished elsewhere.
- [ ] Read back or `stat` each important file after every write/rewrite, especially `index.html`, `source-composition.html`, `meta.json`, and README/config files; files can be accidentally truncated or disappear during iterative repair.
- [ ] `index.html` uses relative paths and every referenced file exists under the app folder.
- [ ] HyperFrames-style sources include valid local refs, composition metadata, and timeline registration; JS syntax checks pass.
- [ ] MP4 passes `ffprobe` with expected duration, codec, dimensions, and frame rate.
- [ ] Poster/storyboard/GIF dimensions are confirmed with Pillow or equivalent.
- [ ] For visual/motion diagram work, run a poster-frame quality pass (vision or equivalent) and fix obvious text overlap, low-contrast micro-labels, weak feedback arrows, cut-off content, and ignored content assets before final reply.
- [ ] If publishing to Builds, `/opt/data/builds/manifest.json` was updated without dropping existing apps.
- [ ] If publishing to Builds, manifest was read back and validated as JSON.
- [ ] Final reply matches the route: Builds instructions and `/api/builds/file?id=<id>&name=<file>` links for Builds-published apps; concise absolute output-root paths for explicit output-root Create requests that ask for paths only.

## Common Pitfalls

1. **Only delivering HTML for a video request.** If the brief says video/motion, include an MP4 where practical, plus HTML preview.
2. **Treating a style image as content.** Theme references set mood and palette; content images are the ones to include visibly.
3. **Writing frames into Builds.** Keep temporary frame sequences in `/tmp`; the build folder should contain clean deliverables.
4. **Dropping existing Builds cards.** Always read, preserve, and append/update `apps[]`; never default to an empty manifest after a read error.
5. **Overexplaining in the final reply.** The user wants the artifact. Keep the final response short: what was built, where to open it, and file links.
7. **Skipping the visual quality pass after rendering.** For diagrams and explainers, inspect the final poster/storyboard with vision or another visual check, then actually patch the build if it flags readability, weak loop direction, overlap, or cut-off issues.
8. **Assuming `execute_code` has the same media libraries as shell Python.** If Pillow imports fail in `execute_code`, write a temp renderer script and run it with `terminal python3`; verify with `ffprobe` and `stat` afterward.
9. **HyperFrames lint warnings vs. blockers.** `duplicate_media_discovery_risk` can appear when the same image source/start/duration is used across multiple matching nodes. Prefer avoiding duplicated discoverable media nodes, but if lint reports `0 error(s)` and browser validation reports no console errors, treat it as a non-blocking warning for deterministic MP4 packages.
10. **Assuming Builds rules apply to output-root production requests.** If the brief gives an explicit Hermes run output root and asks for final user-facing files there, do not register Builds or return web-app instructions unless explicitly requested.

## References

- `references/motion-video-publishing.md` — concise command/reference notes for the Pillow + ffmpeg publishing pattern.
- `references/pillow-terminal-renderer-quirk.md` — session-proven workaround for Pillow being available in shell Python but missing from `execute_code`.
- `references/hyperframes-output-root-package.md` — session-derived pattern for HyperFrames-style output-root packages with deterministic rendered media and validation/QC notes.
- `references/sprite-animation-case-bamboo-hallway.md` — reusable case notes for dark technical sprite-animation loops with style-reference-only images, deterministic exports, and visual QA repair loops.
- `references/logo-motion-frame-case-study.md` — concise case pattern for single-logo industrial motion frames: route selection, hero-asset discipline, visual QA fixes, and stale-export prevention.
