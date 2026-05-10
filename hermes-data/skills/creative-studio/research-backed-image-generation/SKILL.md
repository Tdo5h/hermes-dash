---
name: research-backed-image-generation
description: >
  Create promotional images, posters, brand visuals, and concept graphics that need external/site research, official brand assets, and quality-checked image generation.
triggers:
  - create a promotional image after researching a website
  - image poster for a product or brand
  - magazine poster using official site assets
  - brand visual with source-material research
  - generate image from references and official web assets
---

# Research-Backed Image Generation

Use this skill when an image deliverable is not just freeform generation: the user wants a poster, brand visual, social graphic, or concept image that should honor official websites, product claims, logos, visual assets, or reference imagery.

## Core Principle

The final image is the deliverable. Research, Open Design skills, templates, and design systems are execution aids. They must support the user's exact Create brief, selected output, exact wording, and selected style/content assets.

## Workflow

1. **Confirm route and fit briefly**
   - Artifact type: image/poster/brand visual/social graphic.
   - Must-haves: exact wording, selected reference images, required assets, style tags, and any prohibited styles.
   - Route: relevant Open Design skill(s), prompt templates, and design systems.
   - Keep the plan compact; do not turn it into the deliverable.

2. **Read relevant Open Design aids**
   - Image posters: `/opt/data/open-design/skills/image-poster/SKILL.md`.
   - Editorial/magazine treatment: `/opt/data/open-design/skills/magazine-poster/SKILL.md`.
   - Rebrand/logo concept boards: still use the image route, but treat the output as a visual identity sheet, not a generic poster. Prioritize the user's requested company name, logo lockups, icons, signwriting/mockups, palette, and prohibited legacy styling.
   - Use design systems that actually match the brief/style references (e.g. technical premium, editorial, mono, developer-tool minimalism). Do not let a default design system override the user's palette or taste.

3. **Research official sources when requested or implied**
   - Fetch the official homepage/docs/brand pages.
   - Extract title, meta description, `og:image`, `twitter:image`, logos, hero/background images, and visible product claims.
   - For rebrands, also inspect current signwriting/logo imagery, fleet/equipment photos, service categories, colors, typography, icon motifs, and obvious weaknesses to avoid. The prompt should preserve useful recognition cues while explicitly deleting dated effects.
   - Keep source copy concise and factual. Use official wording for support lines when possible.
   - Do not visibly paste meta descriptions or high-level brief text into the image unless it is intended copy.

4. **Prepare reference images correctly**
   - User-attached HermesChat media paths can be passed directly to `image_edit`.
   - Downloaded official images must be under an allowed Hermes data/chat path before `image_edit`, e.g. `/opt/data/<topic>-assets/`. The image tools reject `/tmp/...` references with `Image path must be under Hermes chat or data dirs`.
   - If references are only for style, state that in the prompt so the model does not insert them as literal content.
   - If references are official product/brand material, identify the specific cues to preserve: palette, logo/wordmark feel, background texture, typography, product surfaces, or iconography.

5. **Compose a structured prompt**
   - Intent and exact copy: title, tagline, optional support lines. Tell the model to omit tiny copy rather than garble it.
   - Reference handling: which images are style-only vs content/brand references.
   - Composition: subject, frame, layout, hierarchy, typography feel, palette, texture, lighting, and mood.
   - Product truth: official capabilities or claims discovered in research.
   - Negative constraints: no lorem ipsum, no misspelled brand, no generic mascot, no palette drift, no clutter, no overlap, no cut-off title, no unrelated literal use of style refs.

6. **Generate/edit the image**
   - Use `image_generate` for text-to-image with no references.
   - Use `image_edit` when the user supplied style/content images or official assets are being used as references.
   - Do not specify provider/model unless the active tool requires it; HermesChat/OpenRouter routing is configured by the gateway.

7. **Quality pass before final**
   - Resolve generated short handles like `tool_images/<file>.png` to `/opt/data/tool_images/<file>.png` if `vision_analyze` needs a local path.
   - Ask vision to check exact visible text, misspellings/gibberish, selected style adherence, palette, overlap, clipping, and obvious artifacts.
   - For logo/rebrand boards, verify every must-have separately: exact company-name spelling, primary lockup, standalone icon/monogram, service pictograms, signwriting/mockup, palette fidelity, and whether the result is truly minimal/premium rather than just polished clutter.
   - Derive monogram initials from the user's final requested brand name, not from a prior render or legacy name.
   - For flow diagrams/process graphics, explicitly ask vision to verify arrow logic and sequence, not just label spelling.
   - If the quality pass fails, regenerate with a corrected prompt rather than shipping a broken image.
   - If the first rebrand board is directionally good but too busy, use it as a reference for a second refinement pass that flattens gradients, removes decorative samples, reduces labels, and keeps only the required identity elements.
   - When the user likes a generated brand/logo board and asks to “do it again” with a corrected company name or wording, treat the attached prior output as a style/composition reference via `image_edit` rather than restarting research. Put the exact required brand text near the top of the prompt, list forbidden misspellings/legacy names, and tell the model to omit small copy rather than garble it. Then verify the visible text with `vision_analyze` before final.
   - When the user dislikes generated logo variants and supplies the “original icon we want,” make that original attached image the primary anchor. Do not keep drifting from earlier failed generations. Prompt for close preservation of the original composition, proportions, palette, bevel/flat treatment, typography/lockup structure, and only the requested initials/name change. Explicitly list elements to preserve and elements the user rejected (e.g. no jib/lattice/boom/truss; hook only if allowed). Verify legibility of each variant separately with `vision_analyze`, including whether a variant reads as the requested initials rather than an abstract shape.
   - If repeated image generations get text right but fail diagram logic/arrow routing, switch to a deterministic deliverable (SVG/HTML or PIL/vector drawing) instead of continuing prompt retries. Exact labels and logical flow matter more than photorealistic polish for systems diagrams.

8. **Final reply**
   - Keep it tight. Show/attach the image and optionally one sentence saying it was generated and passed the quality check.
   - Do not narrate every research step unless the user asks.

## Pitfalls

- `/tmp/...` downloaded assets are not valid `image_edit` references; copy them into `/opt/data/...` first.
- `tool_images/...` may display in chat but may not be accepted by analysis tools; use `/opt/data/tool_images/...` for verification.
- Style references should not become pasted content unless the brief explicitly asks.
- Image models often garble small text; constrain text to the required words and a few short support lines.
- Image models can spell labels correctly while still failing flow logic (ambiguous arrows, dead-end nodes, loops starting from the wrong stage). For exact process diagrams, prefer deterministic SVG/HTML/PIL composition after one or two failed prompt attempts.
- Rebrand/logo boards can look good while using the wrong monogram. Explicitly compute the initials from the final requested name and include a negative constraint for forbidden letters/shapes (e.g. “no K diagonal, no MK”).
- Avoid purple-dominant palettes for Dave unless the brief specifically requires purple.

## References

- See `references/image-product-poster-research.md` for a concise example workflow based on a Hermes Agent promotional magazine poster session.
- See `references/style-plus-remix-poster.md` for the pattern where one attached image is style-only and another is editable remix/source material for a finished poster.
- See `references/rebrand-logo-concept-board.md` for the site-researched rebrand/logo concept board pattern, including prompt structure and quality checks.
- See `references/rebrand-monogram-initials.md` for the specific pitfall of deriving/validating the correct logo initials after a brand-name change.
