"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentType,
  type FocusEvent,
  type PointerEvent,
  type RefObject,
  type SVGProps,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DatabaseIcon,
  DnaIcon,
  FileTextIcon,
  FileTypeIcon,
  GaugeIcon,
  Globe2Icon,
  Grid2X2Icon,
  ImageIcon,
  LockKeyholeIcon,
  MailIcon,
  MegaphoneIcon,
  MicIcon,
  MonitorIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  RocketIcon,
  Trash2Icon,
  VideoIcon,
  WandSparklesIcon,
  WrenchIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { Orb } from "@/components/ui/orb";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { AddingImageOverlay } from "@/components/AddingImageOverlay";
import { useSettings } from "@/app/chat/layout";
import type { CreativeStudioIntent } from "@/lib/creative-studio-session";
import type {
  CreateProductionAsset,
  CreateProductionBrief,
  CreateProductionMode,
} from "@/lib/create-production-types";
import { CHAT_AGENT_ORB_COLORS } from "@/lib/architect-orb-presets";
import { useDeepgramDictation } from "@/lib/use-deepgram-dictation";

type VaultPickRow = { slug: string; name: string; visibility?: string };
type PanelId = "template";
type OutputId =
  | "web"
  | "app_tool"
  | "document"
  | "presentation"
  | "email"
  | "marketing"
  | "image"
  | "video_motion"
  | "surprise";
type DocumentFormat = "pdf" | "docx" | "html";
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;
type ImageKind = "theme" | "include" | "use";
type RawFileRole = "data" | "refactor" | "restyle" | "style_source";
type ClientTab = "clients" | "company";
type ProfileUseMode = "recipient" | "mention" | "context";
type DataVaultTab = "private" | "shared";
type CreateVoiceTarget = "prompt" | "sourceMaterial" | "exactCopy";
type TemplateCarryOption =
  | "auto"
  | "structure"
  | "content_categories"
  | "typography"
  | "image_placement"
  | "theme"
  | "tone"
  | "tables";
type TemplateReferenceTab = "templates" | "design";
type DesignDnaCarryOption =
  | "layout"
  | "spacing"
  | "components"
  | "typography"
  | "palette"
  | "density"
  | "mobile"
  | "motion";
type DesignDnaStrength = "light" | "strong" | "blueprint";
type ThemeFocus =
  | "mood"
  | "palette"
  | "brand_feel"
  | "typography"
  | "layout"
  | "texture"
  | "contrast"
  | "composition";
type ThemeAnalysisKey =
  | "mood"
  | "palette"
  | "brandFeel"
  | "typography"
  | "layout"
  | "texture"
  | "contrast"
  | "composition";
type IncludePlacement =
  | "auto"
  | "exact"
  | "hero"
  | "fade_text"
  | "background_wash"
  | "cutout_foreground"
  | "card_image"
  | "gallery"
  | "logo_lockup"
  | "section_divider"
  | "comparison"
  | "framed_feature"
  | "header"
  | "match_text"
  | "inline"
  | "background"
  | "logo";
type UseTreatment =
  | "auto_adapt"
  | "remix"
  | "crop_reframe"
  | "recolor_restyle"
  | "cutout_composite"
  | "background_material"
  | "clean_enhance"
  | "extract_elements";
type ImageTag = ThemeFocus | IncludePlacement | UseTreatment;
type ImageTagOption = { id: ImageTag; label: string };

type LegacyIncludePlacement =
  | "header"
  | "match_text"
  | "inline"
  | "background"
  | "logo";

type ThemePaletteColor = {
  hex: string;
  name?: string;
  role?: string;
};

type ThemeImageAnalysis = {
  summary: string;
  mood: string;
  palette: string;
  brandFeel: string;
  typography: string;
  layout: string;
  texture: string;
  contrast: string;
  composition: string;
  colors: ThemePaletteColor[];
  source?: "vision" | "palette-fallback";
};

type OutputOption = {
  id: OutputId;
  label: string;
  intent: CreativeStudioIntent;
  icon: IconComponent;
  covers: string;
  skills: string[];
};

type OutputSubchoice = {
  id: string;
  label: string;
  detail?: string;
  routeHint?: string;
};

type CreateExtraRoute = {
  id: string;
  label: string;
  detail: string;
  compatible: OutputId[];
  compatibleSubchoices?: Partial<Record<OutputId, string[]>>;
  excludedSubchoices?: Partial<Record<OutputId, string[]>>;
  routeHint: string;
};

const OUTPUT_OPTIONS: OutputOption[] = [
  {
    id: "web",
    label: "Web",
    intent: "web_app",
    icon: Globe2Icon,
    covers: "Landing pages, websites, pricing pages, docs pages, blog posts, web prototypes, and HTML pages.",
    skills: ["saas-landing", "web-prototype", "pricing-page", "docs-page", "blog-post", "hifi_html", "html-ppt-*"],
  },
  {
    id: "app_tool",
    label: "App / Tool",
    intent: "web_app",
    icon: WrenchIcon,
    covers: "Interactive tools, dashboards, calculators, portals, mobile app mockups, onboarding flows, kanban boards, and gamified apps.",
    skills: ["dashboard", "mobile-app", "mobile-onboarding", "kanban-board", "gamified-app", "web-prototype"],
  },
  {
    id: "document",
    label: "Document",
    intent: "business_pdf",
    icon: FileTextIcon,
    covers: "PDFs, DOCX, reports, proposals, guides, specs, invoices, meeting notes, onboarding packs, and runbooks.",
    skills: ["finance-report", "digital-eguide", "pm-spec", "invoice", "meeting-notes", "hr-onboarding", "eng-runbook", "docs-page"],
  },
  {
    id: "presentation",
    label: "Presentation",
    intent: "deck",
    icon: MonitorIcon,
    covers: "Pitch presentations, product launches, weekly reports, technical talks, training modules, and safety or risk briefings.",
    skills: ["html-ppt", "guizang-ppt", "simple-deck", "replit-deck", "html-ppt-pitch-deck", "html-ppt-product-launch", "html-ppt-weekly-report", "html-ppt-tech-sharing", "html-ppt-course-module"],
  },
  {
    id: "email",
    label: "Email",
    intent: "email",
    icon: MailIcon,
    covers: "Inbox-safe one-to-one emails, client follow-ups, announcements, lightweight newsletters, and sendable HTML/plain-text email packages.",
    skills: ["inbox-safe copy", "lightweight HTML email", "document patterns"],
  },
  {
    id: "marketing",
    label: "Marketing",
    intent: "hifi_html",
    icon: MegaphoneIcon,
    covers: "Social posts, carousels, posters, campaign pages, e-guides, blog posts, and promo assets.",
    skills: ["social-carousel", "image-poster", "magazine-poster", "digital-eguide", "blog-post", "email-marketing", "saas-landing"],
  },
  {
    id: "image",
    label: "Image",
    intent: "image",
    icon: ImageIcon,
    covers: "Posters, brand visuals, product graphics, social visuals, concept images, bitmap generation, and image editing.",
    skills: ["image-poster", "social-carousel", "magazine-poster", "prompt-templates/image", "image generation/editing"],
  },
  {
    id: "video_motion",
    label: "Video / Motion",
    intent: "motion",
    icon: VideoIcon,
    covers: "Short storyboarded motion, timed HTML scenes, restrained motion frames, title cards, and sprite-style explainers.",
    skills: ["hyperframes", "motion-frames", "sprite-animation"],
  },
  {
    id: "surprise",
    label: "Surprise Me",
    intent: "surprise",
    icon: WandSparklesIcon,
    covers: "When you know roughly what you want and want Hermes to pick the best format.",
    skills: ["broad router", "best-fit Open Design skill", "format selection"],
  },
];

const CREATE_EXTRA_ROUTES: CreateExtraRoute[] = [
  {
    id: "motion-polish",
    label: "Motion polish",
    detail: "Add animation direction, kinetic transitions, or a motion-ready hero.",
    compatible: ["web", "app_tool", "presentation", "marketing", "video_motion", "surprise"],
    compatibleSubchoices: {
      marketing: ["surprise", "saas-landing"],
    },
    routeHint:
      "Layer in Open Design `motion-frames` or `sprite-animation` for code-based animation direction. Use `hyperframes` only for code-rendered motion graphics when renderer support is available. Do not use external text-to-video providers.",
  },
  {
    id: "interactive-flow",
    label: "Interactive flow",
    detail: "Add prototype behavior, controls, dashboard states, or app-like navigation.",
    compatible: ["web", "app_tool", "presentation", "marketing", "surprise"],
    compatibleSubchoices: {
      marketing: ["surprise", "saas-landing"],
    },
    routeHint:
      "Layer in Open Design `web-prototype`, `dashboard`, `mobile-app`, `mobile-onboarding`, or `gamified-app` when the requested artifact benefits from interactive behavior.",
  },
  {
    id: "visual-system",
    label: "Visual system",
    detail: "Add stronger art direction, layout language, and reusable visual rules.",
    compatible: ["web", "app_tool", "document", "presentation", "email", "marketing", "image", "video_motion", "surprise"],
    routeHint:
      "Layer in Open Design design-system scouting and, when useful, `image-poster`, `magazine-poster`, or `social-carousel` for composition/style direction. Use the actual image tool only for bitmap outputs.",
  },
  {
    id: "review-pass",
    label: "Review pass",
    detail: "Add a critique/tweaks pass before shipping.",
    compatible: ["web", "app_tool", "document", "presentation", "email", "marketing", "image", "video_motion", "surprise"],
    routeHint:
      "After drafting, use Open Design `critique` and `tweaks` patterns to catch layout, clarity, accessibility, and finish issues before publishing.",
  },
];

const DOCUMENT_FORMAT_OPTIONS: {
  id: DocumentFormat;
  label: string;
  intent: CreativeStudioIntent;
}[] = [
  { id: "pdf", label: "PDF", intent: "business_pdf" },
  { id: "docx", label: "DOCX", intent: "docx" },
  { id: "html", label: "HTML preview", intent: "hifi_html" },
];

const MAX_THEME_IMAGE_SIZE = 20 * 1024 * 1024;
const CREATE_TIP_DELAY_MS = 1300;
const CREATE_STUDIO_DRAFT_KEY = "hermeschat:create-studio:draft:v1";
const DEFAULT_CREATE_PRODUCTION_MODE: CreateProductionMode = "frontier";

function outputDisplayName(output: OutputOption): string {
  switch (output.id) {
    case "web":
      return "Website / HTML";
    case "app_tool":
      return "App / tool";
    case "document":
      return "Document";
    case "presentation":
      return "Presentation";
    case "marketing":
      return "Marketing";
    case "video_motion":
      return "Video / motion";
    case "surprise":
      return "Surprise me";
    case "image":
      return "Image";
    case "email":
      return "Email";
    default:
      return output.label;
  }
}

function isOutputId(value: string | undefined): value is OutputId {
  return Boolean(value && OUTPUT_OPTIONS.some((option) => option.id === value));
}

function documentFormatFromBrief(value: string | undefined): DocumentFormat | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("docx") || normalized.includes("word")) return "docx";
  if (normalized.includes("html")) return "html";
  if (normalized.includes("pdf")) return "pdf";
  return undefined;
}

function optionIdsFromLabels<T extends string>(
  labels: string[] | undefined,
  options: { id: T; label: string }[],
  fallback: T[] = []
): T[] {
  if (!labels?.length) return fallback;
  const normalized = labels.map((label) => label.trim().toLowerCase()).filter(Boolean);
  const ids = options
    .filter((option) =>
      normalized.some(
        (label) => label === option.id.toLowerCase() || label === option.label.toLowerCase()
      )
    )
    .map((option) => option.id);
  return ids.length ? ids : fallback;
}

function mediumDnaGuidance(output: OutputOption, documentFormat?: DocumentFormat): string {
  if (output.id === "document") {
    const label =
      documentFormat === "docx"
        ? "DOCX"
        : documentFormat === "html"
          ? "HTML document"
          : "PDF";
    return `${label}: translate DNA into page rhythm, typography hierarchy, section spacing, callouts, tables, charts, headers/footers, and reading flow. Avoid web-only chrome unless the selected format is HTML.`;
  }
  if (output.id === "presentation") {
    return "Presentation: translate DNA into slide rhythm, title/body hierarchy, composition grids, charts, section breaks, image treatment, and speaker-readable density.";
  }
  if (output.id === "email") {
    return "Email: translate DNA into inbox-safe hierarchy, human copy, one clear CTA, light palette, restrained blocks, and mobile-friendly structure.";
  }
  if (output.id === "image") {
    return "Image: translate DNA into palette, composition, type attitude, material texture, contrast, and visual density rather than web components.";
  }
  if (output.id === "video_motion") {
    return "Video/motion: translate DNA into frame composition, title treatment, pacing, transitions, palette, and motion restraint.";
  }
  if (output.id === "marketing") {
    return "Marketing: translate DNA into campaign layout, message hierarchy, proof blocks, visual system, CTA treatment, and mobile composition.";
  }
  return "Web/app: translate DNA into layout grid, spacing, components, typography, palette, density, interaction states, and responsive mobile behavior.";
}

function skillChoiceLabel(skill: string): string {
  if (skill === "hifi_html") return "Polished HTML";
  if (skill === "html-ppt-*") return "Best HTML deck";
  if (skill === "pm-spec") return "Product Spec";
  if (skill === "prompt-templates/image") return "Image prompt";
  if (skill === "image generation/editing") return "Generation / edit";
  if (skill === "copy patterns") return "Copywriting pattern";
  if (skill === "document patterns") return "Document pattern";
  if (skill === "broad router") return "Broad router";
  if (skill === "best-fit Open Design skill") return "Best-fit skill";
  if (skill === "format selection") return "Format selection";
  return skill
    .split("-")
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function skillChoiceDetail(skill: string): string | undefined {
  const details: Record<string, string> = {
    "pdf-generation-pymupdf":
      "Formal reports, tenders, letters, and polished PDF-style documents.",
    "saas-landing":
      "Single-page product or service landing page with hero, proof, pricing, and CTA.",
    "web-prototype":
      "A general-purpose HTML page or clickable prototype when the format is flexible.",
    "pricing-page":
      "Plan tiers, feature comparison, FAQs, and subscription/package positioning.",
    "docs-page":
      "Documentation, guides, tutorials, API-style references, or knowledge pages.",
    "blog-post":
      "Long-form article, case study, essay, newsletter post, or editorial page.",
    hifi_html:
      "A high-fidelity HTML page with refined layout, styling, responsive polish, and a finished feel.",
    dashboard:
      "Operational screen with KPIs, charts, tables, filters, and scan-friendly status.",
    "mobile-app":
      "A phone-screen app mockup for one focused mobile product experience.",
    "mobile-onboarding":
      "Multi-screen phone onboarding with value props, sign-in, and first-run flow.",
    "kanban-board":
      "Task board with columns, cards, assignees, filters, and project workflow.",
    "gamified-app":
      "Game-like app concept with quests, progress, streaks, levels, or rewards.",
    "finance-report":
      "Financial report with KPIs, charts, tables, highlights, and outlook notes.",
    "digital-eguide":
      "Guide, playbook, lookbook, lead magnet, or polished multi-section handout.",
    "pm-spec":
      "Product/feature spec with problem, scope, user stories, rollout, and questions.",
    invoice:
      "Printable invoice or billing statement with line items, totals, and payment notes.",
    "meeting-notes":
      "Meeting minutes with agenda, decisions, action items, owners, and next steps.",
    "hr-onboarding":
      "Onboarding plan with schedule, learning track, checklist, and success outcomes.",
    "eng-runbook":
      "Runbook or ops guide with alerts, procedures, commands, and response steps.",
    "html-ppt":
      "Professional HTML slide deck with templates, layouts, and keyboard navigation.",
    "html-ppt-*":
      "Let Hermes choose the best HTML deck template for the presentation brief.",
    "guizang-ppt":
      "Editorial magazine-style presentation with horizontal paging and strong art direction.",
    "simple-deck":
      "Clean horizontal HTML deck for pitches, reports, lessons, or product overviews.",
    "replit-deck":
      "Replit-inspired slide style with a strong preset theme and polished deck system.",
    "html-ppt-pitch-deck":
      "Investor or fundraising deck with traction, story, ask, and sharp numbers.",
    "html-ppt-product-launch":
      "Launch keynote for a product, feature reveal, announcement, or pricing story.",
    "html-ppt-weekly-report":
      "Team status deck with KPI grid, shipped list, charts, plans, and risks.",
    "html-ppt-tech-sharing":
      "Engineering or technical talk deck with agenda, code blocks, and Q&A flow.",
    "html-ppt-course-module":
      "Training or workshop module with learning goals, lesson flow, and self-checks.",
    "email-marketing":
      "Inbox-safe HTML/plain-text email package, newsletter, announcement, product update, or client follow-up.",
    "inbox-safe copy":
      "Human, honest subject/preheader/body copy that avoids spammy campaign patterns.",
    "lightweight HTML email":
      "Light, inline-styled HTML email that still reads well if images or CSS are stripped.",
    "copy patterns":
      "Use copywriting structure when the output needs clearer messaging or persuasion.",
    "document patterns":
      "Borrow document structure when the email needs sections, logic, or formality.",
    "social-carousel":
      "Multi-card social post or carousel for Instagram, LinkedIn, X, or campaign visuals.",
    "image-poster":
      "Single static poster, key art, cover visual, or editorial illustration.",
    "magazine-poster":
      "Editorial poster with strong headline, sections, captions, and magazine layout.",
    "prompt-templates/image":
      "Shape a stronger image-generation prompt before creating or editing the visual.",
    "image generation/editing":
      "Generate or edit bitmap image output rather than an HTML layout.",
    hyperframes:
      "Timed HTML composition with a short scene list, captions, and controlled transitions.",
    "motion-frames":
      "One focused animated hero, title card, loop, or motion-design frame built with web code.",
    "sprite-animation":
      "Pixel-art or retro explainer loop with simple sprites, readable labels, and restrained CSS motion.",
    "broad router":
      "Let Hermes choose the route when the exact output type should stay flexible.",
    "best-fit Open Design skill":
      "Use the closest available creation workflow once the brief is clearer.",
    "format selection":
      "Let Hermes pick the best final format for the job.",
  };
  return details[skill];
}

function outputSubchoices(output: OutputOption): OutputSubchoice[] {
  if (output.id === "video_motion") {
    return [
      {
        id: "surprise",
        label: "Storyboard first",
        detail: "Let Hermes pick the leanest route after planning 2-4 beats.",
        routeHint:
          "For motion, first write a private motion recipe with aspect ratio, duration, 2-4 beats, one primary message, one hero subject/asset, palette, type scale, and movement vocabulary. Do not visibly use every selected input.",
      },
      {
        id: "hyperframes",
        label: "Timed scenes",
        detail: "Short HTML composition with captions and controlled transitions.",
        routeHint:
          "Use Open Design `hyperframes` only for a timed 2-4 scene composition. Keep captions short, use one transition vocabulary, and export MP4/GIF only if the render pipeline is verified.",
      },
      {
        id: "motion-frames",
        label: "Motion frame",
        detail: "One animated hero, title card, loop, or motion-design frame.",
        routeHint:
          "Use Open Design `motion-frames` for a single focused animated frame or loop. Limit the design to one visual motif, one primary message, and a small number of moving parts.",
      },
      {
        id: "sprite-animation",
        label: "Sprite loop",
        detail: "Retro explainer loop with simple sprites and readable labels.",
        routeHint:
          "Use Open Design `sprite-animation` for a small sprite-style explainer. Keep the scene simple, make silhouettes readable, and avoid dense text or many simultaneous loops.",
      },
    ];
  }
  const documentRoutes: OutputSubchoice[] =
        output.id === "document"
      ? [
          {
            id: "pdf-generation-pymupdf",
            label: "Tender / formal doc",
            detail:
              "Formal reports, tenders, proposals, letters, and polished PDF-style documents.",
            routeHint:
              "Use Hermes main skill `pdf-generation-pymupdf` for formal PDFs such as reports, tenders, and letters. This skill lives in `/root/hermes-stack/hermes-data/skills/pdf-generation-pymupdf/SKILL.md`; use Open Design only for layout/art direction if useful.",
          },
        ]
      : [];
  return [
    {
      id: "surprise",
      label: "Surprise me",
      detail: "Let Hermes pick the best route for this category.",
    },
    ...documentRoutes,
    ...output.skills.map((skill) => ({
      id: skill,
      label: skillChoiceLabel(skill),
      detail: skillChoiceDetail(skill),
    })),
  ];
}

function createExtraRouteFitsSelection(
  route: CreateExtraRoute,
  outputId: OutputId,
  subchoiceId: string
) {
  if (!route.compatible.includes(outputId)) return false;
  const allowedSubchoices = route.compatibleSubchoices?.[outputId];
  if (allowedSubchoices && !allowedSubchoices.includes(subchoiceId)) return false;
  const excludedSubchoices = route.excludedSubchoices?.[outputId];
  if (excludedSubchoices?.includes(subchoiceId)) return false;
  return true;
}

const THEME_FOCUS_OPTIONS: { id: ThemeFocus; label: string }[] = [
  { id: "mood", label: "Mood" },
  { id: "palette", label: "Palette" },
  { id: "brand_feel", label: "Brand feel" },
  { id: "typography", label: "Typography" },
  { id: "layout", label: "Layout" },
  { id: "texture", label: "Texture" },
  { id: "contrast", label: "Contrast" },
  { id: "composition", label: "Composition" },
];

const INCLUDE_PLACEMENTS: { id: IncludePlacement; label: string }[] = [
  { id: "auto", label: "Auto place" },
  { id: "exact", label: "Exact" },
  { id: "hero", label: "Hero" },
  { id: "fade_text", label: "Fade beside text" },
  { id: "background_wash", label: "Background wash" },
  { id: "cutout_foreground", label: "Cutout" },
  { id: "card_image", label: "Card" },
  { id: "gallery", label: "Gallery" },
  { id: "logo_lockup", label: "Logo / lockup" },
  { id: "section_divider", label: "Divider" },
  { id: "comparison", label: "Before/after" },
  { id: "framed_feature", label: "Framed feature" },
];

const USE_IMAGE_TREATMENTS: { id: UseTreatment; label: string }[] = [
  { id: "auto_adapt", label: "Auto adapt" },
  { id: "remix", label: "Remix" },
  { id: "crop_reframe", label: "Crop / reframe" },
  { id: "recolor_restyle", label: "Recolor / restyle" },
  { id: "cutout_composite", label: "Cutout / composite" },
  { id: "background_material", label: "Background material" },
  { id: "clean_enhance", label: "Clean / enhance" },
  { id: "extract_elements", label: "Extract elements" },
];

const PROFILE_USE_OPTIONS: {
  id: ProfileUseMode;
  label: string;
  promptLabel: string;
  hint: string;
}[] = [
  {
    id: "recipient",
    label: "Recipient",
    promptLabel: "recipient",
    hint: "Make this person the main audience for the output.",
  },
  {
    id: "mention",
    label: "Mention",
    promptLabel: "mention",
    hint: "Use this person by name only where it fits.",
  },
  {
    id: "context",
    label: "Take into account",
    promptLabel: "context",
    hint: "Use their details as background guidance.",
  },
];

type CreateImageAsset = {
  id: string;
  name: string;
  previewUrl: string;
  serverUrl: string;
  toolPath?: string;
  caption: string;
  tags: ImageTag[];
  analysis?: ThemeImageAnalysis;
};

type VaultFileRow = {
  name: string;
  relativePath: string;
  size: number;
  assetRole?: string | null;
};

type RawCreateFile = {
  id: string;
  name: string;
  url: string;
  toolPath?: string;
  mimeType: string;
  size: number;
  role: RawFileRole;
};

type CreateStudioDraft = {
  prompt?: string;
  sourceMaterial?: string;
  exactCopy?: string;
  outputId?: OutputId;
  documentFormat?: DocumentFormat;
  outputSubchoiceById?: Partial<Record<OutputId, string>>;
  extraRouteIds?: string[];
  themeImages?: CreateImageAsset[];
  includeImages?: CreateImageAsset[];
  useImages?: CreateImageAsset[];
  dataNotes?: string;
  dataVaultSlug?: string;
  dataVaultWhole?: boolean;
  dataVaultTab?: DataVaultTab;
  selectedVaultFilePaths?: string[];
  rawFiles?: RawCreateFile[];
  manualProfiles?: CreatePersonProfile[];
  selectedProfileIds?: string[];
  profileUseById?: Record<string, ProfileUseMode>;
  profileEdits?: Record<string, Partial<CreatePersonProfile>>;
  selectedTemplateId?: string;
  templateCarry?: TemplateCarryOption[];
  selectedDesignDnaIds?: string[];
  designDnaCarry?: DesignDnaCarryOption[];
  designDnaStrength?: DesignDnaStrength;
  selectedPatternId?: string;
  templateReferenceTab?: TemplateReferenceTab;
  reviewBriefDraft?: string;
  selectedTuneIds?: string[];
};

type CreateDesignDnaRow = {
  id: string;
  slug: string;
  name: string;
  category?: string;
  description?: string;
  path: string;
  updatedAt: number;
};

type CreatePatternRow = {
  id: string;
  name: string;
  outputId: string;
  outputLabel: string;
  subtypeId: string;
  subtypeLabel: string;
  documentFormat?: string;
  createdAt: string;
  updatedAt: string;
  createBrief: CreateProductionBrief;
  resultNotes?: string;
};

type BrainPeopleApiProfileRow = {
  id: string;
  name: string;
  profileClass: string;
  company: string;
  role: string;
  emails: string[];
  phones: string[];
  summary: string;
  vaultSlug: string;
  vaultName: string;
  evidencePaths: string[];
  confidence: string;
  updatedAt: string;
};

type CreatePersonProfile = {
  id: string;
  kind: ClientTab;
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  source: "manual" | "brain";
  vaultSlug?: string;
  vaultName?: string;
  profileClass?: string;
  evidencePaths?: string[];
  confidence?: string;
};

type ProfileEditDraft = {
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
};

type CreateTemplateRow = {
  id: string;
  name: string;
  sourceStem: string;
  vaultSlug: string;
  vaultName: string;
  outlinePath: string;
  structurePath: string;
  updatedAt: number;
};

type CreateTipState = {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

type CreateTuneCategory = "Finish" | "Style" | "Content" | "Layout";
type CreateTuneTag = {
  id: string;
  label: string;
  category: CreateTuneCategory;
  profile: string;
};

const CREATE_TUNE_SECTION_TITLE = "Creative direction:";

const CREATE_TUNE_TAGS: CreateTuneTag[] = [
  {
    id: "professional",
    label: "Professional",
    category: "Finish",
    profile:
      "Keep the result credible, practical, and ready for real people. Use clear hierarchy, restrained styling, and confident wording.",
  },
  {
    id: "polished",
    label: "Polished",
    category: "Finish",
    profile:
      "Refine the details so it feels finished: balanced spacing, clean alignment, thoughtful transitions, and no rough placeholder energy.",
  },
  {
    id: "premium",
    label: "Premium",
    category: "Finish",
    profile:
      "Make it feel high-value with selective detail, strong contrast, elegant spacing, and a more considered visual system.",
  },
  {
    id: "grungy",
    label: "Grungy",
    category: "Style",
    profile:
      "Add controlled grit and texture while keeping it readable. Use imperfect edges, raw contrast, and a less corporate finish.",
  },
  {
    id: "bold",
    label: "Bold",
    category: "Style",
    profile:
      "Push the visual confidence: stronger type, clearer contrast, decisive sections, and fewer timid middle-ground choices.",
  },
  {
    id: "minimal",
    label: "Minimal",
    category: "Style",
    profile:
      "Strip it back to the essentials. Prioritize whitespace, plain structure, calm visual rhythm, and only the details that earn their place.",
  },
  {
    id: "editorial",
    label: "Editorial",
    category: "Style",
    profile:
      "Treat it like a designed publication: strong headlines, considered pacing, image-led moments, and page-like composition.",
  },
  {
    id: "concise",
    label: "Concise",
    category: "Content",
    profile:
      "Keep the copy tight and useful. Remove filler, make points quickly, and favor scannable wording over long explanations.",
  },
  {
    id: "persuasive",
    label: "Persuasive",
    category: "Content",
    profile:
      "Shape the content around a clear reason to care, a logical flow, benefits, proof points, and an obvious next step.",
  },
  {
    id: "client_ready",
    label: "Send-ready",
    category: "Content",
    profile:
      "Make it suitable to share without extra cleanup. Avoid internal shorthand and make assumptions explicit.",
  },
  {
    id: "more_visual",
    label: "More visual",
    category: "Layout",
    profile:
      "Use visual hierarchy, sections, cards, diagrams, image moments, or callouts so the result is easier to scan and remember.",
  },
  {
    id: "mobile_first",
    label: "Mobile-first",
    category: "Layout",
    profile:
      "Prioritize phone usability: clear tap targets, readable type, simple scrolling, and layouts that do not rely on wide screens.",
  },
];

const MOTION_CREATE_BRIEF_RULES = [
  "Motion works best with fewer inputs: one goal, one visual style, one hero subject or asset, and 2-4 beats.",
  "Use source material as planning fuel, not screen copy. Turn it into short captions or a tiny storyboard.",
  "Theme images, DNA, templates, files, and people are context unless you explicitly say they must appear.",
] as const;

const RAW_FILE_ROLES: { id: RawFileRole; label: string; hint: string }[] = [
  { id: "data", label: "Use data", hint: "Read useful facts from this file." },
  {
    id: "refactor",
    label: "Refactor doc",
    hint: "Keep the main content, but tidy the shape and layout.",
  },
  {
    id: "restyle",
    label: "Restyle doc",
    hint: "Keep the content close, but match the style choices here.",
  },
  {
    id: "style_source",
    label: "Style source",
    hint: "Use this as inspiration for look, tone, or structure.",
  },
];

const ORG_GLOBAL_SLUG =
  process.env.NEXT_PUBLIC_HERMES_ORG_GLOBAL_SLUG?.trim() || "org-global";

const TEMPLATE_CARRY_OPTIONS: {
  id: TemplateCarryOption;
  label: string;
  hint: string;
}[] = [
  {
    id: "auto",
    label: "Auto",
    hint: "Let Hermes decide what is useful.",
  },
  {
    id: "structure",
    label: "Structure",
    hint: "Follow the same order and section layout.",
  },
  {
    id: "content_categories",
    label: "Content categories",
    hint: "Use the same kinds of sections.",
  },
  {
    id: "typography",
    label: "Typography",
    hint: "Match the text style and heading feel.",
  },
  {
    id: "image_placement",
    label: "Image placement",
    hint: "Put images in similar places.",
  },
  {
    id: "theme",
    label: "Theme",
    hint: "Match the overall visual feel.",
  },
  {
    id: "tone",
    label: "Tone",
    hint: "Match how formal or friendly it sounds.",
  },
  {
    id: "tables",
    label: "Tables/lists",
    hint: "Use similar tables, lists, and checklists.",
  },
];

const DESIGN_DNA_CARRY_OPTIONS: {
  id: DesignDnaCarryOption;
  label: string;
  hint: string;
}[] = [
  {
    id: "layout",
    label: "Layout",
    hint: "Borrow page structure, section flow, and composition.",
  },
  {
    id: "spacing",
    label: "Spacing",
    hint: "Use similar rhythm, gutters, density, and whitespace.",
  },
  {
    id: "components",
    label: "Components",
    hint: "Match the feel of buttons, cards, nav, forms, and surfaces.",
  },
  {
    id: "typography",
    label: "Typography",
    hint: "Use the same hierarchy and text feel without requiring exact fonts.",
  },
  {
    id: "palette",
    label: "Palette",
    hint: "Use similar color roles where it fits the new brief.",
  },
  {
    id: "density",
    label: "Density",
    hint: "Match how compact or spacious the screens feel.",
  },
  {
    id: "mobile",
    label: "Mobile",
    hint: "Carry over mobile stacking, tap targets, and responsive behavior.",
  },
  {
    id: "motion",
    label: "Motion",
    hint: "Borrow transition, hover, and interaction feel.",
  },
];

const DEFAULT_DESIGN_DNA_CARRY: DesignDnaCarryOption[] = [
  "layout",
  "spacing",
  "components",
  "typography",
  "mobile",
];

const DESIGN_DNA_STRENGTH_OPTIONS: {
  id: DesignDnaStrength;
  label: string;
  hint: string;
}[] = [
  {
    id: "light",
    label: "Light hint",
    hint: "Use as subtle taste guidance.",
  },
  {
    id: "strong",
    label: "Strong guidance",
    hint: "Let this visibly shape the result.",
  },
  {
    id: "blueprint",
    label: "Blueprint",
    hint: "Use as the primary layout and style reference.",
  },
];

export type CreateStudioIntentDialogProps = {
  open: boolean;
  onCancel: () => void;
  onContinue: (
    intent: CreativeStudioIntent,
    seedPrompt: string,
    referenceVault: { slug: string; name: string } | null,
    createBrief: CreateProductionBrief
  ) => void;
  busy?: boolean;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorNameFromRgb(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 510;
  if (max - min < 18) {
    if (light < 0.16) return "black";
    if (light > 0.84) return "white";
    return light < 0.45 ? "charcoal" : "grey";
  }
  const hue =
    max === r
      ? ((g - b) / (max - min)) % 6
      : max === g
        ? (b - r) / (max - min) + 2
        : (r - g) / (max - min) + 4;
  const deg = (hue * 60 + 360) % 360;
  if (deg < 18 || deg >= 345) return light < 0.42 ? "deep red" : "red";
  if (deg < 45) return light < 0.5 ? "burnt orange" : "orange";
  if (deg < 72) return light < 0.58 ? "ochre" : "yellow";
  if (deg < 160) return light < 0.45 ? "forest green" : "green";
  if (deg < 205) return light < 0.48 ? "teal" : "cyan";
  if (deg < 260) return light < 0.45 ? "navy" : "blue";
  if (deg < 305) return light < 0.45 ? "purple" : "violet";
  return light < 0.45 ? "burgundy" : "magenta";
}

function paletteRole(index: number) {
  if (index === 0) return "dominant";
  if (index === 1) return "secondary";
  if (index === 2) return "accent";
  return "supporting";
}

async function extractLocalImagePalette(dataUrl: string): Promise<ThemePaletteColor[]> {
  if (typeof window === "undefined") return [];
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
  const maxSide = 84;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 16) {
    const alpha = pixels[i + 3] ?? 255;
    if (alpha < 120) continue;
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const qr = Math.round(r / 24) * 24;
    const qg = Math.round(g / 24) * 24;
    const qb = Math.round(b / 24) * 24;
    const key = `${qr},${qg},${qb}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { count: 1, r: qr, g: qg, b: qb });
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 7)
    .map((color, index) => ({
      hex: rgbToHex(color.r, color.g, color.b),
      name: colorNameFromRgb(color.r, color.g, color.b),
      role: paletteRole(index),
    }));
}

async function analyzeThemeImage(
  imageId: string,
  colors: ThemePaletteColor[]
): Promise<ThemeImageAnalysis | undefined> {
  const res = await fetch("/api/create-assets/theme-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageId, colors }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    analysis?: ThemeImageAnalysis;
    error?: string;
  };
  if (!res.ok || !data.analysis) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Could not read style reference"
    );
  }
  return data.analysis;
}

async function uploadCreateImage(
  file: File,
  kind: ImageKind
): Promise<CreateImageAsset> {
  const dataUrl = await fileToDataUrl(file);
  const localPalette =
    kind === "theme" ? await extractLocalImagePalette(dataUrl).catch(() => []) : [];
  const res = await fetch("/api/images/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    toolPath?: string;
    error?: string;
  };
  if (!res.ok || typeof data.url !== "string") {
    throw new Error(
      typeof data.error === "string" ? data.error : "Could not upload image"
    );
  }
  const id =
    typeof data.id === "string" && data.id.trim()
      ? data.id.trim()
      : `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`;
  const analysis =
    kind === "theme" ? await analyzeThemeImage(id, localPalette).catch(() => undefined) : undefined;
  return {
    id,
    name: file.name,
    previewUrl: data.url,
    serverUrl: data.url,
    ...(typeof data.toolPath === "string" && data.toolPath.trim()
      ? { toolPath: data.toolPath.trim() }
      : {}),
    caption: "",
    tags:
      kind === "theme"
        ? ["mood"]
        : kind === "use"
          ? ["auto_adapt"]
          : ["auto"],
    ...(analysis ? { analysis } : {}),
  };
}

function isFinishedDocRole(role: RawFileRole): boolean {
  return role === "refactor" || role === "restyle";
}

async function uploadRawCreateFile(
  file: File,
  role: RawFileRole = "data"
): Promise<RawCreateFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/create-assets/upload", {
    method: "POST",
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    url?: string;
    toolPath?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  };
  if (!res.ok || !data.id || !data.url || !data.name) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Could not upload file"
    );
  }
  return {
    id: data.id,
    name: data.name,
    url: data.url,
    ...(typeof data.toolPath === "string" && data.toolPath.trim()
      ? { toolPath: data.toolPath.trim() }
      : {}),
    mimeType: data.mimeType || file.type || "application/octet-stream",
    size: typeof data.size === "number" ? data.size : file.size,
    role,
  };
}

function formatCompactBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readableCreateFileName(
  rawName: string,
  fallbackBase: string,
  index?: number
): string {
  const name = rawName.trim();
  const extMatch = name.match(/\.([a-z0-9]{2,5})$/i);
  const ext = extMatch?.[1]?.toLowerCase() || "png";
  const stem = extMatch ? name.slice(0, -extMatch[0].length) : name;
  const looksGenerated =
    !stem ||
    /^[a-f0-9-]{20,}$/i.test(stem) ||
    /^[a-z0-9_-]{24,}$/i.test(stem) ||
    /^[a-z0-9_-]{8,}-[a-z0-9_-]{8,}/i.test(stem);
  if (!looksGenerated && name) return name;
  const suffix = typeof index === "number" && index > 0 ? ` ${index + 1}` : "";
  return `${fallbackBase}${suffix}.${ext}`;
}

const LEGACY_INCLUDE_LABELS: Record<LegacyIncludePlacement, string> = {
  header: "Header",
  match_text: "Match text",
  inline: "Inline",
  background: "Background",
  logo: "Logo",
};

function imageTagOptions(kind: ImageKind): ImageTagOption[] {
  if (kind === "theme") return THEME_FOCUS_OPTIONS;
  if (kind === "include") return INCLUDE_PLACEMENTS;
  return USE_IMAGE_TREATMENTS;
}

function imageTagLabel(tag: ImageTag): string | undefined {
  const option = [
    ...THEME_FOCUS_OPTIONS,
    ...INCLUDE_PLACEMENTS,
    ...USE_IMAGE_TREATMENTS,
  ].find((item) => item.id === tag);
  if (option) return option.label;
  if (tag in LEGACY_INCLUDE_LABELS) {
    return LEGACY_INCLUDE_LABELS[tag as LegacyIncludePlacement];
  }
  return undefined;
}

function imageTagLabels(_kind: ImageKind, tags: ImageTag[]): string[] {
  return tags
    .map((tag) => imageTagLabel(tag))
    .filter((label): label is string => Boolean(label));
}

function themeFocusAnalysisKey(tag: ThemeFocus): ThemeAnalysisKey {
  if (tag === "brand_feel") return "brandFeel";
  return tag;
}

function themeAnalysisSnippet(asset: CreateImageAsset): string {
  const analysis = asset.analysis;
  if (!analysis) return "";
  const lines: string[] = [];
  for (const option of THEME_FOCUS_OPTIONS) {
    if (!asset.tags.includes(option.id)) continue;
    const key = themeFocusAnalysisKey(option.id);
    const value = analysis[key]?.trim();
    if (value) lines.push(`  ${option.label}: ${value}`);
    if (option.id === "palette" && analysis.colors?.length) {
      const colors = analysis.colors
        .slice(0, 6)
        .map((color) =>
          [color.name, color.hex, color.role ? `(${color.role})` : ""]
            .filter(Boolean)
            .join(" ")
        )
        .join(", ");
      if (colors) lines.push(`  Palette colors: ${colors}`);
    }
  }
  return lines.join("\n");
}

function compactThemeAnalysisSummary(asset: CreateImageAsset): string {
  const analysis = asset.analysis;
  if (!analysis) return "";
  const selected = themeAnalysisSnippet(asset)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (selected.length > 0) return selected.slice(0, 2).join(" · ");
  return analysis.summary?.trim() || "";
}

function rawRoleLabel(role: RawFileRole): string {
  return RAW_FILE_ROLES.find((option) => option.id === role)?.label ?? role;
}

function stripTuneSection(text: string): string {
  const idx = text.indexOf(CREATE_TUNE_SECTION_TITLE);
  if (idx < 0) return text.trim();
  return text.slice(0, idx).trim();
}

function buildTuneSection(ids: string[]): string {
  const tags = CREATE_TUNE_TAGS.filter((tag) => ids.includes(tag.id));
  if (tags.length === 0) return "";
  return [
    CREATE_TUNE_SECTION_TITLE,
    ...tags.map((tag) => `- ${tag.label}: ${tag.profile}`),
  ].join("\n");
}

function compactPromptBucketPreview(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
}

function dataVaultKind(vault: VaultPickRow): DataVaultTab {
  return vault.visibility === "shared" ? "shared" : "private";
}

function profileKindForClass(profileClass: string): ClientTab {
  return profileClass === "internal" ? "company" : "clients";
}

function profileMergeKey(profile: CreatePersonProfile): string {
  return `${profile.name.trim().toLowerCase()}`;
}

function mergeCreateProfiles(profiles: CreatePersonProfile[]): CreatePersonProfile[] {
  const byKey = new Map<string, CreatePersonProfile>();
  for (const profile of profiles) {
    const key = profileMergeKey(profile);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, profile);
      continue;
    }
    byKey.set(key, {
      ...existing,
      company: existing.company || profile.company,
      role: existing.role || profile.role,
      email: existing.email || profile.email,
      phone: existing.phone || profile.phone,
      notes: existing.notes || profile.notes,
      evidencePaths: [
        ...new Set([
          ...(existing.evidencePaths ?? []),
          ...(profile.evidencePaths ?? []),
        ]),
      ],
    });
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.kind} ${a.name}`.localeCompare(`${b.kind} ${b.name}`)
  );
}

function profileUseOption(mode?: ProfileUseMode) {
  return (
    PROFILE_USE_OPTIONS.find((option) => option.id === mode) ??
    PROFILE_USE_OPTIONS.find((option) => option.id === "context") ??
    PROFILE_USE_OPTIONS[0]
  );
}

function profileWorkLine(profile: CreatePersonProfile): string {
  return [profile.company, profile.role].filter(Boolean).join(" · ");
}

function profileShortSnippet(profile: CreatePersonProfile): string {
  const notes = profile.notes.trim();
  if (notes) return notes;
  const work = profileWorkLine(profile);
  if (work) return work;
  return profile.source === "brain"
    ? "Saved profile from Hermes context."
    : "Manual profile for this Create flow.";
}

function shortProfileSource(path: string): string {
  const cleaned = path.trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? cleaned;
}

function profileSourceChips(profile: CreatePersonProfile): string[] {
  const chips = new Set<string>();
  if (profile.source === "manual") chips.add("Manual");
  if (profile.vaultName) chips.add(profile.vaultName);
  if (profile.confidence) chips.add(profile.confidence);
  for (const item of (profile.evidencePaths ?? []).slice(0, 3)) {
    const source = shortProfileSource(item);
    if (source) chips.add(source);
  }
  return [...chips].slice(0, 5);
}

function profileDraftFromProfile(profile: CreatePersonProfile): ProfileEditDraft {
  return {
    name: profile.name,
    company: profile.company,
    role: profile.role,
    email: profile.email,
    phone: profile.phone,
    notes: profile.notes,
  };
}

function createImageAssetFromPattern(asset: CreateProductionAsset): CreateImageAsset | null {
  if (!asset.id || !asset.url) return null;
  return {
    id: asset.id,
    name: asset.name || "Reusable image",
    previewUrl: asset.url,
    serverUrl: asset.url,
    ...(asset.toolPath ? { toolPath: asset.toolPath } : {}),
    caption: asset.caption || "",
    tags: (asset.tags ?? []) as ImageTag[],
  };
}

function mergeReusableImageAssets(
  current: CreateImageAsset[],
  incoming: CreateImageAsset[]
): CreateImageAsset[] {
  if (incoming.length === 0) return current;
  const incomingIds = new Set(incoming.map((asset) => asset.id));
  return [
    ...incoming,
    ...current.filter((asset) => !incomingIds.has(asset.id)),
  ];
}

function mergeReusableText(current: string, incoming?: string): string {
  const cleaned = incoming?.trim();
  if (!cleaned) return current;
  const existing = current.trim();
  if (!existing) return cleaned;
  if (existing.includes(cleaned)) return current;
  return `${existing}\n\n${cleaned}`;
}

export function CreateStudioIntentDialog({
  open,
  onCancel,
  onContinue,
  busy = false,
}: CreateStudioIntentDialogProps) {
  const { hoverTipsEnabled, openSettings } = useSettings();
  const [mounted, setMounted] = useState(false);
  const [creationModePickerOpen, setCreationModePickerOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sourceMaterial, setSourceMaterial] = useState("");
  const [exactCopy, setExactCopy] = useState("");
  const [voiceTarget, setVoiceTarget] = useState<CreateVoiceTarget>("prompt");
  const [outputId, setOutputId] = useState<OutputId>("web");
  const [documentFormat, setDocumentFormat] = useState<DocumentFormat>("pdf");
  const [documentFormatConfirmed, setDocumentFormatConfirmed] = useState(false);
  const [outputDetailId, setOutputDetailId] = useState<OutputId | null>(null);
  const [outputSubchoiceById, setOutputSubchoiceById] = useState<
    Partial<Record<OutputId, string>>
  >({});
  const [extraRouteIds, setExtraRouteIds] = useState<string[]>([]);
  const [extraRoutePickerOpen, setExtraRoutePickerOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [imageModuleOpen, setImageModuleOpen] = useState(false);
  const [dataModuleOpen, setDataModuleOpen] = useState(false);
  const [clientModuleOpen, setClientModuleOpen] = useState(false);
  const [templateModuleOpen, setTemplateModuleOpen] = useState(false);
  const [designDnaModuleOpen, setDesignDnaModuleOpen] = useState(false);
  const [reviewModuleOpen, setReviewModuleOpen] = useState(false);
  const [themeImages, setThemeImages] = useState<CreateImageAsset[]>([]);
  const [includeImages, setIncludeImages] = useState<CreateImageAsset[]>([]);
  const [useImages, setUseImages] = useState<CreateImageAsset[]>([]);
  const [imageUploadingFor, setImageUploadingFor] = useState<ImageKind | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dataNotes, setDataNotes] = useState("");
  const [dataVaultSlug, setDataVaultSlug] = useState("");
  const [dataVaultFiles, setDataVaultFiles] = useState<VaultFileRow[]>([]);
  const [dataVaultFilesLoading, setDataVaultFilesLoading] = useState(false);
  const [dataVaultFilesError, setDataVaultFilesError] = useState<string | null>(null);
  const [dataVaultWhole, setDataVaultWhole] = useState(true);
  const [dataVaultTab, setDataVaultTab] = useState<DataVaultTab>("private");
  const [selectedVaultFilePaths, setSelectedVaultFilePaths] = useState<string[]>([]);
  const [rawFiles, setRawFiles] = useState<RawCreateFile[]>([]);
  const [rawUploading, setRawUploading] = useState(false);
  const [rawFileError, setRawFileError] = useState<string | null>(null);
  const [vaultRows, setVaultRows] = useState<VaultPickRow[]>([]);
  const [vaultsLoading, setVaultsLoading] = useState(false);
  const [vaultsError, setVaultsError] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientTab, setClientTab] = useState<ClientTab>("clients");
  const [brainProfiles, setBrainProfiles] = useState<CreatePersonProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [manualProfiles, setManualProfiles] = useState<CreatePersonProfile[]>([]);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [profileUseById, setProfileUseById] = useState<Record<string, ProfileUseMode>>({});
  const [pendingProfileUseId, setPendingProfileUseId] = useState<string | null>(null);
  const [focusedProfileId, setFocusedProfileId] = useState<string | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [profileEdits, setProfileEdits] = useState<Record<string, Partial<CreatePersonProfile>>>({});
  const [profileEditId, setProfileEditId] = useState<string | null>(null);
  const [profileEditDraft, setProfileEditDraft] = useState<ProfileEditDraft>({
    name: "",
    company: "",
    role: "",
    email: "",
    phone: "",
    notes: "",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [clientDraftOpen, setClientDraftOpen] = useState(false);
  const [clientDraftName, setClientDraftName] = useState("");
  const [clientDraftCompany, setClientDraftCompany] = useState("");
  const [clientDraftRole, setClientDraftRole] = useState("");
  const [clientDraftEmail, setClientDraftEmail] = useState("");
  const [clientDraftNotes, setClientDraftNotes] = useState("");
  const [templateRows, setTemplateRows] = useState<CreateTemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateReferenceTab, setTemplateReferenceTab] =
    useState<TemplateReferenceTab>("templates");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateCarry, setTemplateCarry] = useState<TemplateCarryOption[]>([]);
  const [designDnaRows, setDesignDnaRows] = useState<CreateDesignDnaRow[]>([]);
  const [designDnaLoading, setDesignDnaLoading] = useState(false);
  const [designDnaError, setDesignDnaError] = useState<string | null>(null);
  const [selectedDesignDnaIds, setSelectedDesignDnaIds] = useState<string[]>([]);
  const [designDnaCarry, setDesignDnaCarry] = useState<DesignDnaCarryOption[]>(
    DEFAULT_DESIGN_DNA_CARRY
  );
  const [designDnaStrength, setDesignDnaStrength] =
    useState<DesignDnaStrength>("strong");
  const [createPatternRows, setCreatePatternRows] = useState<CreatePatternRow[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [selectedPatternId, setSelectedPatternId] = useState("");
  const [deletePatternId, setDeletePatternId] = useState<string | null>(null);
  const [deletePatternBusy, setDeletePatternBusy] = useState(false);
  const [activeTip, setActiveTip] = useState<CreateTipState | null>(null);
  const [reviewBriefDraft, setReviewBriefDraft] = useState("");
  const [reviewTuneOpen, setReviewTuneOpen] = useState(false);
  const [selectedTuneIds, setSelectedTuneIds] = useState<string[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);
  const includeInputRef = useRef<HTMLInputElement>(null);
  const useInputRef = useRef<HTMLInputElement>(null);
  const rawFileInputRef = useRef<HTMLInputElement>(null);
  const finishedDocInputRef = useRef<HTMLInputElement>(null);
  const tipDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTargetRef = useRef<CreateVoiceTarget>("prompt");
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const activeCreateModuleRef = useRef<string | null>(null);
  const createHistoryIdRef = useRef<string | null>(null);
  const createHistoryDepthRef = useRef(0);
  const draftHydratedRef = useRef(false);
  const suppressDraftSaveRef = useRef(false);
  const getVoiceBaseText = useCallback(() => {
    if (voiceTargetRef.current === "sourceMaterial") return sourceMaterial;
    if (voiceTargetRef.current === "exactCopy") return exactCopy;
    return prompt;
  }, [exactCopy, prompt, sourceMaterial]);

  const applyVoiceText = useCallback((text: string) => {
    if (voiceTargetRef.current === "sourceMaterial") {
      setSourceMaterial(text);
      return;
    }
    if (voiceTargetRef.current === "exactCopy") {
      setExactCopy(text);
      return;
    }
    setPrompt(text);
  }, []);

  const {
    voiceState,
    voiceErrorHint,
    toggleRecording: toggleVoiceRecording,
    cleanupSession: cleanupVoiceSession,
  } = useDeepgramDictation({
    getBaseText: getVoiceBaseText,
    applyText: applyVoiceText,
  });

  function handleVoicePressFor(target: CreateVoiceTarget) {
    if (busy || voiceState === "processing") return;
    if (voiceState === "recording" && voiceTargetRef.current !== target) return;
    voiceTargetRef.current = target;
    setVoiceTarget(target);
    toggleVoiceRecording();
  }

  const activeCreateModule = useMemo(() => {
    if (reviewModuleOpen) return "review";
    if (designDnaModuleOpen) return "dna";
    if (templateModuleOpen) return "template";
    if (clientModuleOpen) return "client";
    if (dataModuleOpen) return "data";
    if (imageModuleOpen) return "images";
    return null;
  }, [
    clientModuleOpen,
    dataModuleOpen,
    designDnaModuleOpen,
    imageModuleOpen,
    reviewModuleOpen,
    templateModuleOpen,
  ]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => clearCreateTipDelay();
  }, []);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    activeCreateModuleRef.current = activeCreateModule;
  }, [activeCreateModule]);

  useEffect(() => {
    const selectedSubchoiceId = outputSubchoiceById[outputId] || "surprise";
    setExtraRouteIds((current) =>
      current.filter((id) =>
        CREATE_EXTRA_ROUTES.some((route) =>
          route.id === id &&
          createExtraRouteFitsSelection(route, outputId, selectedSubchoiceId)
        )
      )
    );
    if (outputId !== "document") setDocumentFormatConfirmed(false);
  }, [outputId, outputSubchoiceById]);

  function clearCreateDraftDelaySafe() {
    clearCreateTipDelay();
    setActiveTip(null);
  }

  function resetCreateState() {
    setCreationModePickerOpen(false);
    setPrompt("");
    setSourceMaterial("");
    setExactCopy("");
    setOutputId("web");
    setDocumentFormat("pdf");
    setDocumentFormatConfirmed(false);
    setOutputDetailId(null);
    setOutputSubchoiceById({});
    setExtraRouteIds([]);
    setExtraRoutePickerOpen(false);
    setActivePanel(null);
    setImageModuleOpen(false);
    setDataModuleOpen(false);
    setClientModuleOpen(false);
    setTemplateModuleOpen(false);
    setDesignDnaModuleOpen(false);
    setReviewModuleOpen(false);
    setThemeImages([]);
    setIncludeImages([]);
    setUseImages([]);
    setImageUploadingFor(null);
    setImageError(null);
    setDataNotes("");
    setDataVaultSlug("");
    setDataVaultFiles([]);
    setDataVaultFilesLoading(false);
    setDataVaultFilesError(null);
    setDataVaultWhole(true);
    setDataVaultTab("private");
    setSelectedVaultFilePaths([]);
    setRawFiles([]);
    setRawUploading(false);
    setRawFileError(null);
    setClientSearch("");
    setClientTab("clients");
    setBrainProfiles([]);
    setProfilesLoading(false);
    setProfilesError(null);
    setManualProfiles([]);
    setSelectedProfileIds([]);
    setProfileUseById({});
    setPendingProfileUseId(null);
    setFocusedProfileId(null);
    setExpandedProfileId(null);
    setProfileEdits({});
    setProfileEditId(null);
    setProfileEditDraft({
      name: "",
      company: "",
      role: "",
      email: "",
      phone: "",
      notes: "",
    });
    setProfileSaving(false);
    setClientDraftOpen(false);
    setClientDraftName("");
    setClientDraftCompany("");
    setClientDraftRole("");
    setClientDraftEmail("");
    setClientDraftNotes("");
    setTemplateRows([]);
    setTemplatesLoading(false);
    setTemplatesError(null);
    setTemplateSearch("");
    setTemplateReferenceTab("templates");
    setSelectedTemplateId("");
    setTemplateCarry([]);
    setDesignDnaRows([]);
    setDesignDnaLoading(false);
    setDesignDnaError(null);
    setSelectedDesignDnaIds([]);
    setDesignDnaCarry(DEFAULT_DESIGN_DNA_CARRY);
    setDesignDnaStrength("strong");
    setCreatePatternRows([]);
    setPatternsLoading(false);
    setPatternsError(null);
    setSelectedPatternId("");
    setDeletePatternId(null);
    setDeletePatternBusy(false);
    setReviewBriefDraft("");
    setReviewTuneOpen(false);
    setSelectedTuneIds([]);
    clearCreateDraftDelaySafe();
  }

  function readSavedCreateDraft(): CreateStudioDraft | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(CREATE_STUDIO_DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CreateStudioDraft;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function removeSavedCreateDraft() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(CREATE_STUDIO_DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  function restoreCreateDraft(draft: CreateStudioDraft | null) {
    resetCreateState();
    if (!draft) return;
    if (typeof draft.prompt === "string") setPrompt(draft.prompt);
    if (typeof draft.sourceMaterial === "string") setSourceMaterial(draft.sourceMaterial);
    if (typeof draft.exactCopy === "string") setExactCopy(draft.exactCopy);
    if (draft.outputId && OUTPUT_OPTIONS.some((option) => option.id === draft.outputId)) {
      setOutputId(draft.outputId);
      setOutputDetailId(draft.outputId);
    }
    if (
      draft.documentFormat &&
      DOCUMENT_FORMAT_OPTIONS.some((option) => option.id === draft.documentFormat)
    ) {
      setDocumentFormat(draft.documentFormat);
    }
    if (draft.outputSubchoiceById && typeof draft.outputSubchoiceById === "object") {
      setOutputSubchoiceById(draft.outputSubchoiceById);
    }
    if (Array.isArray(draft.extraRouteIds)) {
      setExtraRouteIds(
        draft.extraRouteIds.filter((id) =>
          CREATE_EXTRA_ROUTES.some((route) => route.id === id)
        )
      );
    }
    if (Array.isArray(draft.themeImages)) setThemeImages(draft.themeImages);
    if (Array.isArray(draft.includeImages)) setIncludeImages(draft.includeImages);
    if (Array.isArray(draft.useImages)) setUseImages(draft.useImages);
    if (typeof draft.dataNotes === "string") setDataNotes(draft.dataNotes);
    if (typeof draft.dataVaultSlug === "string") setDataVaultSlug(draft.dataVaultSlug);
    if (typeof draft.dataVaultWhole === "boolean") setDataVaultWhole(draft.dataVaultWhole);
    if (draft.dataVaultTab === "private" || draft.dataVaultTab === "shared") {
      setDataVaultTab(draft.dataVaultTab);
    }
    if (Array.isArray(draft.selectedVaultFilePaths)) {
      setSelectedVaultFilePaths(draft.selectedVaultFilePaths);
    }
    if (Array.isArray(draft.rawFiles)) setRawFiles(draft.rawFiles);
    if (Array.isArray(draft.manualProfiles)) setManualProfiles(draft.manualProfiles);
    if (Array.isArray(draft.selectedProfileIds)) {
      setSelectedProfileIds(draft.selectedProfileIds);
    }
    if (draft.profileUseById && typeof draft.profileUseById === "object") {
      setProfileUseById(draft.profileUseById);
    }
    if (draft.profileEdits && typeof draft.profileEdits === "object") {
      setProfileEdits(draft.profileEdits);
    }
    if (typeof draft.selectedTemplateId === "string") {
      setSelectedTemplateId(draft.selectedTemplateId);
    }
    if (Array.isArray(draft.templateCarry)) setTemplateCarry(draft.templateCarry);
    if (draft.templateReferenceTab === "templates" || draft.templateReferenceTab === "design") {
      setTemplateReferenceTab(draft.templateReferenceTab);
    }
    if (Array.isArray(draft.selectedDesignDnaIds)) {
      setSelectedDesignDnaIds(draft.selectedDesignDnaIds.slice(0, 3));
    }
    if (Array.isArray(draft.designDnaCarry)) {
      const valid = draft.designDnaCarry.filter((id) =>
        DESIGN_DNA_CARRY_OPTIONS.some((option) => option.id === id)
      );
      setDesignDnaCarry(valid.length > 0 ? valid : DEFAULT_DESIGN_DNA_CARRY);
    }
    if (
      draft.designDnaStrength === "light" ||
      draft.designDnaStrength === "strong" ||
      draft.designDnaStrength === "blueprint"
    ) {
      setDesignDnaStrength(draft.designDnaStrength);
    }
    if (typeof draft.selectedPatternId === "string") {
      setSelectedPatternId(draft.selectedPatternId);
    }
    if (typeof draft.reviewBriefDraft === "string") {
      setReviewBriefDraft(draft.reviewBriefDraft);
    }
    if (Array.isArray(draft.selectedTuneIds)) setSelectedTuneIds(draft.selectedTuneIds);
  }

  function clearCreateDraft() {
    suppressDraftSaveRef.current = true;
    removeSavedCreateDraft();
    resetCreateState();
    window.setTimeout(() => {
      suppressDraftSaveRef.current = false;
    }, 0);
  }

  useEffect(() => {
    if (!open) return;
    draftHydratedRef.current = false;
    suppressDraftSaveRef.current = true;
    restoreCreateDraft(readSavedCreateDraft());
    draftHydratedRef.current = true;
    window.setTimeout(() => {
      suppressDraftSaveRef.current = false;
    }, 0);
  }, [open]);

  useEffect(() => {
    if (hoverTipsEnabled) return;
    clearCreateTipDelay();
    setActiveTip(null);
  }, [hoverTipsEnabled]);

  useEffect(() => {
    if (!open) cleanupVoiceSession();
  }, [open, cleanupVoiceSession]);

  useEffect(() => {
    if (!open || !mounted || typeof window === "undefined") return;
    createHistoryIdRef.current = `create-studio-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    createHistoryDepthRef.current = 0;
    pushCreateHistoryLayer(null);

    function onPopState(event: PopStateEvent) {
      const state = event.state;
      const id =
        state && typeof state === "object"
          ? (state as { __hermesCreateStudioId?: unknown })
              .__hermesCreateStudioId
          : null;
      const depth =
        state && typeof state === "object"
          ? (state as { __hermesCreateStudioDepth?: unknown })
              .__hermesCreateStudioDepth
          : null;
      const belongsToCreate =
        typeof id === "string" && id === createHistoryIdRef.current;

      if (busyRef.current) {
        pushCreateHistoryLayer(activeCreateModuleRef.current);
        return;
      }

      if (belongsToCreate) {
        createHistoryDepthRef.current = depth === 2 ? 2 : 1;
        if (createHistoryDepthRef.current === 1 && activeCreateModuleRef.current) {
          closeActiveCreateModule();
        }
        return;
      }

      createHistoryDepthRef.current = 0;
      closeActiveCreateModule();
      onCancelRef.current();
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      createHistoryIdRef.current = null;
      createHistoryDepthRef.current = 0;
    };
  }, [mounted, open]);

  useEffect(() => {
    if (!open || !mounted || typeof window === "undefined") return;
    if (!createHistoryIdRef.current) return;
    if (activeCreateModule) {
      if (createHistoryDepthRef.current < 2) {
        pushCreateHistoryLayer(activeCreateModule);
      } else {
        replaceCreateHistoryLayer(activeCreateModule);
      }
      return;
    }
    if (createHistoryDepthRef.current === 2) {
      window.history.back();
    }
  }, [activeCreateModule, mounted, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [open]);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 86), 148)}px`;
  }, [prompt, open]);

  useEffect(() => {
    if (!open || !dataModuleOpen || !dataVaultSlug) return;
    let cancelled = false;
    setDataVaultFilesLoading(true);
    setDataVaultFilesError(null);
    setDataVaultFiles([]);
    void fetch(`/api/projects/${encodeURIComponent(dataVaultSlug)}/files`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            typeof d.error === "string" ? d.error : "Could not load vault files"
          );
        }
        const d = (await r.json()) as { files?: VaultFileRow[] };
        return Array.isArray(d.files) ? d.files : [];
      })
      .then((files) => {
        if (cancelled) return;
        setDataVaultFiles(files);
        setDataVaultFilesLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDataVaultFiles([]);
        setDataVaultFilesLoading(false);
        setDataVaultFilesError(
          err instanceof Error ? err.message : "Could not load vault files"
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, dataModuleOpen, dataVaultSlug]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVaultsLoading(true);
    setVaultsError(null);
    void fetch("/api/projects", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            typeof d.error === "string" ? d.error : "Could not load people"
          );
        }
        return r.json() as Promise<VaultPickRow[]>;
      })
      .then((list) => {
        if (cancelled) return;
        setVaultRows(Array.isArray(list) ? list : []);
        setVaultsLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setVaultRows([]);
        setVaultsLoading(false);
        setVaultsError(e instanceof Error ? e.message : "Could not load people");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !clientModuleOpen) return;
    const slugs = [
      ...vaultRows.map((row) => row.slug),
      dataVaultSlug.trim(),
      ORG_GLOBAL_SLUG,
    ].filter(Boolean);
    const uniqueSlugs = [...new Set(slugs)];
    let cancelled = false;
    setProfilesLoading(true);
    setProfilesError(null);

    async function loadProfiles() {
      const chunks = await Promise.all(
        uniqueSlugs.map(async (slug) => {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(slug)}/profiles/people`,
            { cache: "no-store" }
          );
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(
              typeof data.error === "string"
                ? data.error
                : `Could not load people from ${slug}`
            );
          }
          const data = (await res.json()) as {
            profiles?: BrainPeopleApiProfileRow[];
          };
          const vaultName =
            vaultRows.find((row) => row.slug === slug)?.name ||
            data.profiles?.[0]?.vaultName ||
            (slug === ORG_GLOBAL_SLUG ? "Organization Library" : slug);
          return (Array.isArray(data.profiles) ? data.profiles : []).map(
            (profile): CreatePersonProfile => ({
              id: `brain-${profile.vaultSlug || slug}-${profile.id}`,
              kind: profileKindForClass(profile.profileClass),
              name: profile.name || "Unnamed person",
              company: profile.company || "",
              role: profile.role || "",
              email: profile.emails?.[0] ?? "",
              phone: profile.phones?.[0] ?? "",
              notes: profile.summary || "",
              source: "brain",
              vaultSlug: profile.vaultSlug || slug,
              vaultName,
              profileClass: profile.profileClass,
              evidencePaths: profile.evidencePaths ?? [],
              confidence: profile.confidence,
            })
          );
        })
      );
      return mergeCreateProfiles(chunks.flat());
    }

    void loadProfiles()
      .then((profiles) => {
        if (cancelled) return;
        setBrainProfiles(profiles);
        setProfilesLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBrainProfiles([]);
        setProfilesLoading(false);
        setProfilesError(
          err instanceof Error ? err.message : "Could not load people profiles"
        );
      });

    return () => {
      cancelled = true;
    };
  }, [open, clientModuleOpen, dataVaultSlug, vaultRows]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    void fetch("/api/templates", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            typeof d.error === "string" ? d.error : "Could not load templates"
          );
        }
        const d = (await r.json()) as { templates?: CreateTemplateRow[] };
        return Array.isArray(d.templates) ? d.templates : [];
      })
      .then((templates) => {
        if (cancelled) return;
        setTemplateRows(templates);
        setTemplatesLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setTemplateRows([]);
        setTemplatesLoading(false);
        setTemplatesError(e instanceof Error ? e.message : "Could not load templates");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDesignDnaLoading(true);
    setDesignDnaError(null);
    void fetch("/api/design-dna", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            typeof d.error === "string" ? d.error : "Could not load Design DNA"
          );
        }
        const d = (await r.json()) as { designDna?: CreateDesignDnaRow[] };
        return Array.isArray(d.designDna) ? d.designDna : [];
      })
      .then((designDna) => {
        if (cancelled) return;
        setDesignDnaRows(designDna);
        setDesignDnaLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDesignDnaRows([]);
        setDesignDnaLoading(false);
        setDesignDnaError(e instanceof Error ? e.message : "Could not load Design DNA");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPatternsLoading(true);
    setPatternsError(null);
    void fetch("/api/create-patterns", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            typeof d.error === "string" ? d.error : "Could not load Create patterns"
          );
        }
        const d = (await r.json()) as { patterns?: CreatePatternRow[] };
        return Array.isArray(d.patterns) ? d.patterns : [];
      })
      .then((patterns) => {
        if (cancelled) return;
        setCreatePatternRows(patterns);
        setPatternsLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCreatePatternRows([]);
        setPatternsLoading(false);
        setPatternsError(e instanceof Error ? e.message : "Could not load Create patterns");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") requestCreateClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  const selectedOutput =
    OUTPUT_OPTIONS.find((option) => option.id === outputId) ?? OUTPUT_OPTIONS[0];
  const selectedDocumentFormat =
    DOCUMENT_FORMAT_OPTIONS.find((option) => option.id === documentFormat) ??
    DOCUMENT_FORMAT_OPTIONS[0];
  const selectedCreateIntent =
    selectedOutput.id === "document" ? selectedDocumentFormat.intent : selectedOutput.intent;
  const isMotionOutput = selectedCreateIntent === "motion";
  const outputDetailOption =
    OUTPUT_OPTIONS.find((option) => option.id === outputDetailId) ?? null;
  const selectedOutputSubchoiceId = outputSubchoiceById[outputId] || "surprise";
  const selectedOutputSubchoice =
    outputSubchoices(selectedOutput).find(
      (choice) => choice.id === selectedOutputSubchoiceId
    ) ?? outputSubchoices(selectedOutput)[0]!;
  const selectedOutputHasExplicitSubchoice = Boolean(outputSubchoiceById[outputId]);
  const SelectedOutputIcon = selectedOutput.icon;
  const documentSubchoiceSelected = Boolean(outputSubchoiceById.document);
  const compatibleExtraRoutes = CREATE_EXTRA_ROUTES.filter((route) =>
    createExtraRouteFitsSelection(route, outputId, selectedOutputSubchoiceId)
  );
  const selectedExtraRoutes = compatibleExtraRoutes.filter((route) =>
    extraRouteIds.includes(route.id)
  );

  const allProfiles = useMemo(
    () =>
      mergeCreateProfiles([...brainProfiles, ...manualProfiles]).map((profile) => ({
        ...profile,
        ...(profileEdits[profile.id] ?? {}),
      })),
    [brainProfiles, manualProfiles, profileEdits]
  );

  const filteredPeopleProfiles = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return allProfiles.filter((profile) => {
      if (profile.kind !== clientTab) return false;
      if (!q) return true;
      return `${profile.name} ${profile.company} ${profile.role} ${profile.email} ${profile.phone} ${profile.vaultName ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [allProfiles, clientSearch, clientTab]);

  const selectedProfiles = useMemo(
    () => allProfiles.filter((profile) => selectedProfileIds.includes(profile.id)),
    [allProfiles, selectedProfileIds]
  );

  const filteredTemplateRows = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return templateRows;
    return templateRows.filter((template) =>
      `${template.name} ${template.sourceStem} ${template.vaultName} ${template.vaultSlug}`
        .toLowerCase()
        .includes(q)
    );
  }, [templateRows, templateSearch]);

  const selectedTemplate = useMemo(
    () => templateRows.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templateRows]
  );

  const filteredDesignDnaRows = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return designDnaRows;
    return designDnaRows.filter((row) =>
      `${row.name} ${row.slug} ${row.category ?? ""} ${row.description ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [designDnaRows, templateSearch]);

  const selectedDesignDnaRows = useMemo(
    () => selectedDesignDnaIds
      .map((id) => designDnaRows.find((row) => row.id === id))
      .filter((row): row is CreateDesignDnaRow => Boolean(row)),
    [designDnaRows, selectedDesignDnaIds]
  );
  const selectedPattern = useMemo(
    () => createPatternRows.find((pattern) => pattern.id === selectedPatternId) ?? null,
    [createPatternRows, selectedPatternId]
  );
  const patternLocked = Boolean(selectedPattern);

  const hasCreateDraftContent = useMemo(
    () =>
      Boolean(
        prompt.trim() ||
        sourceMaterial.trim() ||
        exactCopy.trim() ||
        outputId !== "web" ||
          documentFormat !== "pdf" ||
          Object.keys(outputSubchoiceById).length > 0 ||
          extraRouteIds.length > 0 ||
          themeImages.length > 0 ||
          includeImages.length > 0 ||
          useImages.length > 0 ||
          dataNotes.trim() ||
          dataVaultSlug ||
          selectedVaultFilePaths.length > 0 ||
          rawFiles.length > 0 ||
          manualProfiles.length > 0 ||
          selectedProfileIds.length > 0 ||
          Object.keys(profileEdits).length > 0 ||
          selectedTemplateId ||
          templateCarry.length > 0 ||
          selectedDesignDnaIds.length > 0 ||
          designDnaCarry.join(",") !== DEFAULT_DESIGN_DNA_CARRY.join(",") ||
          designDnaStrength !== "strong" ||
          selectedPatternId ||
          reviewBriefDraft.trim() ||
          selectedTuneIds.length > 0
      ),
    [
      dataNotes,
      dataVaultSlug,
      designDnaCarry,
      designDnaStrength,
      documentFormat,
      exactCopy,
      extraRouteIds.length,
      includeImages.length,
      manualProfiles.length,
      outputId,
      outputSubchoiceById,
      profileEdits,
      prompt,
      rawFiles.length,
      reviewBriefDraft,
      selectedProfileIds.length,
      selectedDesignDnaIds.length,
      selectedPatternId,
      selectedTemplateId,
      selectedTuneIds.length,
      selectedVaultFilePaths.length,
      sourceMaterial,
      templateCarry.length,
      themeImages.length,
      useImages.length,
    ]
  );

  useEffect(() => {
    if (!mounted || !draftHydratedRef.current || suppressDraftSaveRef.current) return;
    if (!hasCreateDraftContent) {
      removeSavedCreateDraft();
      return;
    }
    const draft: CreateStudioDraft = {
      prompt,
      sourceMaterial,
      exactCopy,
      outputId,
      outputSubchoiceById,
      extraRouteIds,
      themeImages,
      includeImages,
      useImages,
      dataNotes,
      dataVaultSlug,
      documentFormat,
      dataVaultWhole,
      dataVaultTab,
      selectedVaultFilePaths,
      rawFiles,
      manualProfiles,
      selectedProfileIds,
      profileUseById,
      profileEdits,
      selectedTemplateId,
      templateCarry,
      selectedDesignDnaIds,
      designDnaCarry,
      designDnaStrength,
      selectedPatternId,
      templateReferenceTab,
      reviewBriefDraft,
      selectedTuneIds,
    };
    try {
      window.localStorage.setItem(CREATE_STUDIO_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [
    dataNotes,
    dataVaultSlug,
    dataVaultTab,
    dataVaultWhole,
    designDnaCarry,
    designDnaStrength,
    documentFormat,
    exactCopy,
    hasCreateDraftContent,
    extraRouteIds,
    includeImages,
    manualProfiles,
    mounted,
    outputId,
    outputSubchoiceById,
    profileEdits,
    profileUseById,
    prompt,
    rawFiles,
    reviewBriefDraft,
    selectedProfileIds,
    selectedDesignDnaIds,
    selectedPatternId,
    selectedTemplateId,
    selectedTuneIds,
    selectedVaultFilePaths,
    sourceMaterial,
    templateCarry,
    templateReferenceTab,
    themeImages,
    useImages,
  ]);

  function createHistoryState(module: string | null) {
    const id = createHistoryIdRef.current;
    if (!id || typeof window === "undefined") return null;
    const current =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    return {
      ...current,
      __hermesCreateStudioId: id,
      __hermesCreateStudioDepth: module ? 2 : 1,
      __hermesCreateStudioModule: module,
    };
  }

  function pushCreateHistoryLayer(module: string | null) {
    if (typeof window === "undefined") return;
    const state = createHistoryState(module);
    if (!state) return;
    window.history.pushState(state, "", window.location.href);
    createHistoryDepthRef.current = module ? 2 : 1;
  }

  function replaceCreateHistoryLayer(module: string | null) {
    if (typeof window === "undefined") return;
    const state = createHistoryState(module);
    if (!state) return;
    window.history.replaceState(state, "", window.location.href);
    createHistoryDepthRef.current = module ? 2 : 1;
  }

  function closeActiveCreateModule() {
    setImageModuleOpen(false);
    setDataModuleOpen(false);
    setClientModuleOpen(false);
    setTemplateModuleOpen(false);
    setDesignDnaModuleOpen(false);
    setReviewModuleOpen(false);
    setReviewTuneOpen(false);
    setActivePanel(null);
    clearCreateTipDelay();
    setActiveTip(null);
  }

  function requestCreateClose() {
    if (busyRef.current) return;
    if (typeof window !== "undefined" && createHistoryDepthRef.current > 0) {
      window.history.go(-createHistoryDepthRef.current);
      return;
    }
    closeActiveCreateModule();
    onCancelRef.current();
  }

  if (!open || !mounted || typeof document === "undefined") return null;

  function pastedImageName(kind: ImageKind, file: File, index: number): string {
    const rawName = file.name.trim();
    if (rawName && !/^image\.(png|jpe?g|webp|gif|heic|heif)$/i.test(rawName)) {
      return rawName;
    }
    const ext =
      file.type === "image/jpeg"
        ? "jpg"
        : file.type === "image/webp"
          ? "webp"
          : file.type === "image/gif"
            ? "gif"
            : file.type === "image/heic"
              ? "heic"
              : file.type === "image/heif"
                ? "heif"
                : "png";
    return `pasted-${kind}-${Date.now()}-${index + 1}.${ext}`;
  }

  function normalizePastedImageFile(kind: ImageKind, file: File, index: number): File {
    const name = pastedImageName(kind, file, index);
    if (file.name === name) return file;
    return new File([file], name, {
      type: file.type || "image/png",
      lastModified: Date.now(),
    });
  }

  async function addImageFiles(kind: ImageKind, files: File[]) {
    if (files.length === 0 || imageUploadingFor !== null) return;
    const invalid = files.find((file) => !file.type.startsWith("image/"));
    if (invalid) {
      setImageError("Choose image files only.");
      return;
    }
    const oversized = files.find((file) => file.size > MAX_THEME_IMAGE_SIZE);
    if (oversized) {
      setImageError("Each image must be under 20MB.");
      return;
    }
    setImageUploadingFor(kind);
    setImageError(null);
    try {
      const uploaded: CreateImageAsset[] = [];
      for (const file of files) {
        uploaded.push(await uploadCreateImage(file, kind));
      }
      if (kind === "theme") {
        setThemeImages((current) => [
          ...current,
          ...uploaded.map((asset) => ({ ...asset, tags: ["mood" as const] })),
        ]);
      } else if (kind === "use") {
        setUseImages((current) => [...current, ...uploaded]);
      } else {
        setIncludeImages((current) => [...current, ...uploaded]);
      }
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Could not upload image");
    } finally {
      setImageUploadingFor(null);
    }
  }

  async function onImageFilesChange(
    kind: ImageKind,
    e: ChangeEvent<HTMLInputElement>
  ) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    try {
      await addImageFiles(kind, files);
    } finally {
      input.value = "";
    }
  }

  async function onImagePaste(kind: ImageKind, e: ClipboardEvent<HTMLElement>) {
    if (busyRef.current || imageUploadingFor !== null) return;
    const clipboard = e.clipboardData;
    const itemFiles = Array.from(clipboard.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file, index) => normalizePastedImageFile(kind, file, index));
    const directFiles = Array.from(clipboard.files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .map((file, index) => normalizePastedImageFile(kind, file, index));
    const files = itemFiles.length > 0 ? itemFiles : directFiles;
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    await addImageFiles(kind, files);
  }

  function updateImageAsset(
    kind: ImageKind,
    id: string,
    patch: Partial<Pick<CreateImageAsset, "caption" | "tags">>
  ) {
    const update = (asset: CreateImageAsset) =>
      asset.id === id ? { ...asset, ...patch } : asset;
    if (kind === "theme") setThemeImages((current) => current.map(update));
    else if (kind === "use") setUseImages((current) => current.map(update));
    else setIncludeImages((current) => current.map(update));
  }

  function removeImageAsset(kind: ImageKind, id: string) {
    if (kind === "theme") {
      setThemeImages((current) => current.filter((asset) => asset.id !== id));
    } else if (kind === "use") {
      setUseImages((current) => current.filter((asset) => asset.id !== id));
    } else {
      setIncludeImages((current) => current.filter((asset) => asset.id !== id));
    }
  }

  async function onRawFilesChange(
    e: ChangeEvent<HTMLInputElement>,
    role: RawFileRole = "data"
  ) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    setRawUploading(true);
    setRawFileError(null);
    try {
      const uploaded: RawCreateFile[] = [];
      for (const file of files) {
        uploaded.push(await uploadRawCreateFile(file, role));
      }
      setRawFiles((current) => [...current, ...uploaded]);
    } catch (err) {
      setRawFileError(err instanceof Error ? err.message : "Could not upload file");
    } finally {
      setRawUploading(false);
      input.value = "";
    }
  }

  function updateRawFileRole(id: string, role: RawFileRole) {
    setRawFiles((current) =>
      current.map((file) => (file.id === id ? { ...file, role } : file))
    );
  }

  function removeRawFile(id: string) {
    setRawFiles((current) => current.filter((file) => file.id !== id));
  }

  function toggleVaultFile(relativePath: string) {
    setDataVaultWhole(false);
    setSelectedVaultFilePaths((current) =>
      current.includes(relativePath)
        ? current.filter((path) => path !== relativePath)
        : [...current, relativePath]
    );
  }

  function selectDataVault(vault: VaultPickRow) {
    if (dataVaultSlug === vault.slug) {
      setDataVaultSlug("");
      setDataVaultFiles([]);
      setDataVaultFilesError(null);
      setDataVaultWhole(true);
      setSelectedVaultFilePaths([]);
      return;
    }
    setDataVaultSlug(vault.slug);
    setDataVaultWhole(true);
    setSelectedVaultFilePaths([]);
  }

  function manualProfileTargetSlug() {
    if (clientTab === "company") return ORG_GLOBAL_SLUG;
    const selected = dataVaultSlug.trim();
    if (selected) return selected;
    const privateVault = vaultRows.find((row) => row.slug !== ORG_GLOBAL_SLUG);
    return privateVault?.slug || ORG_GLOBAL_SLUG;
  }

  async function addManualProfile() {
    const name = clientDraftName.trim();
    const company = clientDraftCompany.trim();
    const role = clientDraftRole.trim();
    const email = clientDraftEmail.trim();
    const notes = clientDraftNotes.trim();
    if (!name) {
      setProfilesError("Add a name before saving this profile.");
      return;
    }
    setProfileSaving(true);
    setProfilesError(null);
    try {
      const targetSlug = manualProfileTargetSlug();
      const res = await fetch(
        `/api/projects/${encodeURIComponent(targetSlug)}/profiles/people`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: clientTab,
            name,
            company,
            role,
            email,
            notes,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        profile?: BrainPeopleApiProfileRow;
      };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Could not save this profile");
      }
      const saved = data.profile;
      const vaultName =
        vaultRows.find((row) => row.slug === saved.vaultSlug)?.name ||
        saved.vaultName ||
        (saved.vaultSlug === ORG_GLOBAL_SLUG ? "Organization Library" : saved.vaultSlug);
      const createProfile: CreatePersonProfile = {
        id: `brain-${saved.vaultSlug || targetSlug}-${saved.id}`,
        kind: profileKindForClass(saved.profileClass),
        name: saved.name || name,
        company: saved.company || company,
        role: saved.role || role,
        email: saved.emails?.[0] ?? email,
        phone: saved.phones?.[0] ?? "",
        notes: saved.summary || notes,
        source: "brain",
        vaultSlug: saved.vaultSlug || targetSlug,
        vaultName,
        profileClass: saved.profileClass,
        evidencePaths: saved.evidencePaths ?? [],
        confidence: saved.confidence,
      };
      setBrainProfiles((current) =>
        mergeCreateProfiles([
          ...current.filter((profile) => profile.id !== createProfile.id),
          createProfile,
        ])
      );
      setSelectedProfileIds((current) =>
        current.includes(createProfile.id) ? current : [...current, createProfile.id]
      );
      setProfileUseById((current) => ({ ...current, [createProfile.id]: "context" }));
      setFocusedProfileId(createProfile.id);
      setExpandedProfileId(createProfile.id);
      setClientDraftName("");
      setClientDraftCompany("");
      setClientDraftRole("");
      setClientDraftEmail("");
      setClientDraftNotes("");
      setClientDraftOpen(false);
    } catch (err: unknown) {
      setProfilesError(err instanceof Error ? err.message : "Could not save this profile");
    } finally {
      setProfileSaving(false);
    }
  }

  function requestProfileSelection(profile: CreatePersonProfile) {
    setFocusedProfileId(profile.id);
    if (selectedProfileIds.includes(profile.id)) return;
    setPendingProfileUseId(profile.id);
  }

  function confirmProfileUse(profile: CreatePersonProfile, mode: ProfileUseMode) {
    setSelectedProfileIds((current) =>
      current.includes(profile.id) ? current : [...current, profile.id]
    );
    setProfileUseById((current) => ({ ...current, [profile.id]: mode }));
    setFocusedProfileId(profile.id);
    setExpandedProfileId(null);
    setPendingProfileUseId(null);
  }

  function removeProfileFromRequest(profile: CreatePersonProfile) {
    setSelectedProfileIds((current) =>
      current.filter((profileId) => profileId !== profile.id)
    );
    setProfileUseById((current) => {
      const next = { ...current };
      delete next[profile.id];
      return next;
    });
    if (focusedProfileId === profile.id) setFocusedProfileId(null);
    if (expandedProfileId === profile.id) setExpandedProfileId(null);
  }

  function removeProfile(profile: CreatePersonProfile) {
    if (profile.source === "manual") {
      setManualProfiles((current) =>
        current.filter((item) => item.id !== profile.id)
      );
      setProfileEdits((current) => {
        const next = { ...current };
        delete next[profile.id];
        return next;
      });
    }
    removeProfileFromRequest(profile);
  }

  function openProfileEditor(profile: CreatePersonProfile) {
    setFocusedProfileId(profile.id);
    setProfileEditId(profile.id);
    setProfileEditDraft(profileDraftFromProfile(profile));
  }

  function saveProfileEdit() {
    if (!profileEditId) return;
    const draft: Partial<CreatePersonProfile> = {
      name: profileEditDraft.name.trim() || "Untitled profile",
      company: profileEditDraft.company.trim(),
      role: profileEditDraft.role.trim(),
      email: profileEditDraft.email.trim(),
      phone: profileEditDraft.phone.trim(),
      notes: profileEditDraft.notes.trim(),
    };
    setProfileEdits((current) => ({
      ...current,
      [profileEditId]: {
        ...(current[profileEditId] ?? {}),
        ...draft,
      },
    }));
    setManualProfiles((current) =>
      current.map((profile) =>
        profile.id === profileEditId ? { ...profile, ...draft } : profile
      )
    );
    setProfileEditId(null);
  }

  function toggleTemplateCarry(option: TemplateCarryOption) {
    setTemplateCarry((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option]
    );
  }

  function toggleDesignDna(id: string) {
    setSelectedDesignDnaIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id].slice(0, 3);
    });
  }

  function toggleDesignDnaCarry(option: DesignDnaCarryOption) {
    setDesignDnaCarry((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option]
    );
  }

  function applyCreatePattern(pattern: CreatePatternRow) {
    const brief = pattern.createBrief;
    if (!isOutputId(brief.output.id)) return;
    const nextOutputId = brief.output.id;
    const nextOutput = OUTPUT_OPTIONS.find((option) => option.id === nextOutputId);
    if (!nextOutput) return;
    const availableChoices = outputSubchoices(nextOutput);
    const nextSubchoiceId = availableChoices.some((choice) => choice.id === brief.subtype.id)
      ? brief.subtype.id
      : "surprise";
    const nextFormat =
      nextOutput.id === "document"
        ? documentFormatFromBrief(brief.output.documentFormat) ?? documentFormat
        : undefined;

    if (brief.template) {
      setTemplateRows((current) => {
        if (current.some((row) => row.id === brief.template!.id)) return current;
        return [
          ...current,
          {
            id: brief.template!.id,
            name: brief.template!.name,
            sourceStem: "Saved pattern",
            vaultSlug: brief.template!.vaultSlug || "pattern",
            vaultName: brief.template!.vaultName || "Saved pattern",
            outlinePath: brief.template!.outlinePath || "",
            structurePath: brief.template!.structurePath || "",
            updatedAt: Date.now(),
          },
        ];
      });
    }

    if (brief.designDna?.systems?.length) {
      setDesignDnaRows((current) => {
        const next = [...current];
        for (const system of brief.designDna?.systems ?? []) {
          if (next.some((row) => row.id === system.id)) continue;
          next.push({
            id: system.id,
            slug: system.slug || system.id,
            name: system.name,
            category: system.category,
            description: system.description,
            path: system.path || "",
            updatedAt: Date.now(),
          });
        }
        return next;
      });
    }

    setSelectedPatternId(pattern.id);
    setOutputId(nextOutputId);
    setOutputSubchoiceById((current) => ({
      ...current,
      [nextOutputId]: nextSubchoiceId,
    }));
    if (nextFormat) {
      setDocumentFormat(nextFormat);
      setDocumentFormatConfirmed(true);
    }
    setExtraRouteIds(
      (brief.extraRoutes ?? [])
        .map((route) => route.id)
        .filter((id) => CREATE_EXTRA_ROUTES.some((route) => route.id === id))
    );
    setSelectedTemplateId(brief.template?.id ?? "");
    setTemplateCarry(
      optionIdsFromLabels(brief.template?.carryOver, TEMPLATE_CARRY_OPTIONS)
    );
    setSelectedDesignDnaIds(
      (brief.designDna?.systems ?? [])
        .map((system) => system.id)
        .filter(Boolean)
        .slice(0, 3)
    );
    setDesignDnaCarry(
      optionIdsFromLabels(
        brief.designDna?.carryOver,
        DESIGN_DNA_CARRY_OPTIONS,
        DEFAULT_DESIGN_DNA_CARRY
      )
    );
    setDesignDnaStrength(brief.designDna?.strength ?? "strong");
    setSelectedTuneIds(
      (brief.user.tuneTags ?? [])
        .map((tag) => tag.id)
        .filter((id) => CREATE_TUNE_TAGS.some((tag) => tag.id === id))
    );
    setPrompt((current) =>
      mergeReusableText(current, brief.user.brief || brief.user.reviewedBrief)
    );
    setSourceMaterial((current) =>
      mergeReusableText(current, brief.user.sourceMaterial)
    );
    setExactCopy((current) => mergeReusableText(current, brief.user.exactCopy));
    setDataNotes((current) => mergeReusableText(current, brief.user.dataNotes));
    const patternThemeImages = (brief.assets?.themeImages ?? [])
      .map(createImageAssetFromPattern)
      .filter((asset): asset is CreateImageAsset => Boolean(asset));
    const patternIncludeImages = (brief.assets?.includeImages ?? [])
      .map(createImageAssetFromPattern)
      .filter((asset): asset is CreateImageAsset => Boolean(asset));
    const patternUseImages = (brief.assets?.useImages ?? [])
      .map(createImageAssetFromPattern)
      .filter((asset): asset is CreateImageAsset => Boolean(asset));
    setThemeImages((current) => mergeReusableImageAssets(current, patternThemeImages));
    setIncludeImages((current) =>
      mergeReusableImageAssets(current, patternIncludeImages)
    );
    setUseImages((current) => mergeReusableImageAssets(current, patternUseImages));
    setOutputDetailId(null);
    setExtraRoutePickerOpen(false);
  }

  function clearCreatePatternLock() {
    setSelectedPatternId("");
  }

  function createPatternsForOutput(option: OutputOption): CreatePatternRow[] {
    return createPatternRows.filter((pattern) => {
      if (pattern.outputId !== option.id) return false;
      if (option.id !== "document" || !documentFormatConfirmed) return true;
      const patternFormat = documentFormatFromBrief(pattern.documentFormat);
      return !patternFormat || patternFormat === documentFormat;
    });
  }

  async function confirmDeleteCreatePattern() {
    if (!deletePatternId || deletePatternBusy) return;
    setDeletePatternBusy(true);
    try {
      const r = await fetch(`/api/create-patterns/${encodeURIComponent(deletePatternId)}`, {
        method: "DELETE",
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error || "Could not delete pattern");
      setCreatePatternRows((current) =>
        current.filter((pattern) => pattern.id !== deletePatternId)
      );
      if (selectedPatternId === deletePatternId) {
        setSelectedPatternId("");
      }
      setDeletePatternId(null);
    } catch (error: unknown) {
      setPatternsError(error instanceof Error ? error.message : "Could not delete pattern");
    } finally {
      setDeletePatternBusy(false);
    }
  }

  function clearCreateTipDelay() {
    if (!tipDelayRef.current) return;
    clearTimeout(tipDelayRef.current);
    tipDelayRef.current = null;
  }

  function shouldSuppressCreateTip(pointerType?: string) {
    if (pointerType && pointerType !== "mouse") return true;
    if (typeof window === "undefined") return false;
    return window.matchMedia("(hover: none)").matches;
  }

  function showCreateTip(el: HTMLElement) {
    const text = el.dataset.createTip?.trim();
    if (!text) return;
    const rect = el.getBoundingClientRect();
    const placement = rect.top < 96 ? "bottom" : "top";
    setActiveTip({
      text,
      x: rect.left + rect.width / 2,
      y: placement === "top" ? rect.top : rect.bottom,
      placement,
    });
  }

  function scheduleCreateTip(el: HTMLElement, pointerType?: string) {
    clearCreateTipDelay();
    if (!hoverTipsEnabled) {
      setActiveTip(null);
      return;
    }
    if (shouldSuppressCreateTip(pointerType)) {
      setActiveTip(null);
      return;
    }
    tipDelayRef.current = setTimeout(() => {
      tipDelayRef.current = null;
      showCreateTip(el);
    }, CREATE_TIP_DELAY_MS);
  }

  function handleTipPointerOver(e: PointerEvent<HTMLDivElement>) {
    const target = e.target instanceof Element ? e.target : null;
    const el = target?.closest<HTMLElement>("[data-create-tip]");
    if (!el || !e.currentTarget.contains(el)) return;
    scheduleCreateTip(el, e.pointerType);
  }

  function handleTipPointerOut(e: PointerEvent<HTMLDivElement>) {
    const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (next?.closest("[data-create-tip]")) return;
    clearCreateTipDelay();
    setActiveTip(null);
  }

  function handleTipFocus(e: FocusEvent<HTMLDivElement>) {
    const target = e.target instanceof Element ? e.target : null;
    const el = target?.closest<HTMLElement>("[data-create-tip]");
    if (!el || !e.currentTarget.contains(el)) return;
    scheduleCreateTip(el);
  }

  function toggleImageTag(kind: ImageKind, id: string, tag: ImageTag) {
    const update = (asset: CreateImageAsset) => {
      if (asset.id !== id) return asset;
      const autoTag: ImageTag | null =
        kind === "include" ? "auto" : kind === "use" ? "auto_adapt" : null;
      const hasTag = asset.tags.includes(tag);
      if (autoTag && tag === autoTag) {
        return { ...asset, tags: hasTag && asset.tags.length === 1 ? [] : [autoTag] };
      }
      const baseTags = autoTag
        ? asset.tags.filter((current) => current !== autoTag)
        : asset.tags;
      const nextTags = hasTag
        ? baseTags.filter((current) => current !== tag)
        : [...baseTags, tag];
      return {
        ...asset,
        tags: nextTags.length > 0 || !autoTag ? nextTags : [autoTag],
      };
    };
    if (kind === "theme") setThemeImages((current) => current.map(update));
    else if (kind === "use") setUseImages((current) => current.map(update));
    else setIncludeImages((current) => current.map(update));
  }

  function buildSeedPrompt(
    reviewedBrief?: string,
    mode: CreateProductionMode = DEFAULT_CREATE_PRODUCTION_MODE
  ) {
    const promptTrim = prompt.trim();
    const sourceMaterialTrim = sourceMaterial.trim();
    const exactCopyTrim = exactCopy.trim();
    const reviewedTrim = reviewedBrief?.trim();
    const finalBrief = reviewedTrim || promptTrim;
    const dataTrim = dataNotes.trim();
    const pieces: string[] = [
      "CREATE BRIEF",
      `Mode: ${mode === "frontier" ? "Creative Studio" : "Quick Create"}.`,
      mode === "frontier"
        ? "Quality target: best-results mode. Prioritize source and vault grounding when available, route fit, design quality, and targeted QA/fix loops over speed; do not stop at the first plausible draft."
        : "Quality target: fast, focused first pass.",
      `Output: ${outputDisplayName(selectedOutput)}${
        selectedOutput.id === "document"
          ? ` (${selectedDocumentFormat.label})`
          : ""
      }.`,
      `Category: ${selectedOutput.label}.`,
      selectedOutputSubchoice.id === "surprise"
        ? "Subtype: Surprise me."
        : `Subtype selected: ${selectedOutputSubchoice.label}.`,
      selectedOutputSubchoice.routeHint
        ? `Route hint: ${selectedOutputSubchoice.routeHint}`
        : null,
      selectedExtraRoutes.length > 0
        ? `Extra route hints:\n${selectedExtraRoutes
            .map((route) => `- ${route.label}: ${route.routeHint}`)
            .join("\n")}`
        : null,
    ].filter(Boolean) as string[];
    if (isMotionOutput) {
      pieces.push(
        `Motion input discipline:\n${MOTION_CREATE_BRIEF_RULES.map(
          (rule) => `- ${rule}`
        ).join("\n")}\nBefore building, make a private motion recipe: aspect ratio, total duration or loop length, 2-4 beats, one primary message, one hero subject/asset, palette, type scale, movement vocabulary, and asset roles. Keep visible text short and do not animate dense source copy.`
      );
    }
    if (finalBrief) pieces.push(`Goal:\n${finalBrief}`);
    if (sourceMaterialTrim) {
      pieces.push(
        isMotionOutput
          ? `Motion source material:\n${sourceMaterialTrim}\n\nUse this to choose the story, captions, and beat list. Do not put paragraphs or the whole source on screen; reduce it to 2-4 clear beats and a few short on-screen lines.`
          : `Source material:\n${sourceMaterialTrim}\n\nUse as raw material. Rewrite, restructure, summarize, polish, or design around it according to the goal.`
      );
    }
    if (exactCopyTrim) {
      pieces.push(
        isMotionOutput
          ? `Exact on-screen wording to keep:\n${exactCopyTrim}\n\nUse only the marked line(s) that fit the beat list. Do not turn exact copy into long animated paragraphs.`
          : `Exact wording to keep:\n${exactCopyTrim}`
      );
    }
    if (themeImages.length > 0) {
      pieces.push(
        `Theme/style image references:\n${themeImages
          .map((asset, index) => {
            const caption = asset.caption.trim();
            const focus = THEME_FOCUS_OPTIONS.filter((option) =>
              asset.tags.includes(option.id)
            )
              .map((option) => option.label)
              .join(", ");
            const snippet = themeAnalysisSnippet(asset);
            return `- ${index + 1}. ${asset.serverUrl}${asset.toolPath ? `\n  Local path: ${asset.toolPath}` : ""}${caption ? `\n  Caption: ${caption}` : ""}${focus ? `\n  Focus: ${focus}` : ""}${snippet ? `\n  Style guidance:\n${snippet}` : ""}`;
          })
          .join("\n")}\n${
          isMotionOutput
            ? "Choose one dominant style reference for palette/composition/motion mood. Treat the rest as backup context, not extra things to show."
            : "Use for visual direction only unless the goal asks to place them as content."
        }`
      );
    }
    if (includeImages.length > 0) {
      pieces.push(
        `Images to include in the output:\n${includeImages
          .map((asset, index) => {
            const caption = asset.caption.trim();
            const placement = imageTagLabels("include", asset.tags)[0];
            return `- ${index + 1}. ${asset.serverUrl}${asset.toolPath ? `\n  Local path: ${asset.toolPath}` : ""}${caption ? `\n  Caption: ${caption}` : ""}${placement ? `\n  Placement: ${placement}` : ""}`;
          })
          .join("\n")}\n${
          isMotionOutput
            ? "Use at most one as the hero visual asset unless the user explicitly asked for multiple visible images. Do not turn the motion into a gallery."
            : "Use visibly when the goal or placement calls for it."
        }`
      );
    }
    if (useImages.length > 0) {
      pieces.push(
        `Images to use/adapt:\n${useImages
          .map((asset, index) => {
            const caption = asset.caption.trim();
            const treatment = imageTagLabels("use", asset.tags)[0];
            return `- ${index + 1}. ${asset.serverUrl}${asset.toolPath ? `\n  Local path: ${asset.toolPath}` : ""}${caption ? `\n  Caption: ${caption}` : ""}${treatment ? `\n  Treatment: ${treatment}` : ""}`;
          })
          .join("\n")}\n${
          isMotionOutput
            ? "Use as editable source material for one hero asset, texture, or motif unless the brief explicitly asks for more. Crop/reframe/restyle to support the beat list instead of adding more visual noise."
            : "Use as editable source material. You may crop, reframe, recolor, mask, clean up, composite, restyle, or derive visual elements/backgrounds from these images to fit the artifact. Preserve recognizable substance only when the caption or treatment asks for it."
        }`
      );
    }
    const dataVault = dataVaultSlug
      ? vaultRows.find((row) => row.slug === dataVaultSlug) ?? null
      : null;
    if (dataVault && (dataVaultWhole || selectedVaultFilePaths.length > 0)) {
      const selectedNames = dataVaultFiles.filter((file) =>
        selectedVaultFilePaths.includes(file.relativePath)
      );
      pieces.push(
        `Vault source: ${(dataVault.name || dataVault.slug).trim()} (${dataVault.slug}).\nUse ingested vault knowledge and selected files.\nScope: ${
          dataVaultWhole
            ? "whole vault"
            : `selected source files:\n${selectedNames
                .map((file) => `- ${file.name} (${file.relativePath})`)
                .concat(
                  selectedVaultFilePaths
                    .filter(
                      (relativePath) =>
                        !selectedNames.some((file) => file.relativePath === relativePath)
                    )
                    .map((relativePath) => `- ${relativePath}`)
                )
                .join("\n")}`
        }`
      );
    }
    if (dataTrim) {
      pieces.push(
        isMotionOutput
          ? `Optional motion context:\n${dataTrim}\n\nUse only the facts needed for the beat list; do not put raw notes or data dumps on screen.`
          : `Optional data/context:\n${dataTrim}`
      );
    }
    if (rawFiles.length > 0) {
      pieces.push(
        `Raw uploaded files from this Create flow:\n${rawFiles
          .map((file) => {
            const role = RAW_FILE_ROLES.find((option) => option.id === file.role);
            return `- ${file.name} (${file.mimeType}, ${formatCompactBytes(file.size)})\n  URL: ${file.url}${file.toolPath ? `\n  Local path: ${file.toolPath}` : ""}\n  Role: ${role?.label ?? file.role}${role?.hint ? ` - ${role.hint}` : ""}`;
          })
          .join("\n")}\n${
          isMotionOutput
            ? "Extract only the story facts, captions, or visual references needed for the motion recipe. Do not make every file a visible scene."
            : "Use as direct source material; preserve substance for refactor/restyle roles."
        }`
      );
    }
    if (selectedProfiles.length > 0) {
      pieces.push(
        `People profiles selected in Create:\n${selectedProfiles
          .map((profile) => {
            const kind =
              profile.kind === "company" ? "your team" : "person";
            const evidence = (profile.evidencePaths ?? []).slice(0, 4);
            const useMode = profileUseOption(profileUseById[profile.id]);
            return `- ${profile.name} (${kind})${useMode ? `\n  Use as: ${useMode.promptLabel}` : ""}${profile.company ? `\n  Group: ${profile.company}` : ""}${profile.role ? `\n  Role: ${profile.role}` : ""}${profile.email ? `\n  Email: ${profile.email}` : ""}${profile.phone ? `\n  Phone: ${profile.phone}` : ""}${profile.vaultName ? `\n  Source vault: ${profile.vaultName}` : ""}${profile.notes ? `\n  Notes: ${profile.notes}` : ""}${evidence.length > 0 ? `\n  Evidence:\n${evidence.map((item) => `    - ${item}`).join("\n")}` : ""}`;
          })
          .join("\n")}\n${
          isMotionOutput
            ? "Use people for audience, tone, names, and context only. Put a person on screen only if the brief asks for that."
            : "Use for audience, tone, names, roles, contact details, and context."
        }`
      );
    }
    if (selectedTemplate) {
      const selectedCarry = TEMPLATE_CARRY_OPTIONS.filter((option) =>
        templateCarry.includes(option.id)
      );
      pieces.push(
        `Template selected in Create:\n- Name: ${selectedTemplate.name}\n- Vault: ${selectedTemplate.vaultName} (${selectedTemplate.vaultSlug})\n- Outline: ${selectedTemplate.outlinePath}\n- Structure: ${selectedTemplate.structurePath}\nCarry-over choices: ${
          selectedCarry.length > 0
            ? selectedCarry.map((option) => option.label).join(", ")
            : "Auto"
        }.`
      );
    }
    if (selectedDesignDnaRows.length > 0) {
      const selectedCarry = DESIGN_DNA_CARRY_OPTIONS.filter((option) =>
        designDnaCarry.includes(option.id)
      );
      const strength = DESIGN_DNA_STRENGTH_OPTIONS.find(
        (option) => option.id === designDnaStrength
      );
      pieces.push(
        `Design DNA selected in Create:\n${selectedDesignDnaRows
          .map((row, index) => {
            const role = index === 0 ? "Primary" : "Secondary";
            return `- ${role}: ${row.name}${row.category ? ` (${row.category})` : ""}\n  DESIGN.md: ${row.path}${row.description ? `\n  Profile: ${row.description}` : ""}`;
          })
          .join("\n")}\nCarry over: ${
          selectedCarry.length > 0
            ? selectedCarry.map((option) => option.label).join(", ")
            : "Auto"
        }.\nMedium translation: ${mediumDnaGuidance(
          selectedOutput,
          selectedOutput.id === "document" ? selectedDocumentFormat.id : undefined
        )}\nReference strength: ${strength?.label ?? designDnaStrength}.\nDo not copy logos, brand names, proprietary copy, or exact assets; translate the design DNA into a fresh artifact for this brief.`
      );
    }
    if (
      !promptTrim &&
      !sourceMaterialTrim &&
      !exactCopyTrim &&
      themeImages.length === 0 &&
      includeImages.length === 0 &&
      useImages.length === 0 &&
      !(dataVaultSlug && (dataVaultWhole || selectedVaultFilePaths.length > 0)) &&
      !dataTrim &&
      rawFiles.length === 0 &&
      selectedProfiles.length === 0 &&
      !selectedTemplate &&
      selectedDesignDnaRows.length === 0
    ) {
      pieces.push(
        "No extra brief was provided. Choose a clean, useful direction and make the first output easy to revise."
      );
    }
    return pieces.join("\n\n");
  }

  function buildCreateProductionBrief(
    reviewedBrief?: string,
    mode: CreateProductionMode = DEFAULT_CREATE_PRODUCTION_MODE
  ): CreateProductionBrief {
    const promptTrim = prompt.trim();
    const sourceMaterialTrim = sourceMaterial.trim();
    const exactCopyTrim = exactCopy.trim();
    const reviewedTrim = reviewedBrief?.trim();
    const dataTrim = dataNotes.trim();
    const dataVault = dataVaultSlug
      ? vaultRows.find((row) => row.slug === dataVaultSlug) ?? null
      : null;
    const selectedVaultNames = dataVaultFiles.filter((file) =>
      selectedVaultFilePaths.includes(file.relativePath)
    );
    const selectedCarry = TEMPLATE_CARRY_OPTIONS.filter((option) =>
      templateCarry.includes(option.id)
    );
    const selectedDesignCarry = DESIGN_DNA_CARRY_OPTIONS.filter((option) =>
      designDnaCarry.includes(option.id)
    );
    const tuneTags = CREATE_TUNE_TAGS.filter((tag) => selectedTuneIds.includes(tag.id));

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      creationMode: mode,
      intent: selectedCreateIntent,
      output: {
        id: selectedOutput.id,
        label: selectedOutput.label,
        displayName: outputDisplayName(selectedOutput),
        ...(selectedOutput.id === "document"
          ? { documentFormat: selectedDocumentFormat.label }
          : {}),
      },
      subtype: {
        id: selectedOutputSubchoice.id,
        label: selectedOutputSubchoice.label,
        ...(selectedOutputSubchoice.routeHint
          ? { routeHint: selectedOutputSubchoice.routeHint }
          : {}),
      },
      ...(selectedExtraRoutes.length > 0
        ? {
            extraRoutes: selectedExtraRoutes.map((route) => ({
              id: route.id,
              label: route.label,
              routeHint: route.routeHint,
            })),
          }
        : {}),
      openDesign: {
        candidateSkills: selectedOutput.skills,
      },
      user: {
        ...(promptTrim ? { brief: promptTrim } : {}),
        ...(reviewedTrim ? { reviewedBrief: reviewedTrim } : {}),
        ...(sourceMaterialTrim ? { sourceMaterial: sourceMaterialTrim } : {}),
        ...(exactCopyTrim ? { exactCopy: exactCopyTrim } : {}),
        ...(dataTrim ? { dataNotes: dataTrim } : {}),
        ...(tuneTags.length > 0
          ? {
              tuneTags: tuneTags.map((tag) => ({
                id: tag.id,
                label: tag.label,
                profile: tag.profile,
              })),
            }
          : {}),
      },
      assets: {
        ...(themeImages.length > 0
          ? {
              themeImages: themeImages.map((asset) => {
                const snippet = themeAnalysisSnippet(asset);
                return {
                  id: asset.id,
                  name: asset.name,
                  url: asset.serverUrl,
                  ...(asset.toolPath ? { toolPath: asset.toolPath } : {}),
                  ...(asset.caption.trim() ? { caption: asset.caption.trim() } : {}),
                  tags: asset.tags,
                  ...(snippet || isMotionOutput
                    ? {
                        guidance: isMotionOutput
                          ? `${snippet ? `${snippet}\n` : ""}Motion rule: use as style reference only; choose one dominant style reference and avoid adding extra visible content.`
                          : snippet,
                      }
                    : {}),
                };
              }),
            }
          : {}),
        ...(includeImages.length > 0
          ? {
              includeImages: includeImages.map((asset) => ({
                id: asset.id,
                name: asset.name,
                url: asset.serverUrl,
                ...(asset.toolPath ? { toolPath: asset.toolPath } : {}),
                ...(asset.caption.trim() ? { caption: asset.caption.trim() } : {}),
                tags: asset.tags,
                ...(isMotionOutput
                  ? {
                      guidance:
                        "Motion rule: use as a visible hero asset only if it serves the beat list; use at most one include image unless the user explicitly asks for more.",
                    }
                  : {}),
              })),
            }
          : {}),
        ...(useImages.length > 0
          ? {
              useImages: useImages.map((asset) => ({
                id: asset.id,
                name: asset.name,
                url: asset.serverUrl,
                ...(asset.toolPath ? { toolPath: asset.toolPath } : {}),
                ...(asset.caption.trim() ? { caption: asset.caption.trim() } : {}),
                tags: asset.tags,
                guidance:
                  isMotionOutput
                    ? "Motion editable image source: crop, reframe, recolor, mask, clean up, or derive one hero asset, texture, or motif that supports the beat list; avoid visual clutter."
                    : "Editable/adaptable image source: crop, reframe, recolor, mask, clean up, composite, restyle, or derive elements/backgrounds as needed.",
              })),
            }
          : {}),
        ...(rawFiles.length > 0
          ? {
              rawFiles: rawFiles.map((file) => {
                const role = RAW_FILE_ROLES.find((option) => option.id === file.role);
                return {
                  id: file.id,
                  name: file.name,
                  url: file.url,
                  ...(file.toolPath ? { toolPath: file.toolPath } : {}),
                  mimeType: file.mimeType,
                  size: file.size,
                  role: file.role,
                  ...(role?.hint || isMotionOutput
                    ? {
                        guidance: isMotionOutput
                          ? `${role?.hint ? `${role.hint} ` : ""}Motion rule: extract only story facts, captions, timing notes, or one required asset; do not make every file visible.`
                          : role?.hint,
                      }
                    : {}),
                };
              }),
            }
          : {}),
      },
      ...(dataVault && (dataVaultWhole || selectedVaultFilePaths.length > 0)
        ? {
            vault: {
              slug: dataVault.slug,
              name: (dataVault.name || dataVault.slug).trim(),
              visibility: dataVaultKind(dataVault),
              scope: dataVaultWhole ? "whole" : "selected",
              ...(dataVaultWhole
                ? {}
                : {
                    selectedFiles: selectedVaultNames
                      .map((file) => ({
                        name: file.name,
                        relativePath: file.relativePath,
                      }))
                      .concat(
                        selectedVaultFilePaths
                          .filter(
                            (relativePath) =>
                              !selectedVaultNames.some(
                                (file) => file.relativePath === relativePath
                              )
                          )
                          .map((relativePath) => ({
                            name: relativePath.split(/[\\/]/).pop() || relativePath,
                            relativePath,
                          }))
                      ),
                  }),
            },
          }
        : {}),
      ...(selectedProfiles.length > 0
        ? {
            people: selectedProfiles.map((profile) => {
              const useMode = profileUseOption(profileUseById[profile.id]);
              return {
                id: profile.id,
                name: profile.name,
                kind: profile.kind,
                ...(profile.company ? { company: profile.company } : {}),
                ...(profile.role ? { role: profile.role } : {}),
                ...(profile.email ? { email: profile.email } : {}),
                ...(profile.phone ? { phone: profile.phone } : {}),
                ...(profile.notes ? { notes: profile.notes } : {}),
                ...(useMode ? { useAs: useMode.promptLabel } : {}),
                ...(profile.vaultName ? { vaultName: profile.vaultName } : {}),
                ...(profile.evidencePaths?.length
                  ? { evidencePaths: profile.evidencePaths.slice(0, 8) }
                  : {}),
              };
            }),
          }
        : {}),
      ...(selectedTemplate
        ? {
            template: {
              id: selectedTemplate.id,
              name: selectedTemplate.name,
              vaultSlug: selectedTemplate.vaultSlug,
              vaultName: selectedTemplate.vaultName,
              outlinePath: selectedTemplate.outlinePath,
              structurePath: selectedTemplate.structurePath,
              ...(selectedCarry.length > 0
                ? { carryOver: selectedCarry.map((option) => option.label) }
                : {}),
            },
          }
        : {}),
      ...(selectedDesignDnaRows.length > 0
        ? {
            designDna: {
              systems: selectedDesignDnaRows.map((row) => ({
                id: row.id,
                slug: row.slug,
                name: row.name,
                ...(row.category ? { category: row.category } : {}),
                ...(row.description ? { description: row.description } : {}),
                path: row.path,
              })),
              carryOver: selectedDesignCarry.map((option) => option.label),
              strength: designDnaStrength,
              avoidCopying: [
                "logos",
                "brand names",
                "proprietary copy",
                "exact assets",
              ],
            },
          }
        : {}),
    };
  }

  function finish(mode: CreateProductionMode) {
    const dataVault = dataVaultSlug
      ? vaultRows.find((row) => row.slug === dataVaultSlug) ?? null
      : null;
    const referenceVault = dataVault && (dataVaultWhole || selectedVaultFilePaths.length > 0)
      ? {
          slug: dataVault.slug,
          name: (dataVault.name || dataVault.slug).trim(),
        }
      : null;
    onContinue(
      selectedCreateIntent,
      buildSeedPrompt(reviewBriefDraft, mode),
      referenceVault,
      buildCreateProductionBrief(reviewBriefDraft, mode)
    );
    clearCreateDraft();
  }

  function requestFinish() {
    finish(DEFAULT_CREATE_PRODUCTION_MODE);
  }

  function buildReviewBrief() {
    const promptTrim = stripTuneSection(prompt.trim());
    const sourceMaterialTrim = sourceMaterial.trim();
    const exactCopyTrim = exactCopy.trim();
    const lines: string[] = [
      "What I want:",
      promptTrim ||
        (sourceMaterialTrim
          ? `Turn the supplied material into a sharp ${outputDisplayName(selectedOutput).toLowerCase()} result.`
          : `Create a sharp ${outputDisplayName(selectedOutput).toLowerCase()} result. Use the selected inputs and make a clean first version that is easy to revise.`),
    ];

    if (isMotionOutput) {
      lines.push("");
      lines.push("Motion rules:");
      MOTION_CREATE_BRIEF_RULES.forEach((rule) => lines.push(`- ${rule}`));
    }

    if (sourceMaterialTrim) {
      lines.push("");
      lines.push(isMotionOutput ? "Story / caption material (optional):" : "Material to use (optional):");
      lines.push(
        `${compactPromptBucketPreview(sourceMaterialTrim)} (${sourceMaterialTrim.length} characters supplied)`
      );
    }

    if (exactCopyTrim) {
      lines.push("");
      lines.push(
        isMotionOutput
          ? "Exact on-screen wording to keep (optional):"
          : "Exact wording to keep (optional):"
      );
      lines.push(
        `${compactPromptBucketPreview(exactCopyTrim)} (${exactCopyTrim.length} characters supplied)`
      );
    }

    if (themeImages.length > 0) {
      lines.push("");
      lines.push(isMotionOutput ? "Use at most one dominant style reference:" : "Use these as style references:");
      themeImages.forEach((asset, index) => {
        const labels = imageTagLabels("theme", asset.tags);
        const caption = asset.caption.trim();
        const styleSummary = compactThemeAnalysisSummary(asset);
        lines.push(
          `- ${caption || readableCreateFileName(asset.name, "style image", index)}${
            labels.length > 0 ? ` (${labels.join(", ")})` : ""
          }${styleSummary ? `\n  Style read: ${styleSummary}` : ""}`
        );
      });
    }

    if (includeImages.length > 0) {
      lines.push("");
      lines.push(isMotionOutput ? "Potential hero image to include:" : "Include these images where useful:");
      includeImages.forEach((asset, index) => {
        const labels = imageTagLabels("include", asset.tags);
        const caption = asset.caption.trim();
        lines.push(
          `- ${caption || readableCreateFileName(asset.name, "content image", index)}${
            labels.length > 0 ? ` (${labels.join(", ")})` : ""
          }`
        );
      });
    }

    if (useImages.length > 0) {
      lines.push("");
      lines.push(
        isMotionOutput
          ? "Potential hero/motif images to adapt:"
          : "Use these images as editable source material:"
      );
      useImages.forEach((asset, index) => {
        const labels = imageTagLabels("use", asset.tags);
        const caption = asset.caption.trim();
        lines.push(
          `- ${caption || readableCreateFileName(asset.name, "editable image", index)}${
            labels.length > 0 ? ` (${labels.join(", ")})` : ""
          }`
        );
      });
      lines.push(
        isMotionOutput
          ? "Hermes should adapt only what supports the beat list, usually one hero asset, texture, or motif."
          : "Hermes may adapt these: crop, reframe, recolor, mask, clean up, composite, restyle, or derive visual elements/backgrounds from them."
      );
    }

    const dataVault = dataVaultSlug
      ? vaultRows.find((row) => row.slug === dataVaultSlug) ?? null
      : null;
    if (dataVault && (dataVaultWhole || selectedVaultFilePaths.length > 0)) {
      const selectedNames = dataVaultFiles.filter((file) =>
        selectedVaultFilePaths.includes(file.relativePath)
      );
      lines.push("");
      lines.push(
        `Use vault knowledge from ${dataVault.name || dataVault.slug}${
          dataVaultWhole || selectedNames.length === 0
            ? "."
            : `, especially ${selectedNames.map((file) => file.name).join(", ")}.`
        }`
      );
    }

    if (dataNotes.trim()) {
      lines.push("");
      lines.push("Extra notes:");
      lines.push(dataNotes.trim());
    }

    if (rawFiles.length > 0) {
      lines.push("");
      lines.push("Use these uploaded files:");
      rawFiles.forEach((file) => {
        lines.push(`- ${readableCreateFileName(file.name, "file")} (${rawRoleLabel(file.role)})`);
      });
    }

    if (selectedProfiles.length > 0) {
      lines.push("");
      lines.push("Consider these people:");
      selectedProfiles.forEach((profile) => {
        lines.push(
          `- ${profile.name}${
            [profile.role, profile.company].filter(Boolean).length > 0
              ? `, ${[profile.role, profile.company].filter(Boolean).join(", ")}`
              : ""
          }`
        );
      });
    }

    if (selectedTemplate) {
      const selectedCarry = TEMPLATE_CARRY_OPTIONS.filter((option) =>
        templateCarry.includes(option.id)
      );
      lines.push("");
      lines.push(
        `Use the ${selectedTemplate.name} template${
          selectedCarry.length > 0
            ? ` for ${selectedCarry.map((option) => option.label.toLowerCase()).join(", ")}`
            : ""
        }.`
      );
    }

    if (selectedDesignDnaRows.length > 0) {
      const selectedCarry = DESIGN_DNA_CARRY_OPTIONS.filter((option) =>
        designDnaCarry.includes(option.id)
      );
      const strength = DESIGN_DNA_STRENGTH_OPTIONS.find(
        (option) => option.id === designDnaStrength
      );
      lines.push("");
      lines.push(
        `Use Design DNA from ${selectedDesignDnaRows
          .map((row) => row.name)
          .join(", ")}${
          selectedCarry.length > 0
            ? ` for ${selectedCarry.map((option) => option.label.toLowerCase()).join(", ")}`
            : ""
        }. ${mediumDnaGuidance(
          selectedOutput,
          selectedOutput.id === "document" ? selectedDocumentFormat.id : undefined
        )} Strength: ${strength?.label ?? designDnaStrength}. Do not copy logos, brand names, proprietary copy, or exact assets.`
      );
    }

    const tuneSection = buildTuneSection(selectedTuneIds);
    if (tuneSection) {
      lines.push("");
      lines.push(tuneSection);
    }

    return lines.join("\n");
  }

  function openReviewModule() {
    setImageModuleOpen(false);
    setDataModuleOpen(false);
    setClientModuleOpen(false);
    setTemplateModuleOpen(false);
    setDesignDnaModuleOpen(false);
    setActivePanel(null);
    setReviewBriefDraft(buildReviewBrief());
    setReviewModuleOpen(true);
  }

  function setTuneIds(nextIds: string[]) {
    setSelectedTuneIds(nextIds);
    setReviewBriefDraft((current) => {
      const base = stripTuneSection(current || buildReviewBrief());
      const tuneSection = buildTuneSection(nextIds);
      return tuneSection ? `${base}\n\n${tuneSection}` : base;
    });
  }

  function toggleTuneTag(id: string) {
    setTuneIds(
      selectedTuneIds.includes(id)
        ? selectedTuneIds.filter((current) => current !== id)
        : [...selectedTuneIds, id]
    );
  }

  function clearTuneTags() {
    setTuneIds([]);
  }

  const clientLabel = selectedProfiles.length > 0
      ? selectedProfiles.length === 1
        ? selectedProfiles[0]?.name || "Person"
        : `${selectedProfiles.length} people`
    : "People";
  const imageSummary =
    themeImages.length > 0 || includeImages.length > 0 || useImages.length > 0
      ? `${themeImages.length} style · ${includeImages.length} include · ${useImages.length} adapt`
      : "Optional";
  const dataSummary =
    (dataVaultSlug && (dataVaultWhole || selectedVaultFilePaths.length > 0)) ||
    dataNotes.trim() ||
    rawFiles.length > 0
      ? [
          dataVaultSlug && (dataVaultWhole || selectedVaultFilePaths.length > 0) ? "Vault" : "",
          dataNotes.trim() ? "Text" : "",
          rawFiles.length > 0 ? `${rawFiles.length} file${rawFiles.length === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "Optional";
  const templateSummary = selectedTemplate
    ? templateCarry.length > 0
      ? `${selectedTemplate.name} · ${templateCarry.length} opts`
      : selectedTemplate.name
    : "Optional";
  const dnaSummary =
    selectedDesignDnaRows.length > 0
      ? selectedDesignDnaRows.length === 1
        ? selectedDesignDnaRows[0]?.name || "Design DNA"
        : `${selectedDesignDnaRows[0]?.name || "Design DNA"} +${selectedDesignDnaRows.length - 1}`
      : "Optional";
  const designDnaHasGuidance = selectedDesignDnaRows.length > 0;
  const mainDataVault = dataVaultSlug
    ? vaultRows.find((row) => row.slug === dataVaultSlug) ?? null
    : null;
  const mainSelectedVaultFiles = dataVaultFiles.filter((file) =>
    selectedVaultFilePaths.includes(file.relativePath)
  );
  const mainDataVaultHasScope = Boolean(
    mainDataVault && (dataVaultWhole || mainSelectedVaultFiles.length > 0)
  );
  const mainSourceFiles = rawFiles.filter((file) => !isFinishedDocRole(file.role));
  const mainFinishedDocs = rawFiles.filter((file) => isFinishedDocRole(file.role));
  const mainImageAssets = [
    ...themeImages.map((asset) => ({ kind: "theme" as const, asset })),
    ...includeImages.map((asset) => ({ kind: "include" as const, asset })),
    ...useImages.map((asset) => ({ kind: "use" as const, asset })),
  ];

  function renderVoiceButton(
    target: CreateVoiceTarget,
    label: string
  ) {
    const isActiveTarget = voiceTarget === target;
    const isLiveTarget =
      isActiveTarget && (voiceState === "recording" || voiceState === "processing");
    const disabled =
      busy ||
      voiceState === "processing" ||
      (voiceState === "recording" && voiceTargetRef.current !== target);
    return (
      <button
        type="button"
        onClick={() => handleVoicePressFor(target)}
        disabled={disabled}
        className={`neu-selected create-studio-mic-button ${
          isLiveTarget ? "is-recording" : ""
        }`.trim()}
        aria-label={
          voiceState === "recording" && isActiveTarget ? `Stop ${label}` : label
        }
        data-create-tip={label}
      >
        {isLiveTarget ? (
          <div className="create-studio-mic-wave">
            <LiveWaveform
              active={false}
              processing={true}
              barWidth={1.5}
              barGap={1}
              barColor="#a3c4f3"
              height={16}
              mode="static"
              fadeEdges={true}
              fadeWidth={5}
              className="w-full"
            />
          </div>
        ) : (
          <MicIcon className="create-studio-mic-icon" aria-hidden />
        )}
      </button>
    );
  }

  function renderMainContextBoard() {
    const hasImages = mainImageAssets.length > 0;
    const hasData = Boolean(mainDataVaultHasScope || dataNotes.trim() || rawFiles.length > 0);
    const hasPeople = selectedProfiles.length > 0;
    const hasTemplate = Boolean(selectedTemplate || selectedDesignDnaRows.length > 0);
    if (!hasImages && !hasData && !hasPeople && !hasTemplate) return null;

    return (
      <div className="create-studio-context-board">
        {hasImages ? (
          <section className="create-studio-context-card">
          <div className="create-studio-context-head">
            <span>
              <ImageIcon className="size-3.5" aria-hidden />
              Images
            </span>
            <button
              type="button"
              onClick={() => {
                setActivePanel(null);
                setReviewModuleOpen(false);
                setClientModuleOpen(false);
                setDataModuleOpen(false);
                setTemplateModuleOpen(false);
                setDesignDnaModuleOpen(false);
                setImageModuleOpen(true);
              }}
              disabled={busy}
              className="create-studio-context-edit"
              data-create-tip="Add or edit image references."
            >
              {mainImageAssets.length > 0 ? "Edit" : "Add"}
            </button>
          </div>
          <div className="create-studio-context-image-grid">
            {mainImageAssets.slice(0, 4).map(({ kind, asset }, index) => {
              const labels = imageTagLabels(kind, asset.tags);
              return (
                <article key={asset.id} className="create-studio-context-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.previewUrl} alt="" />
                  <div>
                    <strong>
                      {asset.caption.trim() ||
                        readableCreateFileName(
                          asset.name,
                          kind === "theme"
                            ? "style image"
                            : kind === "use"
                              ? "editable image"
                              : "content image",
                          index
                        )}
                    </strong>
                    <small>
                      {kind === "theme" ? "Style" : kind === "use" ? "Adapt" : "Include"} ·{" "}
                      {labels.length > 0 ? labels.join(", ") : "Auto"}
                    </small>
                  </div>
                </article>
              );
            })}
            {mainImageAssets.length > 4 ? (
              <p className="create-studio-context-more">
                +{mainImageAssets.length - 4} more image
                {mainImageAssets.length - 4 === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        </section>
        ) : null}

        {hasData ? (
          <section className="create-studio-context-card">
          <div className="create-studio-context-head">
            <span>
              <PaperclipIcon className="size-3.5" aria-hidden />
              Data/files
            </span>
            <button
              type="button"
              onClick={() => {
                setActivePanel(null);
                setReviewModuleOpen(false);
                setImageModuleOpen(false);
                setClientModuleOpen(false);
                setTemplateModuleOpen(false);
                setDesignDnaModuleOpen(false);
                setDataModuleOpen(true);
              }}
              disabled={busy}
              className="create-studio-context-edit"
              data-create-tip="Add or edit data, notes, files, and finished docs."
            >
              {dataSummary === "Optional" ? "Add" : "Edit"}
            </button>
          </div>
          <div className="create-studio-context-lines">
            <p>
              <strong>Vault:</strong>{" "}
                {mainDataVaultHasScope && mainDataVault
                  ? `${mainDataVault.name || mainDataVault.slug} · ${
                      dataVaultWhole
                        ? "whole"
                        : `${mainSelectedVaultFiles.length} picked`
                    }`
                : "None"}
            </p>
            <p>
              <strong>Notes:</strong>{" "}
              {dataNotes.trim() ? dataNotes.trim().slice(0, 96) : "None"}
            </p>
            <p>
              <strong>Files:</strong>{" "}
              {mainSourceFiles.length + mainFinishedDocs.length > 0
                ? [...mainSourceFiles, ...mainFinishedDocs]
                    .slice(0, 3)
                    .map((file) => file.name)
                    .join(", ")
                : "None"}
            </p>
          </div>
        </section>
        ) : null}

        {hasPeople ? (
          <section className="create-studio-context-card">
          <div className="create-studio-context-head">
            <span>
              <UserRoundIcon className="size-3.5" aria-hidden />
              People
            </span>
            <button
              type="button"
              onClick={() => {
                setActivePanel(null);
                setReviewModuleOpen(false);
                setImageModuleOpen(false);
                setDataModuleOpen(false);
                setTemplateModuleOpen(false);
                setDesignDnaModuleOpen(false);
                setClientModuleOpen(true);
              }}
              disabled={busy}
              className="create-studio-context-edit"
              data-create-tip="Add or edit people context."
            >
              {selectedProfiles.length > 0 ? "Edit" : "Add"}
            </button>
          </div>
          <div className="create-studio-context-lines">
            {selectedProfiles.slice(0, 4).map((profile) => (
              <p key={profile.id}>
                <strong>{profile.name}</strong>{" "}
                {[profile.role, profile.company].filter(Boolean).join(" · ") ||
                  profile.email ||
                  "Added"}
              </p>
            ))}
            {selectedProfiles.length > 4 ? (
              <p>+{selectedProfiles.length - 4} more people</p>
            ) : null}
          </div>
        </section>
        ) : null}

        {selectedTemplate ? (
          <section className="create-studio-context-card">
          <div className="create-studio-context-head">
            <span>
              <Grid2X2Icon className="size-3.5" aria-hidden />
              Template
            </span>
            <button
              type="button"
              onClick={() => {
                setImageModuleOpen(false);
                setDataModuleOpen(false);
                setClientModuleOpen(false);
                setReviewModuleOpen(false);
                setDesignDnaModuleOpen(false);
                setActivePanel(null);
                setTemplateModuleOpen(true);
              }}
              disabled={busy || patternLocked}
              className="create-studio-context-edit"
              data-create-tip="Add or edit template guidance."
            >
              Edit
            </button>
          </div>
          <div className="create-studio-context-lines">
            <p>
              <strong>{selectedTemplate.name}</strong> {selectedTemplate.vaultName}
            </p>
            <p>
              <strong>Carry:</strong>{" "}
              {templateCarry.length > 0
                ? TEMPLATE_CARRY_OPTIONS.filter((option) =>
                    templateCarry.includes(option.id)
                  )
                    .map((option) => option.label)
                    .join(", ")
                : "Automatic"}
            </p>
          </div>
        </section>
        ) : null}

        {designDnaHasGuidance ? (
          <section className="create-studio-context-card">
          <div className="create-studio-context-head">
            <span>
              <DnaIcon className="size-3.5" aria-hidden />
              DNA
            </span>
            <button
              type="button"
              onClick={() => {
                setImageModuleOpen(false);
                setDataModuleOpen(false);
                setClientModuleOpen(false);
                setReviewModuleOpen(false);
                setTemplateModuleOpen(false);
                setActivePanel(null);
                setDesignDnaModuleOpen(true);
              }}
              disabled={busy || patternLocked}
              className="create-studio-context-edit"
              data-create-tip="Add or edit Design DNA guidance."
            >
              Edit
            </button>
          </div>
          <div className="create-studio-context-lines">
            <p>
              <strong>
                {selectedDesignDnaRows.map((row) => row.name).join(", ")}
              </strong>
            </p>
            <p>
              <strong>Carry:</strong>{" "}
              {designDnaCarry.length > 0
                ? DESIGN_DNA_CARRY_OPTIONS.filter((option) =>
                    designDnaCarry.includes(option.id)
                  )
                    .map((option) => option.label)
                    .join(", ")
                : "Automatic"}
            </p>
          </div>
        </section>
        ) : null}
      </div>
    );
  }

  function renderCreatePatternPicker(option: OutputOption) {
    const rows = createPatternsForOutput(option);
    const canShowForDocument = option.id !== "document" || documentFormatConfirmed;
    if (!canShowForDocument) return null;
    return (
      <div className="create-studio-pattern-picker">
        <div className="create-studio-pattern-picker-head">
          <div>
            <h4>Saved patterns</h4>
            <p>
              Reuse the locked setup, then add new prompt, images, data, people,
              and source material for this run.
            </p>
          </div>
        </div>
        {patternsLoading ? (
          <p className="create-studio-data-status">Loading saved patterns...</p>
        ) : patternsError ? (
          <p className="create-studio-data-error">{patternsError}</p>
        ) : rows.length === 0 ? (
          <p className="create-studio-data-status">
            No saved {option.label.toLowerCase()} patterns yet.
          </p>
        ) : (
          <div className="create-studio-pattern-list">
            {rows.map((pattern) => {
              const active = selectedPatternId === pattern.id;
              const dnaNames =
                pattern.createBrief.designDna?.systems
                  ?.map((system) => system.name)
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(", ") || "No DNA";
              const templateName = pattern.createBrief.template?.name || "No template";
              const reusableCount =
                (pattern.createBrief.assets?.themeImages?.length ?? 0) +
                (pattern.createBrief.assets?.includeImages?.length ?? 0) +
                (pattern.createBrief.assets?.useImages?.length ?? 0) +
                (pattern.createBrief.user.brief ? 1 : 0) +
                (pattern.createBrief.user.reviewedBrief ? 1 : 0) +
                (pattern.createBrief.user.sourceMaterial ? 1 : 0) +
                (pattern.createBrief.user.exactCopy ? 1 : 0) +
                (pattern.createBrief.user.dataNotes ? 1 : 0);
              return (
                <div
                  key={pattern.id}
                  className={`create-studio-pattern-row ${active ? "is-selected" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => applyCreatePattern(pattern)}
                    disabled={busy || (patternLocked && !active)}
                    className="create-studio-pattern-pick"
                    data-create-tip="Apply this saved Create pattern and lock its reusable choices."
                  >
                    <strong>{pattern.name}</strong>
                    <small>
                      {pattern.subtypeLabel} · {templateName} · {dnaNames}
                      {reusableCount > 0 ? ` · ${reusableCount} reusable extra${reusableCount === 1 ? "" : "s"}` : ""}
                    </small>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletePatternId(pattern.id)}
                    disabled={busy || deletePatternBusy}
                    className="create-studio-pattern-delete"
                    aria-label={`Delete ${pattern.name}`}
                    data-create-tip="Delete this saved pattern."
                  >
                    <Trash2Icon className="size-3.5" aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderImageBucket(
    kind: ImageKind,
    title: string,
    hint: string,
    assets: CreateImageAsset[],
    inputRef: RefObject<HTMLInputElement | null>
  ) {
    const uploading = imageUploadingFor === kind;
    const tagOptions = imageTagOptions(kind);
    const addTip =
      kind === "theme"
        ? "Add an image that shows the look or mood you want, or paste a copied screenshot here."
        : kind === "use"
          ? "Add an image Hermes can adapt, remix, clean up, or composite, or paste one here."
          : "Add an image that should appear in the final output, or paste one here.";
    const emptyTip =
      kind === "theme"
        ? "Drop in or paste a style reference so Hermes can match the feel."
        : kind === "use"
          ? "Drop in or paste an editable source image Hermes can transform to fit the result."
          : "Drop in or paste photos, logos, or images Hermes should place in the result.";
    const emptyLabel =
      kind === "theme"
        ? "Add style reference"
        : kind === "use"
          ? "Add editable image"
          : "Add content image";
    const captionPlaceholder =
      kind === "theme"
        ? "What style should this guide?"
        : kind === "use"
          ? "What can Hermes adapt from this?"
          : "Caption / where to place it";
    const captionTip =
      kind === "theme"
        ? "Add a short note about the style this image should guide."
        : kind === "use"
          ? "Tell Hermes what can change and what should stay recognizable."
          : "Tell Hermes what this image is and where it should go.";
    return (
      <section
        className="create-studio-image-bucket"
        tabIndex={busy ? -1 : 0}
        onPaste={(e) => void onImagePaste(kind, e)}
      >
        <div className="create-studio-image-bucket-head">
          <div>
            <h3>{title}</h3>
            <p>{hint}</p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || uploading}
            className="neu-raised create-studio-image-add"
            data-create-tip={addTip}
          >
            <PlusIcon className="size-3.5" aria-hidden />
            {uploading ? "Adding" : "Add"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void onImageFilesChange(kind, e)}
          />
        </div>

        <div className="create-studio-image-list">
          {assets.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy || uploading}
              className="create-studio-image-empty"
              data-create-tip={emptyTip}
            >
              <ImageIcon className="size-4" aria-hidden />
              <span>{emptyLabel}</span>
            </button>
          ) : (
            assets.map((asset) => (
              <div key={asset.id} className="create-studio-image-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.previewUrl} alt="" />
                <div className="create-studio-image-meta">
                  <input
                    type="text"
                    value={asset.caption}
                    onChange={(e) =>
                      updateImageAsset(kind, asset.id, {
                        caption: e.target.value,
                      })
                    }
                    placeholder={captionPlaceholder}
                    disabled={busy}
                    data-create-tip={captionTip}
                  />
                  <div className="create-studio-placement-row">
                    {tagOptions.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleImageTag(kind, asset.id, tag.id)}
                        disabled={busy}
                        data-create-tip={
                          kind === "theme"
                            ? `Use this image to guide ${tag.label.toLowerCase()}.`
                            : kind === "use"
                              ? `Let Hermes ${tag.label.toLowerCase()} this image.`
                              : `Tell Hermes this image is best for ${tag.label.toLowerCase()}.`
                        }
                        className={
                          asset.tags.includes(tag.id) ? "is-active" : ""
                        }
                      >
                        {tag.label}
                      </button>
                    ))}
                  </div>
                  {kind === "theme" && asset.analysis ? (
                    <p className="create-studio-style-read">
                      {compactThemeAnalysisSummary(asset) || "Style reference read."}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeImageAsset(kind, asset.id)}
                  disabled={busy}
                  className="neu-raised create-studio-image-remove"
                  aria-label={`Remove ${asset.name}`}
                  data-create-tip="Remove this image from the request."
                >
                  <Trash2Icon className="size-3.5" aria-hidden />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderDataModule() {
    const currentVault = dataVaultSlug
      ? vaultRows.find((row) => row.slug === dataVaultSlug) ?? null
      : null;
    const privateVaults = vaultRows.filter((vault) => dataVaultKind(vault) === "private");
    const sharedVaults = vaultRows.filter((vault) => dataVaultKind(vault) === "shared");
    const visibleVaultRows = dataVaultTab === "shared" ? sharedVaults : privateVaults;
    const sourceFiles = rawFiles.filter((file) => !isFinishedDocRole(file.role));
    const finishedDocs = rawFiles.filter((file) => isFinishedDocRole(file.role));
    const renderRawFileRows = (files: RawCreateFile[], roles: RawFileRole[]) =>
      files.map((file) => (
        <div key={file.id} className="create-studio-raw-file">
          <div className="create-studio-raw-file-main">
            <strong>{file.name}</strong>
            <small>
              {file.mimeType} · {formatCompactBytes(file.size)}
            </small>
            <div className="create-studio-raw-role-row">
              {roles.map((roleId) => {
                const role = RAW_FILE_ROLES.find((option) => option.id === roleId);
                return (
                  <button
                    key={roleId}
                  type="button"
                  disabled={busy}
                  onClick={() => updateRawFileRole(file.id, roleId)}
                  className={file.role === roleId ? "is-active" : ""}
                  data-create-tip={role?.hint}
                  >
                    {role?.label ?? roleId}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => removeRawFile(file.id)}
            className="neu-raised create-studio-image-remove"
            aria-label={`Remove ${file.name}`}
            data-create-tip="Remove this file from the request."
          >
            <Trash2Icon className="size-3.5" aria-hidden />
          </button>
        </div>
      ));
    return (
      <div className="create-studio-data-module">
        <div className="create-studio-submodule-head">
          <button
            type="button"
            onClick={() => setDataModuleOpen(false)}
            disabled={busy}
            className="neu-raised create-studio-submodule-close"
            aria-label="Back from data and files"
            data-create-tip="Go back and keep your data choices."
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
          </button>
          <div>
            <h2>Data & files</h2>
            <p>Vault data uses ingested knowledge. Computer files stay raw.</p>
          </div>
        </div>

        <div className="create-studio-data-body">
          <section className="create-studio-data-side create-studio-data-vault-side">
            <div className="create-studio-data-side-head">
              <h3>Vault knowledge</h3>
              <p>Pick a private or shared vault. Click the selected item again to clear it.</p>
            </div>
            <div className="create-studio-vault-tabs" role="tablist" aria-label="Vault type">
              {(["private", "shared"] as DataVaultTab[]).map((tab) => {
                const active = dataVaultTab === tab;
                const count = tab === "private" ? privateVaults.length : sharedVaults.length;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={busy}
                    onClick={() => {
                      setDataVaultTab(tab);
                      if (currentVault && dataVaultKind(currentVault) !== tab) {
                        setDataVaultSlug("");
                        setDataVaultFiles([]);
                        setDataVaultFilesError(null);
                        setDataVaultWhole(true);
                        setSelectedVaultFilePaths([]);
                      }
                    }}
                    className={active ? "is-active" : ""}
                    data-create-tip={
                      tab === "private"
                        ? "Vaults for one project or workspace."
                        : "Shared vaults available across the organization."
                    }
                  >
                    {tab === "private" ? "Private" : "Shared"}
                    <span>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="create-studio-vault-picker">
              {vaultsLoading ? (
                <p>Loading vaults...</p>
              ) : vaultsError ? (
                <p className="is-error">{vaultsError}</p>
              ) : visibleVaultRows.length === 0 ? (
                <p>No {dataVaultTab} vaults found.</p>
              ) : (
                visibleVaultRows.map((vault) => {
                  const active = dataVaultSlug === vault.slug;
                  return (
                    <button
                      key={vault.slug}
                      type="button"
                      disabled={busy}
                      onClick={() => selectDataVault(vault)}
                      className={`neu-raised create-studio-vault-choice ${active ? "is-active" : ""}`}
                      data-create-tip={
                        active
                          ? "Click again to stop using this vault."
                          : "Use what Hermes already knows from this vault."
                      }
                    >
                      <strong>{vault.name || vault.slug}</strong>
                      <small>
                        {vault.slug} · {dataVaultKind(vault)}
                      </small>
                    </button>
                  );
                })
              )}
            </div>

            {currentVault ? (
              <div className="create-studio-vault-files">
                <div className="create-studio-scope-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (dataVaultWhole) {
                        setDataVaultWhole(false);
                        return;
                      }
                      setDataVaultWhole(true);
                      setSelectedVaultFilePaths([]);
                    }}
                    className={dataVaultWhole ? "is-active" : ""}
                    data-create-tip={
                      dataVaultWhole
                        ? "Click again to stop using the whole vault."
                        : "Let Hermes use everything it knows in this vault."
                    }
                  >
                    Whole vault
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDataVaultWhole(false)}
                    className={
                      !dataVaultWhole && selectedVaultFilePaths.length > 0
                        ? "is-active"
                        : ""
                    }
                    data-create-tip="Use only the files you pick below."
                  >
                    Pick files
                  </button>
                </div>
                {dataVaultFilesLoading ? (
                  <p className="create-studio-data-status">Loading files...</p>
                ) : dataVaultFilesError ? (
                  <p className="create-studio-data-error">{dataVaultFilesError}</p>
                ) : dataVaultFiles.length === 0 ? (
                  <p className="create-studio-data-status">No source files in this vault yet.</p>
                ) : (
                  <div className="create-studio-vault-file-list">
                    {dataVaultFiles.map((file) => {
                      const active = selectedVaultFilePaths.includes(file.relativePath);
                      return (
                        <button
                          key={file.relativePath}
                          type="button"
                          disabled={busy}
                          onClick={() => toggleVaultFile(file.relativePath)}
                          className={active ? "is-active" : ""}
                          data-create-tip={
                            active
                              ? "Click again to remove this source file."
                              : "Use what Hermes learned from this file, plus nearby notes."
                          }
                        >
                          <span>{file.name}</span>
                          <small>
                            {file.assetRole || "knowledge"} · {formatCompactBytes(file.size)}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <section className="create-studio-data-side create-studio-data-raw-side">
            <div className="create-studio-data-side-head">
              <h3>Computer input</h3>
              <p>Each card is a separate kind of source for Hermes.</p>
            </div>
            <div className="create-studio-raw-card-stack">
            <div className="create-studio-data-group create-studio-raw-input-group">
              <div className="create-studio-data-group-head">
                <div>
                  <span className="create-studio-data-card-label">Raw input</span>
                  <h4>Direct notes</h4>
                  <p>Short copy, numbers, links, or requirements.</p>
                </div>
              </div>
              <textarea
                value={dataNotes}
                onChange={(e) => setDataNotes(e.target.value)}
                disabled={busy}
                rows={5}
                placeholder="Paste numbers, copy, links, requirements, or notes..."
                className="neu-inset-input create-studio-data-text"
                data-create-tip="Use this text exactly as extra notes."
              />
            </div>

            <div className="create-studio-data-group create-studio-raw-source-group">
              <div className="create-studio-data-group-head">
                <div>
                  <span className="create-studio-data-card-label">Raw source file</span>
                  <h4>Raw source files</h4>
                  <p>Files Hermes should read directly.</p>
                </div>
                <button
                  type="button"
                  onClick={() => rawFileInputRef.current?.click()}
                  disabled={busy || rawUploading}
                  className="neu-raised create-studio-raw-add"
                  data-create-tip="Add files from your computer for Hermes to read directly."
                >
                  <PlusIcon className="size-3.5" aria-hidden />
                  {rawUploading ? "Adding" : "Add file"}
                </button>
                <input
                  ref={rawFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void onRawFilesChange(e, "data")}
                />
              </div>
              <div className="create-studio-raw-file-list">
                {sourceFiles.length === 0 ? (
                  <p className="create-studio-data-status">
                    Optional files to use exactly as uploaded.
                  </p>
                ) : (
                  renderRawFileRows(sourceFiles, ["data", "style_source"])
                )}
              </div>
            </div>

            <div className="create-studio-data-group create-studio-finished-group">
              <div className="create-studio-data-group-head">
                <div>
                  <span className="create-studio-data-card-label">Finished docs</span>
                  <h4>Finished docs</h4>
                  <p>Existing PDFs, DOCX, or decks to modify.</p>
                </div>
                <button
                  type="button"
                  onClick={() => finishedDocInputRef.current?.click()}
                  disabled={busy || rawUploading}
                  className="neu-raised create-studio-raw-add"
                  data-create-tip="Add a finished document. Hermes keeps the substance and uses your Create inputs to refactor or restyle it."
                >
                  <PlusIcon className="size-3.5" aria-hidden />
                  {rawUploading ? "Adding" : "Add doc"}
                </button>
                <input
                  ref={finishedDocInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void onRawFilesChange(e, "refactor")}
                />
              </div>
              <div className="create-studio-raw-file-list">
                {finishedDocs.length === 0 ? (
                  <p className="create-studio-data-status">
                    Add an already-made document when you want a refactor or restyle.
                  </p>
                ) : (
                  renderRawFileRows(finishedDocs, ["refactor", "restyle"])
                )}
              </div>
            </div>

            {rawFileError ? (
              <p className="create-studio-data-error">{rawFileError}</p>
            ) : null}
            </div>
          </section>
        </div>

        <div className="create-studio-image-foot">
          <p>
            {currentVault && (dataVaultWhole || selectedVaultFilePaths.length > 0)
              ? "Vault"
              : "No vault"} · {sourceFiles.length} raw · {finishedDocs.length} docs
          </p>
          <button
            type="button"
            onClick={() => setDataModuleOpen(false)}
            disabled={busy}
            className="neu-raised-active create-studio-image-done"
            data-create-tip="Keep these data choices and go back."
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  function renderClientModule() {
    const pendingProfile =
      allProfiles.find((profile) => profile.id === pendingProfileUseId) ?? null;
    const editingProfile =
      allProfiles.find((profile) => profile.id === profileEditId) ?? null;
    const tabLabel = clientTab === "company" ? "Your team" : "People";
    const selectedSourceCount = new Set(
      selectedProfiles.map((profile) => profile.vaultSlug).filter(Boolean)
    ).size;
    return (
      <div className="create-studio-client-module">
        <div className="create-studio-submodule-head">
          <button
            type="button"
            onClick={() => setClientModuleOpen(false)}
            disabled={busy}
            className="neu-raised create-studio-submodule-close"
            aria-label="Back from people context"
            data-create-tip="Go back and keep your people choices."
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
          </button>
          <div>
            <h2>People context</h2>
            <p>Choose people for this output. Everything here is optional.</p>
          </div>
        </div>

        <div className="create-studio-client-tabs" role="tablist" aria-label="People context type">
          <button
            type="button"
            onClick={() => setClientTab("clients")}
            className={clientTab === "clients" ? "is-active" : ""}
            data-create-tip="People connected to this request."
          >
            People
          </button>
          <button
            type="button"
            onClick={() => setClientTab("company")}
            className={clientTab === "company" ? "is-active" : ""}
            data-create-tip="People from your own team or profile list."
          >
            Your team
          </button>
        </div>

        <div className="create-studio-client-body">
          <section className="create-studio-client-side create-studio-client-list-side">
            <div className="create-studio-data-side-head">
              <h3>{tabLabel}</h3>
              <p>
                {clientTab === "clients"
                  ? "People from this vault, imports, or manual profiles."
                  : "People from your own profile list."}
              </p>
            </div>

            <div className="neu-inset-input create-studio-search">
              <SearchIcon className="size-4" aria-hidden />
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder={`Search ${clientTab === "company" ? "your team" : "people"}`}
                disabled={busy}
                data-create-tip="Search the people shown in this tab."
              />
            </div>

            <div className="create-studio-client-actions">
              <button
                type="button"
                onClick={() => setClientDraftOpen((current) => !current)}
                disabled={busy}
                className="neu-raised create-studio-raw-add"
                data-create-tip="Add a person profile manually."
              >
                <PlusIcon className="size-3.5" aria-hidden />
                Add profile
              </button>
            </div>

            <div className="create-studio-client-profile-list">
              {filteredPeopleProfiles.map((profile) => {
                const active = selectedProfileIds.includes(profile.id);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    disabled={busy}
                    onClick={() => requestProfileSelection(profile)}
                    className={`create-studio-profile-row ${
                      active ? "is-selected" : ""
                    } ${focusedProfileId === profile.id ? "is-focused" : ""}`}
                    data-create-tip={
                      active
                        ? "Show this person's profile and current role in the request."
                        : "Choose how Hermes should use this person."
                    }
                  >
                    <strong>{profile.name}</strong>
                    <small>
                      {[
                        profile.company,
                        profile.role ||
                          (profile.source === "brain"
                            ? profile.vaultName || "Brain profile"
                            : "Manual profile"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </button>
                );
              })}

              {profilesLoading ? (
                <p className="create-studio-data-status">Loading people profiles...</p>
              ) : profilesError ? (
                <p className="create-studio-data-error">{profilesError}</p>
              ) : clientTab === "clients" && filteredPeopleProfiles.length === 0 ? (
                <p className="create-studio-data-status">
                  No people found yet. Your own saved people appear under Your
                  team.
                </p>
              ) : null}

              {clientTab === "company" && filteredPeopleProfiles.length === 0 ? (
                <p className="create-studio-data-status">
                  Add team profiles here, or ingest details about the people you
                  work with.
                </p>
              ) : null}
            </div>
          </section>

          <section className="create-studio-client-side create-studio-client-profile-side">
            <div className="create-studio-data-side-head">
              <h3>Profile / selection</h3>
              <p>Selected people become recipients, mentions, or background context.</p>
            </div>

            <div className="create-studio-selected-people">
              {selectedProfiles.map((profile) => {
                const useMode = profileUseOption(profileUseById[profile.id]);
                const expanded = expandedProfileId === profile.id;
                const workLine = profileWorkLine(profile);
                return (
                  <article
                    key={profile.id}
                    className={`create-studio-selected-person ${expanded ? "is-open" : ""}`}
                  >
                    <div className="create-studio-selected-person-summary">
                      <div className="create-studio-selected-person-copy">
                        <strong>{profile.name}</strong>
                        <small>{workLine || "Saved profile"}</small>
                      </div>
                      <div className="create-studio-profile-tags">
                        <span>{useMode.label}</span>
                      </div>
                    </div>
                    <div className="create-studio-selected-person-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedProfileId((current) =>
                            current === profile.id ? null : profile.id
                          )
                        }
                        disabled={busy}
                        className="neu-raised create-studio-selected-person-view"
                        data-create-tip="Show profile details, sources, and edit controls."
                      >
                        {expanded ? "Hide" : "View / edit"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeProfileFromRequest(profile)}
                        disabled={busy}
                        className="neu-raised create-studio-selected-person-remove"
                        aria-label={`Remove ${profile.name} from this request`}
                        data-create-tip="Take this person out of this request."
                      >
                        <XIcon className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    {expanded ? (
                      <div className="create-studio-selected-person-detail">
                        <p>{profileShortSnippet(profile)}</p>
                        <div className="create-studio-profile-source-chips">
                          <span>
                            {profile.kind === "company" ? "Your team" : "Person"}
                          </span>
                          {profile.email ? <span>{profile.email}</span> : null}
                          {profile.phone ? <span>{profile.phone}</span> : null}
                          {profileSourceChips(profile).map((source) => (
                            <span key={source}>{source}</span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => openProfileEditor(profile)}
                          disabled={busy}
                          className="neu-raised create-studio-profile-edit-button"
                          data-create-tip="Open the full readable profile and edit details for this request."
                        >
                          Edit profile
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {selectedProfiles.length === 0 ? (
                <p className="create-studio-data-status">
                  Select a person or add a profile.
                </p>
              ) : null}
            </div>

            {clientDraftOpen ? (
              <div className="create-studio-profile-draft">
                <div className="create-studio-data-group-head">
                  <div>
                    <h4>Add {clientTab === "company" ? "team" : "person"} profile</h4>
                    <p>This profile only applies to this Create flow for now.</p>
                  </div>
                </div>
                <input
                  type="text"
                  value={clientDraftName}
                  onChange={(e) => setClientDraftName(e.target.value)}
                  placeholder="Name"
                  disabled={busy}
                  data-create-tip="Add the person's name."
                />
                <div className="create-studio-profile-draft-grid">
                  <input
                    type="text"
                    value={clientDraftCompany}
                    onChange={(e) => setClientDraftCompany(e.target.value)}
                    placeholder="Group / business"
                    disabled={busy}
                    data-create-tip="Add the group, business, team, or organization this person belongs to."
                  />
                  <input
                    type="text"
                    value={clientDraftRole}
                    onChange={(e) => setClientDraftRole(e.target.value)}
                    placeholder="Role"
                    disabled={busy}
                    data-create-tip="Add what this person does or decides."
                  />
                </div>
                <input
                  type="text"
                  value={clientDraftEmail}
                  onChange={(e) => setClientDraftEmail(e.target.value)}
                  placeholder="Email / contact"
                  disabled={busy}
                  data-create-tip="Add contact details if they matter for the output."
                />
                <textarea
                  value={clientDraftNotes}
                  onChange={(e) => setClientDraftNotes(e.target.value)}
                  placeholder="What should Hermes know about them?"
                  disabled={busy}
                  rows={3}
                  data-create-tip="Add preferences, background, or anything useful about this person."
                />
                <button
                  type="button"
                  onClick={addManualProfile}
                  disabled={busy || profileSaving}
                  className="neu-raised-active create-studio-image-done"
                  data-create-tip="Save this profile to the people list and add it to this request."
                >
                  {profileSaving ? "Saving..." : "Add to create"}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        {pendingProfile ? (
          <div
            className="create-studio-profile-use-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPendingProfileUseId(null);
            }}
          >
            <div
              className="create-studio-profile-use-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Use ${pendingProfile.name}`}
            >
              <div>
                <h3>{pendingProfile.name}</h3>
                <p>{profileWorkLine(pendingProfile) || "Choose how Hermes should use this profile."}</p>
              </div>
              <div className="create-studio-profile-use-options">
                {PROFILE_USE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => confirmProfileUse(pendingProfile, option.id)}
                    className="neu-raised"
                    data-create-tip={option.hint}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {editingProfile ? (
          <div
            className="create-studio-profile-editor-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setProfileEditId(null);
            }}
          >
            <div
              className="create-studio-profile-editor-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Edit ${editingProfile.name}`}
            >
              <div className="create-studio-profile-editor-head">
                <button
                  type="button"
                  onClick={() => setProfileEditId(null)}
                  disabled={busy}
                  className="neu-raised create-studio-submodule-close"
                  aria-label="Back from profile editor"
                  data-create-tip="Go back to people selection."
                >
                  <ArrowLeftIcon className="size-4" aria-hidden />
                </button>
                <div>
                  <h3>{editingProfile.name}</h3>
                  <p>Readable profile for this Create request.</p>
                </div>
              </div>
              <div className="create-studio-profile-editor-body">
                <div className="create-studio-profile-editor-terminal">
                  <h4>Full profile</h4>
                  <dl>
                    <div>
                      <dt>Name</dt>
                      <dd>{editingProfile.name}</dd>
                    </div>
                    <div>
                      <dt>Works with</dt>
                      <dd>{editingProfile.company || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>Role</dt>
                      <dd>{editingProfile.role || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>Sources</dt>
                      <dd>{profileSourceChips(editingProfile).join(", ") || "Manual"}</dd>
                    </div>
                    <div>
                      <dt>Notes</dt>
                      <dd>{editingProfile.notes || "No notes yet."}</dd>
                    </div>
                  </dl>
                </div>
                <div className="create-studio-profile-editor-form">
                  <input
                    type="text"
                    value={profileEditDraft.name}
                    onChange={(e) =>
                      setProfileEditDraft((current) => ({
                        ...current,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Name"
                    disabled={busy}
                  />
                  <div className="create-studio-profile-draft-grid">
                    <input
                      type="text"
                      value={profileEditDraft.company}
                      onChange={(e) =>
                        setProfileEditDraft((current) => ({
                          ...current,
                          company: e.target.value,
                        }))
                      }
                      placeholder="Group / business"
                      disabled={busy}
                    />
                    <input
                      type="text"
                      value={profileEditDraft.role}
                      onChange={(e) =>
                        setProfileEditDraft((current) => ({
                          ...current,
                          role: e.target.value,
                        }))
                      }
                      placeholder="Role"
                      disabled={busy}
                    />
                  </div>
                  <div className="create-studio-profile-draft-grid">
                    <input
                      type="text"
                      value={profileEditDraft.email}
                      onChange={(e) =>
                        setProfileEditDraft((current) => ({
                          ...current,
                          email: e.target.value,
                        }))
                      }
                      placeholder="Email / contact"
                      disabled={busy}
                    />
                    <input
                      type="text"
                      value={profileEditDraft.phone}
                      onChange={(e) =>
                        setProfileEditDraft((current) => ({
                          ...current,
                          phone: e.target.value,
                        }))
                      }
                      placeholder="Phone"
                      disabled={busy}
                    />
                  </div>
                  <textarea
                    value={profileEditDraft.notes}
                    onChange={(e) =>
                      setProfileEditDraft((current) => ({
                        ...current,
                        notes: e.target.value,
                      }))
                    }
                    placeholder="What should Hermes know about them?"
                    rows={7}
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="create-studio-profile-editor-actions">
                <button
                  type="button"
                  onClick={() => setProfileEditId(null)}
                  disabled={busy}
                  className="neu-raised"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveProfileEdit}
                  disabled={busy}
                  className="neu-raised-active"
                >
                  Save profile
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="create-studio-image-foot">
          <p>
            {selectedProfiles.length} people · {selectedSourceCount} source{selectedSourceCount === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={() => setClientModuleOpen(false)}
            disabled={busy}
            className="neu-raised-active create-studio-image-done"
            data-create-tip="Keep these people choices and go back."
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  function renderTemplateModule(referenceTab: TemplateReferenceTab) {
    const isTemplateMode = referenceTab === "templates";
    const carryLabels = TEMPLATE_CARRY_OPTIONS.filter((option) =>
      templateCarry.includes(option.id)
    );
    const designCarryLabels = DESIGN_DNA_CARRY_OPTIONS.filter((option) =>
      designDnaCarry.includes(option.id)
    );
    const selectedStrength =
      DESIGN_DNA_STRENGTH_OPTIONS.find((option) => option.id === designDnaStrength) ??
      DESIGN_DNA_STRENGTH_OPTIONS[1]!;
    return (
      <div className="create-studio-template-module">
        <div className="create-studio-submodule-head">
          <button
            type="button"
            onClick={() =>
              isTemplateMode
                ? setTemplateModuleOpen(false)
                : setDesignDnaModuleOpen(false)
            }
            disabled={busy}
            className="neu-raised create-studio-submodule-close"
            aria-label={isTemplateMode ? "Back from templates" : "Back from DNA"}
            data-create-tip={`Go back and keep your ${isTemplateMode ? "template" : "DNA"} choices.`}
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
          </button>
          <div>
            <h2>{isTemplateMode ? "Templates" : "DNA"}</h2>
            <p>
              {isTemplateMode
                ? "Choose an ingested template for structure, sections, tone, or document patterns."
                : "Choose design DNA. Hermes translates only the useful parts for the output type."}
            </p>
          </div>
        </div>

        <div className="create-studio-template-body">
          <section className="create-studio-template-side create-studio-template-list-side">
            <div className="create-studio-data-side-head">
              <h3>{isTemplateMode ? "Ingested templates" : "Design DNA"}</h3>
              <p>
                {isTemplateMode
                  ? "Templates come from files uploaded with the template role."
                  : "DNA comes from Open Design DESIGN.md references and adapts to the selected output."}
              </p>
            </div>
            <div className="neu-inset-input create-studio-search">
              <SearchIcon className="size-4" aria-hidden />
              <input
                type="text"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder={
                  isTemplateMode
                    ? "Search templates"
                    : "Search Stripe, Linear, Vercel..."
                }
                disabled={busy}
                data-create-tip={
                  isTemplateMode
                    ? "Search templates saved from uploaded examples."
                    : "Search website and product design DNA references."
                }
              />
            </div>

            <div className="create-studio-template-list">
              {isTemplateMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTemplateId("");
                      setTemplateCarry([]);
                    }}
                    disabled={busy || patternLocked}
                    className={`create-studio-template-row ${
                      !selectedTemplateId ? "is-muted" : ""
                    }`}
                    data-create-tip="Do not use a template for this Create output."
                  >
                    <strong>No template</strong>
                    <small>Optional</small>
                  </button>
                  {templatesLoading ? (
                    <p className="create-studio-data-status">Loading templates...</p>
                  ) : templatesError ? (
                    <p className="create-studio-data-error">{templatesError}</p>
                  ) : filteredTemplateRows.length === 0 ? (
                    <p className="create-studio-data-status">
                      No ingested templates found yet.
                    </p>
                  ) : (
                    filteredTemplateRows.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        disabled={busy || patternLocked}
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={`create-studio-template-row ${
                          selectedTemplateId === template.id ? "is-selected" : ""
                        }`}
                        data-create-tip="Use this template as layout, structure, tone, or style guidance."
                      >
                        <strong>{template.name}</strong>
                        <small>{template.vaultName} · {template.sourceStem}</small>
                      </button>
                    ))
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDesignDnaIds([]);
                    }}
                    disabled={busy || patternLocked}
                    className={`create-studio-template-row ${
                      !designDnaHasGuidance ? "is-muted" : ""
                    }`}
                    data-create-tip="Do not use website DNA for this Create output."
                  >
                    <strong>No Design DNA</strong>
                    <small>Optional</small>
                  </button>
                  {designDnaLoading ? (
                    <p className="create-studio-data-status">Loading Design DNA...</p>
                  ) : designDnaError ? (
                    <p className="create-studio-data-error">{designDnaError}</p>
                  ) : filteredDesignDnaRows.length === 0 ? (
                    <p className="create-studio-data-status">
                      No website DNA references found.
                    </p>
                  ) : (
                    filteredDesignDnaRows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        disabled={busy || patternLocked}
                        onClick={() => toggleDesignDna(row.id)}
                        className={`create-studio-template-row ${
                          selectedDesignDnaIds.includes(row.id) ? "is-selected" : ""
                        }`}
                        data-create-tip="Borrow design system DNA without copying logos, text, or exact assets."
                      >
                        <strong>{row.name}</strong>
                        <small>
                          {row.category || "Website DNA"} · {row.slug}
                        </small>
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
          </section>

          <section className="create-studio-template-side create-studio-template-carry-side">
            <div className="create-studio-data-side-head">
              <h3>{isTemplateMode ? "Carry over" : "Borrow from DNA"}</h3>
              <p>
                {isTemplateMode
                  ? "Optional. Pick more than one, or leave blank for automatic use."
                  : mediumDnaGuidance(
                      selectedOutput,
                      selectedOutput.id === "document" ? selectedDocumentFormat.id : undefined
                    )}
              </p>
            </div>

            <div className="create-studio-template-card">
              {isTemplateMode ? (
                selectedTemplate ? (
                  <>
                    <div>
                      <h4>{selectedTemplate.name}</h4>
                      <p>{selectedTemplate.vaultName}</p>
                    </div>
                    <div className="create-studio-profile-tags">
                      <span>outline.md</span>
                      <span>structure.yaml</span>
                    </div>
                    <p className="create-studio-template-note">
                      Hermes will use this as layout, voice, and structure guidance,
                      not as factual content for the new output.
                    </p>
                  </>
                ) : (
                  <p className="create-studio-data-status">
                    Select a template to choose what should carry over.
                  </p>
                )
              ) : selectedDesignDnaRows.length > 0 ? (
                <>
                  {selectedDesignDnaRows.map((row, index) => (
                    <div key={row.id}>
                      <h4>
                        {index === 0 ? "Primary: " : "Secondary: "}
                        {row.name}
                      </h4>
                      <p>{row.category || row.description || row.slug}</p>
                    </div>
                  ))}
                  <div className="create-studio-profile-tags">
                    <span>{selectedStrength.label}</span>
                    <span>{selectedDesignDnaRows.length} selected</span>
                  </div>
                  <p className="create-studio-template-note">
                    Hermes will translate the chosen website DNA into fresh layout,
                    spacing, typography, and components. Logos, brand names, copy,
                    and exact assets stay out.
                  </p>
                </>
              ) : (
                <p className="create-studio-data-status">
                  Select up to three design references. The first one becomes primary.
                </p>
              )}
            </div>

            {isTemplateMode ? (
              <div className="create-studio-template-options">
                {TEMPLATE_CARRY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busy || patternLocked || !selectedTemplate}
                    onClick={() => toggleTemplateCarry(option.id)}
                    className={templateCarry.includes(option.id) ? "is-active" : ""}
                    data-create-tip={option.hint}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="create-studio-template-options">
                  {DESIGN_DNA_STRENGTH_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={busy || patternLocked || !designDnaHasGuidance}
                      onClick={() => setDesignDnaStrength(option.id)}
                      className={designDnaStrength === option.id ? "is-active" : ""}
                      data-create-tip={option.hint}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </button>
                  ))}
                </div>
                <div className="create-studio-template-options">
                  {DESIGN_DNA_CARRY_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={busy || patternLocked || !designDnaHasGuidance}
                      onClick={() => toggleDesignDnaCarry(option.id)}
                      className={designDnaCarry.includes(option.id) ? "is-active" : ""}
                      data-create-tip={option.hint}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="create-studio-template-selected">
              {isTemplateMode ? (
                selectedTemplate ? (
                  carryLabels.length > 0 ? (
                    <p>
                      Carrying over: {carryLabels.map((option) => option.label).join(", ")}
                    </p>
                  ) : (
                    <p>Nothing specific selected. Hermes will use the template automatically.</p>
                  )
                ) : (
                  <p>No template selected.</p>
                )
              ) : selectedDesignDnaRows.length > 0 ? (
                designCarryLabels.length > 0 ? (
                  <p>
                    This is not a clone: Hermes borrows {designCarryLabels.length > 0
                      ? designCarryLabels.map((option) => option.label.toLowerCase()).join(", ")
                      : "the useful parts automatically"} from {selectedDesignDnaRows.map((row) => row.name).join(", ")}.
                  </p>
                ) : (
                  <p>Hermes will use the selected DNA automatically.</p>
                )
              ) : (
                <p>No Design DNA selected.</p>
              )}
            </div>
          </section>
        </div>

        <div className="create-studio-image-foot">
          <p>
            {selectedTemplate ? selectedTemplate.name : "No template"} ·{" "}
            {selectedDesignDnaRows.length > 0
              ? selectedDesignDnaRows.map((row) => row.name).join(", ")
              : "No DNA"}
          </p>
          <button
            type="button"
            onClick={() =>
              isTemplateMode
                ? setTemplateModuleOpen(false)
                : setDesignDnaModuleOpen(false)
            }
            disabled={busy}
            className="neu-raised-active create-studio-image-done"
            data-create-tip={`Keep this ${isTemplateMode ? "template" : "DNA"} choice and go back.`}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  function renderReviewModule() {
    const selectedTuneTags = CREATE_TUNE_TAGS.filter((tag) =>
      selectedTuneIds.includes(tag.id)
    );
    const tuneCategories: CreateTuneCategory[] = [
      "Finish",
      "Style",
      "Content",
      "Layout",
    ];
    const reviewOutputName =
      selectedOutput.id === "document"
        ? `${outputDisplayName(selectedOutput)} · ${selectedDocumentFormat.label}`
        : outputDisplayName(selectedOutput);
    return (
      <div className="create-studio-review-module">
        <div className="create-studio-submodule-head">
          <button
            type="button"
            onClick={() => setReviewModuleOpen(false)}
            disabled={busy}
            className="neu-raised create-studio-submodule-close"
            aria-label="Back from review"
            data-create-tip="Go back and keep editing before Hermes starts."
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
          </button>
          <div className="create-studio-review-title-wrap">
            <div className="create-studio-review-title-line">
              <h2>Review brief</h2>
              <span>{reviewOutputName}</span>
            </div>
            <p>Read it through, edit anything, then create.</p>
          </div>
        </div>

        <div className="create-studio-tune-bar">
          <button
            type="button"
            onClick={() => setReviewTuneOpen(true)}
            disabled={busy}
            className="neu-raised create-studio-tune-trigger"
            data-create-tip="Add style, finish, layout, or content direction to the prompt."
          >
            <SparklesIcon className="size-3.5" aria-hidden />
            <span>Tune result</span>
            {selectedTuneTags.length > 0 ? (
              <strong>{selectedTuneTags.length}</strong>
            ) : null}
          </button>
          {selectedTuneTags.length > 0 ? (
            <div className="create-studio-tune-selected">
              {selectedTuneTags.slice(0, 4).map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTuneTag(tag.id)}
                  disabled={busy}
                  data-create-tip={`Remove ${tag.label}.`}
                >
                  {tag.label}
                  <XIcon className="size-3" aria-hidden />
                </button>
              ))}
              {selectedTuneTags.length > 4 ? (
                <span>+{selectedTuneTags.length - 4}</span>
              ) : null}
            </div>
          ) : (
            <p>Optional quick direction, added as readable prompt detail.</p>
          )}
          {selectedTuneTags.length > 0 ? (
            <button
              type="button"
              onClick={clearTuneTags}
              disabled={busy || patternLocked}
              className="create-studio-tune-reset"
              data-create-tip="Remove all prompt tuning tags."
            >
              Reset
            </button>
          ) : null}
        </div>

        {reviewTuneOpen ? (
          <div
            className="create-studio-tune-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Tune result"
            onClick={(e) => {
              if (e.target === e.currentTarget) setReviewTuneOpen(false);
            }}
          >
            <section className="create-studio-tune-panel">
              <div className="create-studio-tune-head">
                <button
                  type="button"
                  onClick={() => setReviewTuneOpen(false)}
                  className="neu-raised create-studio-tune-close"
                  aria-label="Back from tune result"
                >
                  <ArrowLeftIcon className="size-4" aria-hidden />
                </button>
                <div>
                  <h3>Tune result</h3>
                  <p>Pick a direction. Each tag adds a richer instruction to the prompt.</p>
                </div>
              </div>

              <div className="create-studio-tune-body">
                {tuneCategories.map((category) => (
                  <section key={category} className="create-studio-tune-group">
                    <h4>{category}</h4>
                    <div className="create-studio-tune-grid">
                      {CREATE_TUNE_TAGS.filter((tag) => tag.category === category).map(
                        (tag) => {
                          const selected = selectedTuneIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleTuneTag(tag.id)}
                              disabled={busy || patternLocked}
                              className={selected ? "is-active" : ""}
                            >
                              <strong>{tag.label}</strong>
                              <small>{tag.profile}</small>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </section>
                ))}
              </div>

              <div className="create-studio-tune-foot">
                <button
                  type="button"
                  onClick={clearTuneTags}
                  disabled={busy || patternLocked || selectedTuneIds.length === 0}
                  className="neu-raised create-studio-review-edit"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setReviewTuneOpen(false)}
                  className="neu-raised-active create-studio-image-done"
                >
                  Done
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {creationModePickerOpen ? (
          <div
            className="create-studio-mode-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="Choose creation pipeline"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCreationModePickerOpen(false);
            }}
          >
            <section className="create-studio-mode-dialog">
              <div className="create-studio-mode-copy">
                <h3>Choose creation pipeline</h3>
                <p>Run this brief fast, or give Hermes a deeper specialist-guided pass.</p>
              </div>
              <div className="create-studio-mode-panel" aria-label="Creation mode">
                <button
                  type="button"
                  onClick={() => finish("standard")}
                  disabled={busy}
                  className="neu-raised create-studio-mode-card"
                >
                  <GaugeIcon className="create-studio-mode-icon" aria-hidden />
                  <span>
                    <strong>Standard Create</strong>
                    <small>Fast Hermes + Open Design route</small>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => finish("frontier")}
                  disabled={busy}
                  className="neu-raised-active create-studio-mode-card is-studio"
                >
                  <RocketIcon className="create-studio-mode-icon" aria-hidden />
                  <span>
                    <strong>Creative Studio</strong>
                    <small>Specialists, vault grounding, QA loop</small>
                  </span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setCreationModePickerOpen(false)}
                disabled={busy}
                className="create-studio-mode-cancel"
              >
                Keep editing
              </button>
            </section>
          </div>
        ) : null}

        <div className="create-studio-review-body is-brief-only">
          <section className="create-studio-review-section create-studio-review-editor">
            <div className="create-studio-review-section-head">
              <h3>Prompt</h3>
            </div>
            <textarea
              value={reviewBriefDraft}
              onChange={(e) => setReviewBriefDraft(e.target.value)}
              disabled={busy}
              rows={10}
              className="create-studio-review-textarea"
              placeholder="Sharp prompts create sharp results. Add or change anything before Hermes starts."
            />
          </section>
        </div>

        <div className="create-studio-image-foot">
          <p>{reviewBriefDraft.trim() ? "Ready to create." : "Add a prompt before creating."}</p>
          <div className="create-studio-review-actions">
            <button
              type="button"
              onClick={() => {
                setCreationModePickerOpen(false);
                setReviewModuleOpen(false);
              }}
              disabled={busy}
              className="neu-raised create-studio-review-edit"
              data-create-tip="Go back and change the Create choices."
            >
              Edit
            </button>
            <button
              type="button"
              onClick={requestFinish}
              disabled={busy || imageUploadingFor !== null}
              className="neu-raised-active create-studio-image-done"
              data-create-tip="Start Hermes with this reviewed brief."
            >
              {busy ? "Creating..." : "Create now"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return createPortal(
    <div
      className="main-chat-depth create-studio-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-studio-title"
      onClick={(e) => e.target === e.currentTarget && requestCreateClose()}
      onPointerOver={handleTipPointerOver}
      onPointerOut={handleTipPointerOut}
      onFocusCapture={handleTipFocus}
      onBlurCapture={() => {
        clearCreateTipDelay();
        setActiveTip(null);
      }}
    >
      <div
        className={`create-studio-sheet ${
          imageModuleOpen ||
          dataModuleOpen ||
          clientModuleOpen ||
          templateModuleOpen ||
          designDnaModuleOpen ||
          reviewModuleOpen
            ? "is-submodule-mode"
            : ""
        } ${dataModuleOpen ? "is-data-mode" : ""} ${
          clientModuleOpen ? "is-client-mode" : ""
        } ${
          templateModuleOpen || designDnaModuleOpen ? "is-template-mode" : ""
        } ${
          reviewModuleOpen ? "is-review-mode" : ""
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={openSettings}
          className="neu-raised create-studio-settings"
          aria-label="Open settings"
          data-create-tip="Open settings for theme, notifications, models, voice, and tips."
        >
          <SettingsIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={requestCreateClose}
          className="neu-raised create-studio-close"
          disabled={busy}
          aria-label="Back from Create"
          data-create-tip="Go back from Create."
        >
          <ArrowLeftIcon className="size-4" />
        </button>

        <div className="create-studio-agent-orb" aria-hidden>
          <Orb
            agentState={busy ? "thinking" : "listening"}
            colors={CHAT_AGENT_ORB_COLORS}
            className="size-full"
          />
        </div>

        <header className="create-studio-heading">
          <h2 id="create-studio-title">What do you want me to create?</h2>
          <p>Start with a prompt. Everything else is optional.</p>
        </header>

        <section className="create-studio-panel">
          <div className="create-studio-output-zone">
            {!outputDetailOption && selectedOutputHasExplicitSubchoice ? (
              <div className="create-studio-output-flow is-collapsed">
                <div className="create-studio-output-breadcrumb is-summary" aria-label="Selected output path">
                  <button
                    type="button"
	                    onClick={() => {
	                      setOutputSubchoiceById((current) => {
	                        const next = { ...current };
	                        delete next[outputId];
	                        return next;
	                      });
	                      if (outputId === "document") setDocumentFormatConfirmed(false);
	                      setExtraRoutePickerOpen(false);
	                    }}
                    className="create-studio-output-crumb"
                    data-create-tip="Go back to the main output choices."
                  >
                    Choose from
                  </button>
                  <span aria-hidden>/</span>
                  <button
                    type="button"
	                    className="create-studio-output-crumb"
	                    onClick={() => {
	                      setOutputDetailId(outputId);
	                      if (outputId === "document") setDocumentFormatConfirmed(false);
	                      setExtraRoutePickerOpen(false);
	                    }}
                    data-create-tip="Change this category or pick a different subtype."
                  >
                    <SelectedOutputIcon className="size-3.5" aria-hidden />
                    {selectedOutput.label}
                  </button>
                  {selectedOutput.id === "document" ? (
                    <>
                      <span aria-hidden>/</span>
                      <button
                        type="button"
	                        className="create-studio-output-crumb"
	                        onClick={() => {
	                          setOutputDetailId(outputId);
	                          setDocumentFormatConfirmed(true);
	                          setExtraRoutePickerOpen(false);
	                        }}
                        data-create-tip="Change the document output format."
                      >
                        {selectedDocumentFormat.label}
                      </button>
                    </>
                  ) : null}
                  <span aria-hidden>/</span>
                  <button
                    type="button"
	                    className="create-studio-output-crumb is-current"
	                    onClick={() => {
	                      setOutputDetailId(outputId);
	                      if (outputId === "document") setDocumentFormatConfirmed(true);
	                      setExtraRoutePickerOpen(false);
	                    }}
                    data-create-tip="Open the choices again."
                  >
                    {selectedOutputSubchoice.label}
                  </button>
                </div>
                {selectedExtraRoutes.length > 0 ? (
                  <div className="create-studio-route-pills" aria-label="Added directions">
                    {selectedExtraRoutes.map((route) => (
                      <button
                        key={route.id}
                        type="button"
                        onClick={() =>
                          setExtraRouteIds((current) =>
                            current.filter((id) => id !== route.id)
                          )
                        }
                        disabled={busy || patternLocked}
                        className="create-studio-route-pill"
                        data-create-tip={`Remove ${route.label}.`}
                      >
                        {route.label}
                        <XIcon className="size-3" aria-hidden />
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="create-studio-route-add-row">
                  <button
                    type="button"
                    className="create-studio-route-add"
                    onClick={() => setExtraRoutePickerOpen((current) => !current)}
                    disabled={busy || patternLocked || compatibleExtraRoutes.length === 0}
                    data-create-tip="Add another direction that works with this output."
                  >
                    <PlusIcon className="size-3.5" aria-hidden />
                    Add more
                  </button>
                </div>
                {extraRoutePickerOpen ? (
                  <div className="create-studio-route-grid">
                    {compatibleExtraRoutes.map((route) => {
                      const active = extraRouteIds.includes(route.id);
                      return (
                        <button
                          key={route.id}
                          type="button"
                          className={active ? "is-active" : ""}
                          onClick={() =>
                            setExtraRouteIds((current) =>
                              active
                                ? current.filter((id) => id !== route.id)
                                : [...current, route.id]
                            )
                          }
                          disabled={busy || patternLocked}
                        >
                          <strong>{route.label}</strong>
                          <small>{route.detail}</small>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : !outputDetailOption ? (
              <>
                <div className="create-studio-output-label">Choose from</div>
                <div className="create-studio-output-list">
                  {OUTPUT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const selected =
                      outputDetailId === option.id || Boolean(outputSubchoiceById[option.id]);
                    return (
                      <button
                        key={option.id}
                        type="button"
	                        onClick={() => {
	                          setOutputId(option.id);
	                          setOutputDetailId(option.id);
	                          setDocumentFormatConfirmed(false);
	                        }}
                        disabled={busy || patternLocked}
                        className={`create-studio-output ${selected ? "is-active" : ""}`}
                        data-create-tip={`Choose ${option.label}. ${option.covers}`}
                        aria-expanded={outputDetailId === option.id}
                      >
                        <Icon className="create-studio-output-icon" aria-hidden />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              (() => {
                const Icon = outputDetailOption.icon;
                const choices = outputSubchoices(outputDetailOption);
                const selectedChoiceId = outputSubchoiceById[outputDetailOption.id];
                return (
                  <div className="create-studio-output-flow">
                    <div className="create-studio-output-breadcrumb">
                      <button
                        type="button"
                        onClick={() => {
                          setOutputSubchoiceById((current) => {
                            const next = { ...current };
                            delete next[outputDetailOption.id];
                            return next;
                          });
                          if (outputDetailOption.id === "document") {
                            setDocumentFormatConfirmed(false);
                          }
                          setOutputDetailId(null);
                          setExtraRoutePickerOpen(false);
                        }}
                        className="create-studio-output-crumb"
                        disabled={busy || patternLocked}
                      >
                        <ArrowLeftIcon className="size-3.5" aria-hidden />
                        Choose from
                      </button>
                      <span aria-hidden>/</span>
                      <button
                        type="button"
                        className="create-studio-output-crumb is-current"
                        onClick={() => {
                          if (outputDetailOption.id === "document") {
                            setDocumentFormatConfirmed(false);
                          }
                          setOutputDetailId(outputDetailOption.id);
                        }}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        {outputDetailOption.label}
                      </button>
                      {outputDetailOption.id === "document" && documentFormatConfirmed ? (
                        <>
                          <span aria-hidden>/</span>
                          <button
                            type="button"
                            className="create-studio-output-crumb is-current"
                            onClick={() => {
                              setDocumentFormatConfirmed(true);
                              setOutputDetailId(outputDetailOption.id);
                            }}
                          >
                            {selectedDocumentFormat.label}
                          </button>
                        </>
                      ) : null}
                    </div>
                    <div className="create-studio-output-detail">
                      <div className="create-studio-output-detail-head">
                        <div>
                          <h3>{outputDetailOption.label}</h3>
                          <p>{outputDetailOption.covers}</p>
                        </div>
                      </div>
                      {outputDetailOption.id === "document" && !documentFormatConfirmed ? (
                        <div className="create-studio-document-format" role="group" aria-label="Document output format">
                          {DOCUMENT_FORMAT_OPTIONS.map((format) => (
                            <button
                              key={format.id}
                              type="button"
                              onClick={() => {
                                setDocumentFormat(format.id);
                                setDocumentFormatConfirmed(true);
                              }}
                              className={
                                documentFormatConfirmed && documentFormat === format.id
                                  ? "is-active"
                                  : ""
                              }
                              disabled={busy || patternLocked}
                            >
                              {format.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {outputDetailOption.id !== "document" || documentFormatConfirmed ? (
                        <div className="create-studio-output-choice-grid">
                          {choices.map((choice) => (
                            <button
                              key={choice.id}
                              type="button"
                              onClick={() => {
                                setOutputSubchoiceById((current) => ({
                                  ...current,
                                  [outputDetailOption.id]: choice.id,
                                }));
                                setOutputDetailId(null);
                              }}
                              className={selectedChoiceId === choice.id ? "is-active" : ""}
                              disabled={busy || patternLocked}
                            >
                              <strong>{choice.label}</strong>
                              {choice.detail ? <small>{choice.detail}</small> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {renderCreatePatternPicker(outputDetailOption)}
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          <div className="create-studio-prompt-zone">
            <div className="create-studio-prompt-label">
              <span>What I want</span>
              <div className="create-studio-prompt-actions">
                {hasCreateDraftContent ? (
                  <button
                    type="button"
                    onClick={clearCreateDraft}
                    disabled={busy}
                    className="create-studio-clear-draft"
                    data-create-tip="Clear this saved Create draft and start fresh."
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            {selectedPattern ? (
              <div className="create-studio-pattern-lock">
                <div>
                  <strong>{selectedPattern.name}</strong>
                  <span>
                    Pattern locks {selectedPattern.outputLabel}, {selectedPattern.subtypeLabel},
                    template/DNA choices, route extras, and tune tags. Add fresh prompt,
                    images, files, vault data, and people for this run.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearCreatePatternLock}
                  disabled={busy}
                  data-create-tip="Unlock the saved pattern and edit the locked Create choices."
                >
                  Unlock
                </button>
              </div>
            ) : null}
            <div className="create-studio-prompt-compose">
              <div className="create-studio-prompt-row">
                {renderVoiceButton("prompt", "Dictate what you want")}
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={busy}
                  rows={3}
                  placeholder="Sharp prompts create sharp results. Say what you want made and what matters most."
                  className="create-studio-prompt"
                  data-create-tip="Start with what you want made. The other choices are optional."
                />
              </div>
            </div>
            {isMotionOutput ? (
              <div className="create-studio-motion-note">
                <strong>Motion likes a tighter brief.</strong>
                <ul>
                  {MOTION_CREATE_BRIEF_RULES.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="create-studio-prompt-buckets">
              <div className="create-studio-prompt-bucket">
                <div className="create-studio-prompt-bucket-head">
                  <label htmlFor="create-source-material">
                    {isMotionOutput ? "Story / caption material" : "Material to use"}{" "}
                    <em>(optional)</em>
                  </label>
                </div>
                <div className="create-studio-prompt-bucket-field">
                  {renderVoiceButton("sourceMaterial", "Dictate material to use")}
                  <textarea
                    id="create-source-material"
                    value={sourceMaterial}
                    onChange={(e) => setSourceMaterial(e.target.value)}
                    disabled={busy}
                    rows={2}
                    placeholder={
                      isMotionOutput
                        ? "Paste the must-use message, beat notes, captions, or tiny script. Short beats beat big dumps."
                        : "Paste the draft, PDF text, notes, or source copy. Good source makes good output."
                    }
                    data-create-tip={
                      isMotionOutput
                        ? "For motion, paste story/caption material Hermes should reduce into a few beats."
                        : "Paste material Hermes should transform, polish, summarize, or turn into the selected output."
                    }
                  />
                </div>
              </div>
              <div className="create-studio-prompt-bucket">
                <div className="create-studio-prompt-bucket-head">
                  <label htmlFor="create-exact-copy">
                    {isMotionOutput ? "Exact on-screen words" : "Exact wording to keep"}{" "}
                    <em>(optional)</em>
                  </label>
                </div>
                <div className="create-studio-prompt-bucket-field">
                  {renderVoiceButton("exactCopy", "Dictate exact wording to keep")}
                  <textarea
                    id="create-exact-copy"
                    value={exactCopy}
                    onChange={(e) => setExactCopy(e.target.value)}
                    disabled={busy}
                    rows={2}
                    placeholder={
                      isMotionOutput
                        ? "Paste only the title, captions, CTA, or short line that must appear exactly."
                        : "Paste names, legal lines, CTAs, or copy that must stay. Lock the words that matter."
                    }
                    data-create-tip={
                      isMotionOutput
                        ? "Use this for exact short lines that should appear on screen."
                        : "Use this for text Hermes should not casually rewrite."
                    }
                  />
                </div>
              </div>
            </div>
            {voiceErrorHint ? (
              <p className="create-studio-voice-error">{voiceErrorHint}</p>
            ) : null}

            <div className="create-studio-option-grid">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setActivePanel(null);
                  setReviewModuleOpen(false);
                  setClientModuleOpen(false);
                  setDataModuleOpen(false);
                  setTemplateModuleOpen(false);
                  setDesignDnaModuleOpen(false);
                  setImageModuleOpen(true);
                }}
                className={`create-studio-option ${
                  imageModuleOpen ||
                  themeImages.length > 0 ||
                  includeImages.length > 0 ||
                  useImages.length > 0
                    ? "is-on"
                    : ""
                }`}
                data-create-tip={
                  isMotionOutput
                    ? "For motion, add one style image or one hero asset when it truly helps."
                    : "Add images that guide the look or appear in the output."
                }
                aria-label="Theme images"
              >
                <ImageIcon className="create-studio-option-icon" aria-hidden />
                <span>
                  <strong>Images</strong>
                  <small>{imageSummary}</small>
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setActivePanel(null);
                  setReviewModuleOpen(false);
                  setImageModuleOpen(false);
                  setClientModuleOpen(false);
                  setTemplateModuleOpen(false);
                  setDesignDnaModuleOpen(false);
                  setDataModuleOpen(true);
                }}
                className={`create-studio-option ${
                  dataModuleOpen || dataVaultSlug || dataNotes.trim() || rawFiles.length > 0
                    ? "is-on"
                    : ""
                }`}
                data-create-tip={
                  isMotionOutput
                    ? "For motion, add files only for story facts, captions, audio notes, or one required asset."
                    : "Add vault knowledge, notes, files, or finished docs."
                }
                aria-label="Data and files"
              >
                <PaperclipIcon className="create-studio-option-icon" aria-hidden />
                <span>
                  <strong>Files</strong>
                  <small>{dataSummary}</small>
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setActivePanel(null);
                  setReviewModuleOpen(false);
                  setImageModuleOpen(false);
                  setDataModuleOpen(false);
                  setTemplateModuleOpen(false);
                  setDesignDnaModuleOpen(false);
                  setClientModuleOpen(true);
                }}
                className={`create-studio-option ${
                  clientModuleOpen || selectedProfiles.length > 0
                    ? "is-on"
                    : ""
                }`}
                data-create-tip={
                  isMotionOutput
                    ? "For motion, use people mainly for audience, tone, names, or context."
                    : "Tell Hermes who this is for and who should be considered."
                }
              >
                <UserRoundIcon className="create-studio-option-icon" aria-hidden />
                <span>
                  <strong>{clientLabel}</strong>
                  <small>
                    {selectedProfiles.length > 0 ? "Added" : "Optional"}
                  </small>
                </span>
              </button>
              <button
                type="button"
                disabled={busy || patternLocked}
                onClick={() => {
                  setImageModuleOpen(false);
                  setDataModuleOpen(false);
                  setClientModuleOpen(false);
                  setReviewModuleOpen(false);
                  setDesignDnaModuleOpen(false);
                  setActivePanel(null);
                  setTemplateModuleOpen(true);
                }}
                className={`create-studio-option ${
                  templateModuleOpen || selectedTemplate ? "is-on" : ""
                }`}
                data-create-tip={
                  isMotionOutput
                    ? "For motion, use a template only for structure, pacing, or copy pattern."
                    : "Use an ingested template for structure, sections, tone, or document patterns."
                }
              >
                <Grid2X2Icon className="create-studio-option-icon" aria-hidden />
                <span>
                  <strong>Template</strong>
                  <small>{templateSummary}</small>
                </span>
              </button>
              <button
                type="button"
                disabled={busy || patternLocked}
                onClick={() => {
                  setImageModuleOpen(false);
                  setDataModuleOpen(false);
                  setClientModuleOpen(false);
                  setReviewModuleOpen(false);
                  setTemplateModuleOpen(false);
                  setActivePanel(null);
                  setDesignDnaModuleOpen(true);
                }}
                className={`create-studio-option ${
                  designDnaModuleOpen || designDnaHasGuidance ? "is-on" : ""
                }`}
                data-create-tip={
                  isMotionOutput
                    ? "For motion, use DNA for frame composition, pacing, palette, type attitude, and restraint."
                    : "Use Design DNA as medium-aware layout, spacing, typography, component, and mobile guidance."
                }
              >
                <DnaIcon className="create-studio-option-icon" aria-hidden />
                <span>
                  <strong>DNA</strong>
                  <small>{dnaSummary}</small>
                </span>
              </button>
            </div>

            {renderMainContextBoard()}

            {activePanel ? (
              <div className="create-studio-detail">
                {activePanel === "template" ? (
                  <div className="create-studio-detail-row">
                    <span className="neu-recessed create-studio-thumb-empty">
                      <Grid2X2Icon className="size-5" />
                    </span>
                    <div className="create-studio-detail-copy">
                      <strong>No template selected</strong>
                      <small>Saved template reuse can plug in here next.</small>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <div className="create-studio-image-foot create-studio-main-foot">
          <p>
            <LockKeyholeIcon className="size-4" aria-hidden />
            Create it, then revise or remake it.
          </p>
          <button
            type="button"
            onClick={openReviewModule}
            disabled={busy || imageUploadingFor !== null}
            className="neu-raised-active create-studio-create"
            data-create-tip="Review the brief before Hermes starts."
          >
            {busy ? "Creating..." : "Next"}
            <ArrowRightIcon className="create-studio-create-icon" aria-hidden />
          </button>
        </div>

        {imageModuleOpen ? (
          <div className="create-studio-image-module">
            <div className="create-studio-image-module-head">
              <button
                type="button"
                onClick={() => setImageModuleOpen(false)}
                className="neu-raised create-studio-image-close"
                aria-label="Back from images"
                data-create-tip="Go back and keep your image choices."
              >
                <ArrowLeftIcon className="size-4" aria-hidden />
              </button>
              <div>
                <h2>Images</h2>
                <p>Style guides the look. Include must appear. Use can be adapted.</p>
              </div>
            </div>

            {imageError ? (
              <p className="create-studio-image-error">{imageError}</p>
            ) : null}

            <div className="create-studio-image-body">
              {renderImageBucket(
                "theme",
                "Theme / style",
                "Mood, palette, brand feel.",
                themeImages,
                themeInputRef
              )}
              {renderImageBucket(
                "include",
                "Images to include",
                "Photos or logos to place in the result.",
                includeImages,
                includeInputRef
              )}
              {renderImageBucket(
                "use",
                "Images to use",
                "Editable sources Hermes can crop, remix, recolor, or composite.",
                useImages,
                useInputRef
              )}
            </div>

            <div className="create-studio-image-foot">
              <p>
                {themeImages.length} style · {includeImages.length} include ·{" "}
                {useImages.length} adapt
              </p>
              <button
                type="button"
                onClick={() => setImageModuleOpen(false)}
                className="neu-raised-active create-studio-image-done"
                data-create-tip="Keep these image choices and go back."
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
        {dataModuleOpen ? renderDataModule() : null}
        {clientModuleOpen ? renderClientModule() : null}
        {templateModuleOpen ? renderTemplateModule("templates") : null}
        {designDnaModuleOpen ? renderTemplateModule("design") : null}
        {reviewModuleOpen ? renderReviewModule() : null}
      </div>

        {activeTip ? (
          <div
            className={`create-studio-tip-bubble is-${activeTip.placement}`}
          style={{ left: activeTip.x, top: activeTip.y }}
          role="status"
        >
          {activeTip.text}
        </div>
      ) : null}
      <AddingImageOverlay
        open={imageUploadingFor !== null}
        title={
          imageUploadingFor === "theme" ? "Reading style reference" : "Adding image"
        }
        subtitle={
          imageUploadingFor === "theme"
            ? "Extracting palette, mood, and layout cues."
            : "Please hold on."
        }
      />
      {deletePatternId ? (
        <div className="create-studio-pattern-delete-backdrop" role="dialog" aria-modal="true">
          <div className="create-studio-pattern-delete-modal">
            <h3>Delete pattern?</h3>
            <p>
              This cannot be undone. It only removes the saved Create pattern;
              it does not delete generated builds or chat history.
            </p>
            <div className="create-studio-pattern-delete-actions">
              <button
                type="button"
                onClick={() => setDeletePatternId(null)}
                disabled={deletePatternBusy}
                className="neu-raised"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteCreatePattern()}
                disabled={deletePatternBusy}
                className="neu-raised-active"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .create-studio-shell {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          min-height: 0;
          align-items: stretch;
          justify-content: stretch;
          overflow: hidden;
          overscroll-behavior: contain;
          padding: 0;
          background:
            radial-gradient(circle at 50% -10%, color-mix(in oklch, var(--sidebar-primary) 18%, transparent), transparent 28%),
            color-mix(in oklch, var(--sidebar-depth-canvas) 76%, black);
        }

        .create-studio-sheet {
          position: relative;
          width: 100%;
          height: 100dvh;
          max-height: 100dvh;
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          border: 0;
          border-radius: 0;
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 34%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 70%, black));
          box-shadow:
            inset 0 1px 0 hsl(0 0% 100% / 0.04),
            inset 0 -1px 0 hsl(0 0% 0% / 0.62),
            0 1.6rem 3.6rem hsl(0 0% 0% / 0.42),
            0 2px 8px hsl(0 0% 0% / 0.38);
          color: var(--sidebar-foreground);
        }

        .create-studio-sheet.is-data-mode,
        .create-studio-sheet.is-client-mode,
        .create-studio-sheet.is-template-mode,
        .create-studio-sheet.is-review-mode {
          width: 100%;
          max-height: 100dvh;
        }

        .create-studio-sheet.is-submodule-mode > .create-studio-close,
        .create-studio-sheet.is-submodule-mode > .create-studio-agent-orb,
        .create-studio-sheet.is-submodule-mode > .create-studio-heading,
        .create-studio-sheet.is-submodule-mode > .create-studio-panel,
        .create-studio-sheet.is-submodule-mode > .create-studio-save-note,
        .create-studio-sheet.is-submodule-mode > .create-studio-main-foot {
          display: none;
        }

        [data-create-tip] {
          position: relative;
        }

        .create-studio-tip-bubble {
          position: fixed;
          z-index: 1000;
          width: max-content;
          max-width: min(17rem, calc(100vw - 2rem));
          pointer-events: none;
          border: 1px solid color-mix(in oklch, var(--sidebar-primary) 78%, white 4%);
          border-radius: var(--radius);
          background:
            linear-gradient(180deg, color-mix(in oklch, var(--sidebar-depth-raised) 92%, black), color-mix(in oklch, var(--sidebar-depth-input) 86%, black));
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--sidebar-primary) 22%, transparent),
            0 0.75rem 1.8rem hsl(0 0% 0% / 0.38),
            var(--sidebar-neu-raised);
          color: var(--foreground);
          font-size: 0.72rem;
          font-weight: 500;
          line-height: 1.32;
          padding: 0.52rem 0.65rem;
          text-align: left;
          white-space: normal;
          animation: create-studio-tip-in 120ms ease-out;
        }

        .create-studio-tip-bubble.is-top {
          transform: translate(-50%, calc(-100% - 0.68rem));
        }

        .create-studio-tip-bubble.is-bottom {
          transform: translate(-50%, 0.68rem);
        }

        .create-studio-tip-bubble::before {
          position: absolute;
          left: 50%;
          width: 0.58rem;
          height: 0.58rem;
          border: inherit;
          background: color-mix(in oklch, var(--sidebar-depth-input) 90%, black);
          content: "";
          transform: translateX(-50%) rotate(45deg);
        }

        .create-studio-tip-bubble.is-top::before {
          bottom: -0.33rem;
          border-left: 0;
          border-top: 0;
        }

        .create-studio-tip-bubble.is-bottom::before {
          top: -0.33rem;
          border-right: 0;
          border-bottom: 0;
        }

        @keyframes create-studio-tip-in {
          from {
            opacity: 0;
            filter: blur(2px);
          }
          to {
            opacity: 1;
            filter: blur(0);
          }
        }

        .create-studio-settings,
        .create-studio-close {
          position: absolute;
          top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.45rem));
          z-index: 2;
          display: inline-flex;
          width: 2rem;
          height: 2rem;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius);
          color: var(--muted-foreground);
        }

        .create-studio-settings {
          right: 0.75rem;
        }

        .create-studio-close {
          left: 0.75rem;
        }

        .create-studio-agent-orb {
          position: relative;
          width: 4rem;
          height: 4rem;
          margin: max(0.8rem, calc(env(safe-area-inset-top, 0px) + 0.8rem)) auto 0.35rem;
        }

        .create-studio-heading {
          padding: 0 3rem 0.7rem;
          text-align: center;
        }

        .create-studio-heading h2 {
          margin: 0;
          color: var(--foreground);
          font-size: 1.0625rem;
          font-weight: 600;
          line-height: 1.2;
          letter-spacing: 0;
        }

        .create-studio-heading p {
          margin: 0.25rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.75rem;
          line-height: 1.35;
        }

        .create-studio-mode-confirm {
          position: absolute;
          inset: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          justify-content: center;
          background: hsl(0 0% 0% / 0.58);
          padding: 1rem;
        }

        .create-studio-mode-dialog {
          width: min(44rem, 100%);
          border: 1px solid color-mix(in oklch, var(--sidebar-button-border-active) 52%, var(--sidebar-border));
          border-radius: var(--radius);
          background:
            linear-gradient(180deg, color-mix(in oklch, var(--sidebar-depth-raised) 96%, black), var(--sidebar-depth-raised));
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--sidebar-primary) 18%, transparent),
            0 1.2rem 3rem hsl(0 0% 0% / 0.45);
          padding: 1rem;
        }

        .create-studio-mode-copy {
          padding: 0.15rem 0.2rem 0.75rem;
          text-align: center;
        }

        .create-studio-mode-copy h3 {
          margin: 0;
          color: var(--foreground);
          font-size: 1rem;
          font-weight: 750;
          line-height: 1.2;
        }

        .create-studio-mode-copy p {
          margin: 0.35rem auto 0;
          max-width: 32rem;
          color: var(--muted-foreground);
          font-size: 0.78rem;
          line-height: 1.35;
        }

        .create-studio-mode-panel {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 18rem));
          justify-content: center;
          gap: 0.75rem;
          padding: 0;
        }

        .create-studio-mode-card {
          display: flex;
          min-height: 6.5rem;
          min-width: 0;
          align-items: center;
          gap: 0.85rem;
          border-radius: var(--radius);
          padding: 1rem;
          text-align: left;
          transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
        }

        .create-studio-mode-card:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .create-studio-mode-card:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .create-studio-mode-icon {
          width: 1.45rem;
          height: 1.45rem;
          flex: 0 0 auto;
          color: var(--sidebar-primary);
        }

        .create-studio-mode-card span {
          display: grid;
          min-width: 0;
          gap: 0.28rem;
        }

        .create-studio-mode-card strong,
        .create-studio-mode-card small {
          min-width: 0;
          overflow-wrap: anywhere;
          letter-spacing: 0;
        }

        .create-studio-mode-card strong {
          color: var(--foreground);
          font-size: 0.95rem;
          font-weight: 750;
          line-height: 1.18;
        }

        .create-studio-mode-card small {
          color: var(--muted-foreground);
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1.28;
        }

        .create-studio-mode-card.is-studio small {
          color: color-mix(in oklch, var(--sidebar-primary) 72%, white 10%);
        }

        .create-studio-mode-cancel {
          display: block;
          margin: 0.85rem auto 0;
          border: 0;
          background: transparent;
          color: var(--muted-foreground);
          cursor: pointer;
          font: inherit;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0;
          line-height: 1.2;
          padding: 0.35rem 0.6rem;
        }

        .create-studio-mode-cancel:hover:not(:disabled) {
          color: var(--foreground);
        }

        .create-studio-mode-cancel:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .create-studio-panel {
          position: relative;
          margin-top: 0;
          overflow: hidden;
          border-top: 1px solid color-mix(in oklch, var(--sidebar-border) 50%, transparent);
        }

        .create-studio-prompt-zone {
          padding: 0.8rem clamp(0.85rem, 3vw, 2rem) 0.85rem;
        }

        .create-studio-prompt-label {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.38rem;
          padding: 0 0.1rem;
        }

        .create-studio-prompt-label span {
          color: var(--foreground);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0;
        }

        .create-studio-prompt-label small {
          color: var(--muted-foreground);
          font-size: 0.68rem;
          line-height: 1.2;
        }

        .create-studio-prompt-actions {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.55rem;
          min-width: 0;
        }

        .create-studio-clear-draft {
          border: 0;
          background: transparent;
          color: var(--muted-foreground);
          font-size: 0.68rem;
          font-weight: 700;
          line-height: 1.2;
          padding: 0.15rem 0.05rem;
        }

        .create-studio-clear-draft:hover {
          color: var(--sidebar-primary);
        }

        .create-studio-clear-draft:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }

        .create-studio-prompt-compose {
          display: block;
        }

        .create-studio-prompt-row {
          position: relative;
          display: flex;
          align-items: flex-start;
          flex: 1 1 auto;
          min-width: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-button-border) 68%, var(--sidebar-border));
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 20% 0%, hsl(0 0% 100% / 0.03), transparent 42%),
            color-mix(in oklch, var(--sidebar-depth-input) 72%, transparent);
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--sidebar-button-border) 42%, transparent),
            var(--sidebar-neu-inset);
          padding: 0.7rem;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .create-studio-prompt-row:focus-within {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 78%, var(--sidebar-border));
          background:
            radial-gradient(circle at 20% 0%, hsl(0 0% 100% / 0.035), transparent 44%),
            color-mix(in oklch, var(--sidebar-depth-input) 82%, transparent);
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--sidebar-button-border-active) 58%, transparent),
            var(--sidebar-neu-inset);
        }

        .create-studio-prompt {
          min-height: 5.4rem;
          max-height: 9.25rem;
          flex: 1;
          padding: 0 0 0 2rem;
          resize: none;
          border: 0;
          background: transparent;
          color: var(--foreground);
          font: inherit;
          font-size: 0.875rem;
          line-height: 1.45;
          outline: none;
          overflow-y: auto;
        }

        .create-studio-prompt::placeholder {
          color: color-mix(in oklch, var(--muted-foreground) 96%, transparent);
        }

        .create-studio-motion-note {
          margin-top: 0.55rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-button-border) 58%, var(--sidebar-border));
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 12% 0%, color-mix(in oklch, var(--sidebar-primary) 10%, transparent), transparent 42%),
            color-mix(in oklch, var(--sidebar-depth-input) 50%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.62rem 0.72rem;
        }

        .create-studio-motion-note strong {
          display: block;
          color: var(--foreground);
          font-size: 0.76rem;
          font-weight: 760;
          line-height: 1.2;
        }

        .create-studio-motion-note ul {
          display: grid;
          gap: 0.18rem;
          margin: 0.38rem 0 0;
          padding-left: 1.05rem;
        }

        .create-studio-motion-note li {
          color: var(--muted-foreground);
          font-size: 0.7rem;
          line-height: 1.28;
        }

        .create-studio-prompt-buckets {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.55rem;
          margin-top: 0.58rem;
        }

        .create-studio-prompt-bucket {
          display: grid;
          min-width: 0;
          gap: 0.32rem;
        }

        .create-studio-prompt-bucket-head {
          display: flex;
          min-width: 0;
          align-items: center;
          justify-content: space-between;
          gap: 0.42rem;
        }

        .create-studio-prompt-bucket label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--foreground);
          font-size: 0.7rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .create-studio-prompt-bucket em {
          color: var(--muted-foreground);
          font-style: normal;
          font-weight: 600;
        }

        .create-studio-prompt-bucket textarea {
          min-height: 4.05rem;
          width: 100%;
          resize: vertical;
          border: 1px solid color-mix(in oklch, var(--sidebar-button-border) 52%, var(--sidebar-border));
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 68%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          color: var(--foreground);
          font: inherit;
          font-size: 0.76rem;
          line-height: 1.38;
          outline: none;
          padding: 0.55rem 0.62rem 0.55rem 2.1rem;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .create-studio-prompt-bucket-field {
          position: relative;
          min-width: 0;
        }

        .create-studio-prompt-bucket textarea:focus {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 72%, var(--sidebar-border));
          background: var(--sidebar-depth-input);
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--sidebar-button-border-active) 52%, transparent),
            var(--sidebar-neu-inset);
        }

        .create-studio-prompt-bucket textarea::placeholder {
          color: var(--muted-foreground);
        }

        .create-studio-mic-button {
          position: absolute;
          top: 0.5rem;
          left: 0.5rem;
          z-index: 2;
          display: inline-flex;
          width: 1.42rem;
          height: 1.42rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 999px;
          transition: background 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
        }

        .create-studio-mic-icon {
          width: 0.72rem;
          height: 0.72rem;
          flex: 0 0 auto;
        }

        .create-studio-mic-button:disabled {
          opacity: 0.4;
        }

        .create-studio-mic-wave {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 999px;
        }

        .create-studio-voice-error {
          margin: 0.55rem 0 0;
          color: var(--destructive);
          font-size: 0.75rem;
          line-height: 1.3;
          text-align: right;
        }

        .create-studio-option-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(8.25rem, 10.75rem));
          justify-content: start;
          gap: 0.42rem;
          margin-top: 0.58rem;
        }

        .create-studio-option,
        .create-studio-mode-card,
        .create-studio-output,
        .create-studio-create,
        .create-studio-context-edit,
        .create-studio-client-tabs button,
        .create-studio-profile-row,
        .create-studio-selected-chip,
        .create-studio-template-row,
        .create-studio-template-options button,
        .create-studio-review-toggle,
        .create-studio-review-edit {
          appearance: none;
          border: 0;
          color: inherit;
          font: inherit;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .create-studio-option {
          display: flex;
          min-width: 0;
          height: 2.28rem;
          align-items: center;
          gap: 0.42rem;
          padding: 0 0.5rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 75%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 34% 0%, hsl(0 0% 100% / 0.026), transparent 42%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 72%, black));
          box-shadow: var(--sidebar-neu-raised);
          text-align: left;
          transition: transform 160ms ease, border-color 180ms ease, box-shadow 180ms ease;
        }

        .create-studio-option:hover:not(:disabled),
        .create-studio-option.is-on {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 70%, var(--sidebar-border));
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-option-icon {
          width: 0.94rem;
          height: 0.94rem;
          flex: 0 0 auto;
          color: var(--foreground);
          filter: drop-shadow(0 6px 10px hsl(0 0% 0% / 0.22));
        }

        .create-studio-option span {
          min-width: 0;
          display: block;
          flex: 1 1 auto;
        }

        .create-studio-option strong,
        .create-studio-option small {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-option strong {
          color: var(--foreground);
          font-size: 0.72rem;
          line-height: 1.18;
        }

        .create-studio-option small {
          margin-top: 0.1rem;
          color: var(--muted-foreground);
          font-size: 0.6rem;
          line-height: 1.1;
        }

        .create-studio-detail {
          margin-top: 1rem;
          padding: 0.85rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 45%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 70%, transparent);
          box-shadow: var(--sidebar-neu-inset);
        }

        .create-studio-detail-row {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 0.85rem;
        }

        .create-studio-thumb,
        .create-studio-thumb-empty {
          width: 3.25rem;
          height: 3.25rem;
          flex: 0 0 auto;
          border-radius: var(--radius);
          object-fit: cover;
        }

        .create-studio-thumb-empty {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--muted-foreground);
        }

        .create-studio-detail-copy {
          min-width: 0;
          flex: 1;
        }

        .create-studio-detail-copy strong,
        .create-studio-detail-copy small {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-detail-copy strong {
          font-size: 0.9rem;
          color: var(--foreground);
        }

        .create-studio-detail-copy small {
          margin-top: 0.2rem;
          font-size: 0.78rem;
          color: var(--muted-foreground);
        }

        .create-studio-context-board {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
          gap: 0.65rem;
          margin-top: 0.8rem;
        }

        .create-studio-context-card {
          min-width: 0;
          display: flex;
          min-height: 10rem;
          flex-direction: column;
          gap: 0.55rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 58%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 42%),
            color-mix(in oklch, var(--sidebar-depth-input) 44%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.65rem;
        }

        .create-studio-context-head {
          display: flex;
          min-width: 0;
          align-items: center;
          justify-content: space-between;
          gap: 0.45rem;
        }

        .create-studio-context-head span {
          display: inline-flex;
          min-width: 0;
          align-items: center;
          gap: 0.35rem;
          color: var(--foreground);
          font-size: 0.75rem;
          font-weight: 650;
        }

        .create-studio-context-edit {
          height: 1.65rem;
          flex: 0 0 auto;
          border-radius: calc(var(--radius) - 0.12rem);
          background: color-mix(in oklch, var(--sidebar-depth-raised) 78%, black);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--sidebar-primary);
          font-size: 0.66rem;
          font-weight: 650;
          padding: 0 0.48rem;
        }

        .create-studio-context-empty {
          margin: auto 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.35;
        }

        .create-studio-context-image-grid,
        .create-studio-context-lines {
          display: grid;
          gap: 0.45rem;
        }

        .create-studio-context-image {
          display: grid;
          grid-template-columns: 3.5rem minmax(0, 1fr);
          gap: 0.48rem;
          align-items: center;
        }

        .create-studio-context-image img {
          width: 3.5rem;
          height: 3.5rem;
          border-radius: calc(var(--radius) - 0.12rem);
          object-fit: cover;
        }

        .create-studio-context-image div,
        .create-studio-context-lines p {
          min-width: 0;
        }

        .create-studio-context-image strong,
        .create-studio-context-image small,
        .create-studio-context-lines p {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .create-studio-context-image strong {
          color: var(--foreground);
          font-size: 0.72rem;
          line-height: 1.2;
          white-space: nowrap;
        }

        .create-studio-context-image small {
          margin-top: 0.14rem;
          color: var(--muted-foreground);
          font-size: 0.64rem;
          line-height: 1.2;
          white-space: nowrap;
        }

        .create-studio-context-lines p,
        .create-studio-context-more {
          margin: 0;
          color: var(--muted-foreground);
          font-size: 0.7rem;
          line-height: 1.35;
        }

        .create-studio-context-lines strong {
          color: var(--foreground);
          font-weight: 650;
        }

        .create-studio-small-button {
          flex: 0 0 auto;
          border-radius: var(--radius);
          padding: 0.55rem 0.8rem;
          color: var(--foreground);
          font-size: 0.8rem;
          font-weight: 650;
        }

        .create-studio-client-panel {
          display: grid;
          gap: 0.75rem;
        }

        .create-studio-search {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          border-radius: var(--radius);
          padding: 0.6rem 0.75rem;
          color: var(--muted-foreground);
        }

        .create-studio-search input {
          min-width: 0;
          flex: 1;
          border: 0;
          background: transparent;
          color: var(--foreground);
          font: inherit;
          outline: none;
        }

        .create-studio-client-list {
          display: grid;
          max-height: 13rem;
          gap: 0.55rem;
          overflow-y: auto;
          padding-right: 0.1rem;
        }

        .create-studio-client-list p {
          margin: 0;
          padding: 0.75rem;
          color: var(--muted-foreground);
          text-align: center;
          font-size: 0.82rem;
        }

        .create-studio-client-list .is-error {
          color: var(--destructive);
        }

        .create-studio-client {
          display: block;
          min-width: 0;
          border-radius: var(--radius);
          padding: 0.62rem 0.75rem;
          text-align: left;
          color: var(--muted-foreground);
        }

        .create-studio-client.is-selected {
          color: var(--sidebar-primary);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-client strong,
        .create-studio-client small {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-client strong {
          color: var(--foreground);
          font-size: 0.86rem;
        }

        .create-studio-client small {
          margin-top: 0.15rem;
          font-family: var(--font-mono);
          font-size: 0.68rem;
          opacity: 0.68;
        }

        .create-studio-output-zone {
          display: flex;
          min-height: 2.55rem;
          align-items: center;
          flex-wrap: nowrap;
          gap: 0.45rem;
          border-bottom: 1px solid color-mix(in oklch, var(--sidebar-border) 58%, transparent);
          background: color-mix(in oklch, var(--sidebar-depth-input) 35%, transparent);
          padding: 0.42rem clamp(0.7rem, 2vw, 1.1rem);
        }

        .create-studio-output-label {
          flex: 0 0 auto;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0;
          line-height: 1;
          text-transform: uppercase;
        }

        .create-studio-output-list {
          display: flex;
          min-width: 0;
          flex: 1 1 auto;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.3rem;
        }

        .create-studio-output {
          display: inline-flex;
          min-height: 1.68rem;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          gap: 0.24rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 75%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 42% 0%, hsl(0 0% 100% / 0.018), transparent 44%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 76%, black));
          box-shadow: var(--sidebar-neu-raised);
          color: var(--foreground);
          font-size: 0.68rem;
          font-weight: 650;
          line-height: 1.1;
          min-width: max-content;
          padding: 0.18rem 0.5rem;
          text-align: center;
        }

        .create-studio-output span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-output.is-active {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 76%, var(--sidebar-border));
          color: var(--foreground);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-output-icon {
          width: 0.72rem;
          height: 0.72rem;
          flex: 0 0 auto;
          color: var(--muted-foreground);
        }

        .create-studio-output.is-active .create-studio-output-icon {
          color: var(--sidebar-primary);
        }

        .create-studio-output-flow {
          display: flex;
          width: 100%;
          flex-direction: column;
          gap: 0.55rem;
        }

        .create-studio-output-flow.is-collapsed {
          gap: 0;
        }

        .create-studio-output-breadcrumb {
          display: flex;
          min-height: 1.8rem;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.35rem;
          color: var(--muted-foreground);
          font-size: 0.68rem;
          font-weight: 700;
        }

        .create-studio-output-breadcrumb.is-summary {
          width: 100%;
          min-height: 2.25rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 72%, transparent);
          border-radius: var(--radius);
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          padding: 0.28rem 0.38rem;
        }

        .create-studio-output-crumb {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          border: 0;
          border-radius: var(--radius);
          background: transparent;
          color: var(--muted-foreground);
          font: inherit;
          padding: 0.18rem 0.25rem;
        }

        .create-studio-output-breadcrumb.is-summary .create-studio-output-crumb {
          min-height: 1.55rem;
          border: 1px solid transparent;
          padding: 0.2rem 0.34rem;
        }

        .create-studio-output-breadcrumb.is-summary .create-studio-output-crumb:hover {
          border-color: color-mix(in oklch, var(--sidebar-button-border) 80%, transparent);
          background: color-mix(in oklch, var(--sidebar-depth-input) 86%, transparent);
          color: var(--foreground);
        }

        .create-studio-output-crumb:hover {
          color: var(--sidebar-primary);
        }

        .create-studio-output-crumb.is-current {
          color: var(--foreground);
        }

        .create-studio-output-breadcrumb.is-summary .create-studio-output-crumb.is-current {
          background: var(--sidebar-depth-selected);
          box-shadow: var(--sidebar-neu-selected);
          color: var(--sidebar-primary-foreground);
        }

        .create-studio-route-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          margin-top: 0.45rem;
        }

        .create-studio-route-pill {
          display: inline-flex;
          min-height: 1.7rem;
          align-items: center;
          gap: 0.3rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 70%, transparent);
          border-radius: var(--radius);
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--foreground);
          padding: 0.22rem 0.42rem;
          font-size: 0.68rem;
          font-weight: 760;
        }

        .create-studio-route-add-row {
          display: flex;
          justify-content: flex-start;
          margin-top: 0.45rem;
        }

        .create-studio-route-add {
          display: inline-flex;
          min-height: 1.85rem;
          align-items: center;
          gap: 0.32rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 70%, transparent);
          border-radius: var(--radius);
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--foreground);
          padding: 0.24rem 0.48rem;
          font-size: 0.7rem;
          font-weight: 780;
        }

        .create-studio-route-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.38rem;
          margin-top: 0.45rem;
        }

        .create-studio-route-grid button {
          display: flex;
          min-height: 2.55rem;
          flex-direction: column;
          justify-content: center;
          gap: 0.16rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 65%, transparent);
          border-radius: var(--radius);
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--foreground);
          padding: 0.38rem 0.46rem;
          text-align: left;
        }

        .create-studio-route-grid strong {
          color: inherit;
          font-size: 0.68rem;
          font-weight: 780;
          line-height: 1.15;
        }

        .create-studio-route-grid small {
          color: var(--muted-foreground);
          font-size: 0.58rem;
          font-weight: 600;
          line-height: 1.15;
        }

        .create-studio-output-detail {
          width: 100%;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 78%, var(--sidebar-depth-canvas));
          border-radius: var(--radius);
          background: var(--sidebar-depth-input);
          box-shadow: var(--sidebar-neu-composer);
          padding: 0.75rem;
        }

        .create-studio-output-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
        }

        .create-studio-output-detail-head h3 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.9rem;
          font-weight: 750;
          line-height: 1.2;
        }

        .create-studio-output-detail-head p {
          margin: 0.22rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.74rem;
          line-height: 1.35;
        }

        .create-studio-output-detail-close {
          display: inline-flex;
          width: 1.75rem;
          height: 1.75rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: var(--radius);
          background: transparent;
          color: var(--muted-foreground);
        }

        .create-studio-output-detail-close:hover {
          color: var(--foreground);
        }

        .create-studio-document-format {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.42rem;
          margin-top: 0.7rem;
        }

        .create-studio-document-format button {
          min-height: 2rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 75%, transparent);
          border-radius: var(--radius);
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--foreground);
          font-size: 0.74rem;
          font-weight: 700;
        }

        .create-studio-document-format button.is-active {
          border-color: transparent;
          background: var(--sidebar-depth-selected);
          box-shadow: var(--sidebar-neu-selected);
          color: var(--sidebar-primary-foreground);
        }

        .create-studio-output-choice-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0.38rem;
          margin-top: 0.55rem;
        }

        .create-studio-output-choice-grid button {
          display: flex;
          min-height: 2.25rem;
          flex-direction: column;
          justify-content: center;
          gap: 0.14rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 65%, transparent);
          border-radius: var(--radius);
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--foreground);
          padding: 0.36rem 0.46rem;
          text-align: left;
        }

        .create-studio-output-choice-grid strong {
          color: inherit;
          font-size: 0.68rem;
          font-weight: 750;
          line-height: 1.15;
        }

        .create-studio-output-choice-grid small {
          color: var(--muted-foreground);
          font-size: 0.58rem;
          font-weight: 600;
          line-height: 1.15;
        }

        .create-studio-create {
          display: inline-flex;
          height: 2.35rem;
          min-width: 6.75rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          gap: 0.45rem;
          border: 0;
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 36% 0%, color-mix(in oklch, var(--sidebar-primary) 24%, transparent), transparent 44%),
            color-mix(in oklch, var(--sidebar-depth-search-on) 54%, transparent);
          box-shadow: var(--sidebar-neu-raised-active);
          color: var(--sidebar-primary);
          font-size: 0.75rem;
          font-weight: 500;
          backdrop-filter: blur(10px);
          transition: background 0.25s ease, box-shadow 0.28s ease, color 0.2s ease;
        }

        .create-studio-create:hover:not(:disabled) {
          color: var(--sidebar-primary);
          box-shadow: var(--sidebar-neu-raised-hover);
        }

        .create-studio-create-icon {
          width: 1rem;
          height: 1rem;
          flex: 0 0 auto;
        }

        .create-studio-save-note {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin: 0;
          padding: 0 clamp(0.85rem, 3vw, 2rem) max(0.75rem, env(safe-area-inset-bottom));
          color: var(--muted-foreground);
          font-size: 0.8125rem;
          line-height: 1.25;
          text-align: center;
        }

        .create-studio-main-foot {
          margin-top: auto;
        }

        .create-studio-main-foot p {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }

        .create-studio-image-module {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          min-height: 100%;
          overflow: visible;
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 34%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 72%, black));
        }

        .create-studio-image-module-head {
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 0.75rem;
          padding: max(0.8rem, calc(env(safe-area-inset-top, 0px) + 0.6rem)) clamp(0.85rem, 3vw, 2rem) 0.8rem;
          border-bottom: 1px solid color-mix(in oklch, var(--sidebar-border) 50%, transparent);
        }

        .create-studio-image-module-head h2 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.95rem;
          font-weight: 600;
          line-height: 1.2;
        }

        .create-studio-image-module-head p {
          margin: 0.2rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.3;
        }

        .create-studio-image-close,
        .create-studio-image-remove {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius);
          color: var(--muted-foreground);
        }

        .create-studio-image-close {
          width: 2rem;
          height: 2rem;
          flex: 0 0 auto;
        }

        .create-studio-image-error {
          margin: 0;
          padding: 0.55rem 0.85rem 0;
          color: var(--destructive);
          font-size: 0.75rem;
        }

        .create-studio-image-body {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.75rem;
          overflow: visible;
          padding: 0.75rem clamp(0.85rem, 3vw, 2rem);
        }

        .create-studio-image-bucket {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          border-radius: var(--radius);
          outline: none;
        }

        .create-studio-image-bucket:focus-visible .create-studio-image-empty,
        .create-studio-image-bucket:focus-within .create-studio-image-empty {
          border-color: color-mix(in oklch, var(--sidebar-primary) 58%, var(--sidebar-border));
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--sidebar-primary) 20%, transparent);
        }

        .create-studio-image-bucket-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.55rem;
        }

        .create-studio-image-bucket-head h3 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.76rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-image-bucket-head p {
          margin: 0.14rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          line-height: 1.25;
        }

        .create-studio-image-add {
          display: inline-flex;
          height: 1.75rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          border-radius: var(--radius);
          padding: 0 0.5rem;
          color: var(--foreground);
          font-size: 0.7rem;
          font-weight: 600;
        }

        .create-studio-image-list {
          display: grid;
          gap: 0.5rem;
        }

        .create-studio-image-empty {
          display: flex;
          min-height: 4.2rem;
          align-items: center;
          justify-content: center;
          gap: 0.45rem;
          border: 1px dashed color-mix(in oklch, var(--sidebar-border) 80%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 52%, transparent);
          color: var(--muted-foreground);
          font-size: 0.74rem;
        }

        .create-studio-image-card {
          display: grid;
          grid-template-columns: 7rem minmax(0, 1fr) 1.75rem;
          gap: 0.6rem;
          align-items: start;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 50%, transparent);
          padding: 0.45rem;
          box-shadow: var(--sidebar-neu-inset);
        }

        .create-studio-image-card img {
          width: 7rem;
          height: 7rem;
          border-radius: calc(var(--radius) - 0.1rem);
          object-fit: cover;
        }

        .create-studio-image-meta {
          min-width: 0;
          display: grid;
          gap: 0.35rem;
        }

        .create-studio-image-meta input {
          min-width: 0;
          width: 100%;
          height: 1.75rem;
          border: 0;
          border-radius: calc(var(--radius) - 0.1rem);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 56%, transparent);
          color: var(--foreground);
          font: inherit;
          font-size: 0.72rem;
          outline: none;
          padding: 0 0.5rem;
        }

        .create-studio-image-meta input::placeholder {
          color: var(--muted-foreground);
        }

        .create-studio-placement-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }

        .create-studio-placement-row button {
          height: 1.35rem;
          border-radius: calc(var(--radius) - 0.18rem);
          background: color-mix(in oklch, var(--sidebar-depth-raised) 78%, black);
          color: var(--muted-foreground);
          font-size: 0.62rem;
          line-height: 1;
          padding: 0 0.38rem;
        }

        .create-studio-placement-row button.is-active {
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 88%, black);
          color: var(--sidebar-primary);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-style-read {
          margin: 0.1rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          line-height: 1.35;
        }

        .create-studio-image-remove {
          width: 1.75rem;
          height: 1.75rem;
        }

        .create-studio-image-foot {
          position: sticky;
          bottom: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.75rem;
          border-top: 1px solid color-mix(in oklch, var(--sidebar-border) 50%, transparent);
          background:
            linear-gradient(180deg, color-mix(in oklch, var(--sidebar-depth-raised) 45%, transparent), color-mix(in oklch, var(--sidebar-depth-input) 68%, transparent));
          backdrop-filter: blur(14px);
          padding: 0.65rem clamp(0.85rem, 3vw, 2rem) max(0.65rem, env(safe-area-inset-bottom));
        }

        .create-studio-image-foot p {
          flex: 1;
          margin: 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
        }

        .create-studio-image-done {
          display: inline-flex;
          height: 2rem;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 36% 0%, color-mix(in oklch, var(--sidebar-primary) 22%, transparent), transparent 44%),
            color-mix(in oklch, var(--sidebar-depth-search-on) 52%, transparent);
          box-shadow: var(--sidebar-neu-raised-active);
          color: var(--sidebar-primary);
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0 0.85rem;
          backdrop-filter: blur(10px);
        }

        .create-studio-data-module {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          min-height: 100%;
          max-height: none;
          overflow: visible;
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 34%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 72%, black));
        }

        .create-studio-client-module {
          position: relative;
          z-index: 1;
          display: flex;
          min-height: 100%;
          max-height: none;
          flex-direction: column;
          overflow: visible;
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 34%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 72%, black));
        }

        .create-studio-template-module {
          position: relative;
          z-index: 1;
          display: flex;
          min-height: 100%;
          max-height: none;
          flex-direction: column;
          overflow: visible;
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 34%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 72%, black));
        }

        .create-studio-review-module {
          position: relative;
          z-index: 1;
          display: flex;
          min-height: 100%;
          max-height: none;
          flex-direction: column;
          overflow: visible;
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 34%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-raised) 72%, black));
        }

        .create-studio-submodule-head {
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 0.75rem;
          padding: max(0.8rem, calc(env(safe-area-inset-top, 0px) + 0.6rem)) clamp(0.85rem, 3vw, 2rem) 0.8rem;
          border-bottom: 1px solid color-mix(in oklch, var(--sidebar-border) 50%, transparent);
        }

        .create-studio-submodule-head h2 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.95rem;
          font-weight: 600;
          line-height: 1.2;
        }

        .create-studio-submodule-head p {
          margin: 0.2rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.3;
        }

        .create-studio-review-title-wrap {
          min-width: 0;
        }

        .create-studio-review-title-line {
          display: flex;
          min-width: 0;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0.45rem;
        }

        .create-studio-review-title-line span {
          color: var(--muted-foreground);
          font-size: 0.78rem;
          font-weight: 600;
          line-height: 1.2;
        }

        .create-studio-submodule-close {
          display: inline-flex;
          width: 2rem;
          height: 2rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius);
          color: var(--muted-foreground);
        }

        .create-studio-data-body {
          display: grid;
          flex: 1;
          min-height: 0;
          min-width: 0;
          grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
          gap: 0.85rem;
          overflow: hidden;
          padding: 0.75rem clamp(0.85rem, 3vw, 2rem);
        }

        .create-studio-data-side {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          overflow: hidden;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 58%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 40%),
            color-mix(in oklch, var(--sidebar-depth-input) 44%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.68rem;
        }

        .create-studio-data-vault-side {
          border-color: color-mix(in oklch, var(--sidebar-border) 68%, transparent);
        }

        .create-studio-data-raw-side {
          border-color: color-mix(in oklch, var(--sidebar-button-border) 64%, var(--sidebar-border));
        }

        .create-studio-raw-card-stack {
          display: grid;
          flex: 1;
          min-height: 0;
          align-content: start;
          gap: 0.65rem;
          overflow: auto;
          padding-right: 0.12rem;
        }

        .create-studio-client-tabs {
          display: flex;
          gap: 0.4rem;
          border-bottom: 1px solid color-mix(in oklch, var(--sidebar-border) 50%, transparent);
          padding: 0.55rem clamp(0.85rem, 3vw, 2rem) 0.6rem;
        }

        .create-studio-client-tabs button {
          height: 1.85rem;
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-raised) 78%, black);
          color: var(--muted-foreground);
          font-size: 0.72rem;
          font-weight: 650;
          padding: 0 0.75rem;
          transition: color 0.18s ease, box-shadow 0.18s ease;
        }

        .create-studio-client-tabs button:hover,
        .create-studio-client-tabs button.is-active {
          color: var(--sidebar-primary);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-client-body {
          display: grid;
          min-height: auto;
          min-width: 0;
          grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
          gap: 0.85rem;
          overflow: visible;
          padding: 0.75rem clamp(0.85rem, 3vw, 2rem);
        }

        .create-studio-client-side {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          overflow: visible;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 58%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 40%),
            color-mix(in oklch, var(--sidebar-depth-input) 44%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.68rem;
        }

        .create-studio-client-profile-side {
          border-color: color-mix(in oklch, var(--sidebar-button-border) 64%, var(--sidebar-border));
        }

        .create-studio-client-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }

        .create-studio-client-profile-list,
        .create-studio-selected-people {
          display: grid;
          gap: 0.45rem;
        }

        .create-studio-client-list-label {
          margin-top: 0.15rem;
          color: var(--muted-foreground);
          font-size: 0.62rem;
          font-weight: 650;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .create-studio-profile-row {
          min-width: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 46%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.58rem 0.65rem;
          text-align: left;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
        }

        .create-studio-profile-row:hover:not(:disabled),
        .create-studio-profile-row.is-selected,
        .create-studio-profile-row.is-focused {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 72%, var(--sidebar-border));
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-profile-row.is-muted {
          color: var(--muted-foreground);
        }

        .create-studio-profile-row strong,
        .create-studio-profile-row small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-profile-row strong {
          color: var(--foreground);
          font-size: 0.75rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-profile-row small {
          margin-top: 0.14rem;
          color: var(--muted-foreground);
          font-size: 0.62rem;
          line-height: 1.25;
        }

        .create-studio-selected-people {
          grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
        }

        .create-studio-selected-person {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.5rem;
          align-items: center;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 48%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 34%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.55rem 0.6rem;
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .create-studio-selected-person.is-open {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 72%, var(--sidebar-border));
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-selected-person-summary {
          display: flex;
          min-width: 0;
          align-items: center;
          justify-content: space-between;
          gap: 0.65rem;
        }

        .create-studio-selected-person-copy {
          min-width: 0;
        }

        .create-studio-selected-person-copy strong,
        .create-studio-selected-person-copy small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-selected-person-copy strong {
          color: var(--foreground);
          font-size: 0.78rem;
          font-weight: 700;
        }

        .create-studio-selected-person-copy small {
          margin-top: 0.12rem;
          color: var(--muted-foreground);
          font-size: 0.64rem;
        }

        .create-studio-selected-person-actions,
        .create-studio-profile-card-actions,
        .create-studio-profile-editor-actions {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .create-studio-selected-person-actions {
          justify-content: flex-end;
          gap: 0.32rem;
        }

        .create-studio-selected-person-actions .neu-raised {
          height: 1.72rem;
          border-radius: var(--radius);
          color: var(--foreground);
          font-size: 0.64rem;
          font-weight: 650;
          padding: 0 0.5rem;
        }

        .create-studio-selected-person-view {
          min-width: 4.8rem;
        }

        .create-studio-selected-person-remove {
          width: 1.72rem;
          min-width: 1.72rem;
          padding: 0;
        }

        .create-studio-selected-person-remove svg {
          width: 0.72rem;
          height: 0.72rem;
        }

        .create-studio-selected-person-detail {
          grid-column: 1 / -1;
          display: grid;
          gap: 0.55rem;
          border-top: 1px solid color-mix(in oklch, var(--sidebar-border) 42%, transparent);
          margin-top: 0.1rem;
          padding-top: 0.55rem;
        }

        .create-studio-selected-person-detail p {
          margin: 0;
          color: var(--foreground);
          font-size: 0.72rem;
          line-height: 1.4;
        }

        .create-studio-profile-edit-button {
          justify-self: start;
          height: 1.9rem;
          border-radius: var(--radius);
          color: var(--muted-foreground);
          font-size: 0.68rem;
          font-weight: 700;
          padding: 0 0.7rem;
        }

        .create-studio-profile-card,
        .create-studio-profile-draft {
          display: grid;
          gap: 0.55rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 48%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 24%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.65rem;
        }

        .create-studio-profile-card h4 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.86rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-profile-card p {
          margin: 0.16rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.7rem;
          line-height: 1.35;
        }

        .create-studio-profile-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.28rem;
        }

        .create-studio-profile-tags span {
          border-radius: calc(var(--radius) - 0.18rem);
          background: color-mix(in oklch, var(--sidebar-depth-raised) 78%, black);
          color: var(--muted-foreground);
          font-size: 0.62rem;
          font-weight: 600;
          line-height: 1;
          padding: 0.35rem 0.42rem;
        }

        .create-studio-profile-source-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }

        .create-studio-profile-source-chips span {
          max-width: 14rem;
          overflow: hidden;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 56%, transparent);
          border-radius: calc(var(--radius) - 0.18rem);
          color: var(--muted-foreground);
          font-size: 0.6rem;
          font-weight: 600;
          line-height: 1;
          padding: 0.32rem 0.4rem;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-profile-card .create-studio-profile-notes {
          color: var(--foreground);
          font-size: 0.72rem;
        }

        .create-studio-profile-remove {
          justify-self: start;
          height: 1.85rem;
          border-radius: var(--radius);
          color: var(--muted-foreground);
          font-size: 0.68rem;
          font-weight: 650;
          padding: 0 0.65rem;
        }

        .create-studio-profile-use-backdrop,
        .create-studio-profile-editor-backdrop {
          position: fixed;
          inset: 0;
          z-index: 72;
          display: grid;
          place-items: center;
          background: color-mix(in oklch, var(--background) 38%, transparent);
          backdrop-filter: blur(10px);
          padding: 1rem;
        }

        .create-studio-profile-use-modal,
        .create-studio-profile-editor-modal {
          width: min(100%, 44rem);
          border: 1px solid color-mix(in oklch, var(--sidebar-button-border) 70%, var(--sidebar-border));
          border-radius: calc(var(--radius) + 0.2rem);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 92%, var(--background));
          box-shadow: var(--sidebar-neu-raised-active), 0 1.2rem 3rem rgb(0 0 0 / 0.26);
          color: var(--foreground);
          padding: 0.8rem;
        }

        .create-studio-profile-use-modal h3,
        .create-studio-profile-editor-modal h3,
        .create-studio-profile-editor-terminal h4 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.95rem;
          font-weight: 750;
        }

        .create-studio-profile-use-modal p,
        .create-studio-profile-editor-modal p {
          margin: 0.2rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
        }

        .create-studio-profile-use-options {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.55rem;
          margin-top: 0.75rem;
        }

        .create-studio-profile-use-options button {
          display: grid;
          gap: 0.28rem;
          min-height: 5rem;
          align-content: center;
          border-radius: var(--radius);
          padding: 0.65rem;
          text-align: left;
        }

        .create-studio-profile-use-options strong,
        .create-studio-profile-use-options small {
          display: block;
        }

        .create-studio-profile-use-options strong {
          color: var(--foreground);
          font-size: 0.78rem;
        }

        .create-studio-profile-use-options small {
          color: var(--muted-foreground);
          font-size: 0.64rem;
          line-height: 1.32;
        }

        .create-studio-profile-editor-modal {
          width: min(100%, 58rem);
        }

        .create-studio-profile-editor-head {
          display: flex;
          align-items: start;
          justify-content: flex-start;
          gap: 1rem;
        }

        .create-studio-profile-editor-body {
          display: grid;
          grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
          gap: 0.7rem;
          margin-top: 0.8rem;
        }

        .create-studio-profile-editor-terminal,
        .create-studio-profile-editor-form {
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 50%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.72rem;
        }

        .create-studio-profile-editor-terminal dl {
          display: grid;
          gap: 0.55rem;
          margin: 0.7rem 0 0;
        }

        .create-studio-profile-editor-terminal div {
          display: grid;
          gap: 0.16rem;
        }

        .create-studio-profile-editor-terminal dt {
          color: var(--muted-foreground);
          font-size: 0.58rem;
          font-weight: 750;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .create-studio-profile-editor-terminal dd {
          margin: 0;
          color: var(--foreground);
          font-size: 0.72rem;
          line-height: 1.38;
        }

        .create-studio-profile-editor-form {
          display: grid;
          gap: 0.5rem;
        }

        .create-studio-profile-editor-form input,
        .create-studio-profile-editor-form textarea {
          width: 100%;
          min-width: 0;
          border: 0;
          border-radius: calc(var(--radius) - 0.1rem);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 56%, transparent);
          color: var(--foreground);
          font: inherit;
          font-size: 0.72rem;
          outline: none;
          padding: 0.52rem 0.55rem;
        }

        .create-studio-profile-editor-form textarea {
          min-height: 8.5rem;
          resize: vertical;
        }

        .create-studio-profile-editor-actions {
          justify-content: flex-end;
          margin-top: 0.75rem;
        }

        .create-studio-profile-editor-actions button {
          height: 2rem;
          border-radius: var(--radius);
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0 0.8rem;
        }

        .create-studio-profile-draft input,
        .create-studio-profile-draft textarea {
          width: 100%;
          min-width: 0;
          border: 0;
          border-radius: calc(var(--radius) - 0.1rem);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 56%, transparent);
          color: var(--foreground);
          font: inherit;
          font-size: 0.72rem;
          outline: none;
          padding: 0.52rem 0.55rem;
        }

        .create-studio-profile-draft textarea {
          resize: vertical;
        }

        .create-studio-profile-draft-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.45rem;
        }

        .create-studio-template-body {
          display: grid;
          min-height: auto;
          min-width: 0;
          grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
          gap: 0.85rem;
          overflow: visible;
          padding: 0.75rem clamp(0.85rem, 3vw, 2rem);
        }

        .create-studio-template-side {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          overflow: visible;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 58%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 40%),
            color-mix(in oklch, var(--sidebar-depth-input) 44%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.68rem;
        }

        .create-studio-template-carry-side {
          border-color: color-mix(in oklch, var(--sidebar-button-border) 64%, var(--sidebar-border));
        }

        .create-studio-template-list {
          display: grid;
          gap: 0.45rem;
        }

        .create-studio-template-row {
          min-width: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 46%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.58rem 0.65rem;
          text-align: left;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
        }

        .create-studio-template-row:hover:not(:disabled),
        .create-studio-template-row.is-selected {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 72%, var(--sidebar-border));
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-template-row.is-muted {
          color: var(--muted-foreground);
        }

        .create-studio-template-row-auto {
          background:
            radial-gradient(circle at 14% 18%, color-mix(in oklch, var(--sidebar-primary) 12%, transparent), transparent 42%),
            color-mix(in oklch, var(--sidebar-depth-input) 50%, transparent);
        }

        .create-studio-template-row-title {
          display: flex !important;
          align-items: center;
          gap: 0.34rem;
        }

        .create-studio-template-row-title svg {
          width: 0.78rem;
          height: 0.78rem;
          flex: 0 0 auto;
          color: var(--sidebar-primary);
        }

        .create-studio-template-row strong,
        .create-studio-template-row small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-template-row strong {
          color: var(--foreground);
          font-size: 0.75rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-template-row small {
          margin-top: 0.14rem;
          color: var(--muted-foreground);
          font-size: 0.62rem;
          line-height: 1.25;
        }

        .create-studio-template-card {
          display: grid;
          gap: 0.55rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 48%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 24%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.65rem;
        }

        .create-studio-template-card h4 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.86rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-template-card p,
        .create-studio-template-note,
        .create-studio-template-selected p {
          margin: 0;
          color: var(--muted-foreground);
          font-size: 0.7rem;
          line-height: 1.35;
        }

        .create-studio-template-options {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.45rem;
        }

        .create-studio-template-options button {
          min-width: 0;
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 48%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          color: var(--muted-foreground);
          padding: 0.52rem 0.58rem;
          text-align: left;
          transition: color 0.18s ease, box-shadow 0.18s ease;
        }

        .create-studio-template-options button:hover:not(:disabled),
        .create-studio-template-options button.is-active {
          color: var(--sidebar-primary);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-template-options button:disabled {
          cursor: default;
          opacity: 0.45;
        }

        .create-studio-template-options strong,
        .create-studio-template-options small {
          display: block;
        }

        .create-studio-template-options strong {
          color: var(--foreground);
          font-size: 0.7rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-template-options small {
          margin-top: 0.15rem;
          font-size: 0.62rem;
          line-height: 1.25;
        }

        .create-studio-template-selected {
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 42%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 44%, transparent);
          padding: 0.55rem 0.6rem;
        }

        .create-studio-pattern-lock {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.7rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-button-border-active) 54%, var(--sidebar-border));
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 34%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.58rem 0.65rem;
        }

        .create-studio-pattern-lock div {
          min-width: 0;
          display: grid;
          gap: 0.14rem;
        }

        .create-studio-pattern-lock strong,
        .create-studio-pattern-lock span {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .create-studio-pattern-lock strong {
          color: var(--foreground);
          font-size: 0.72rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .create-studio-pattern-lock span {
          color: var(--muted-foreground);
          font-size: 0.64rem;
          line-height: 1.32;
        }

        .create-studio-pattern-lock button {
          flex: 0 0 auto;
          border-radius: var(--radius);
          color: var(--sidebar-primary);
          font-size: 0.68rem;
          font-weight: 700;
          padding: 0.36rem 0.55rem;
        }

        .create-studio-pattern-picker {
          display: grid;
          gap: 0.5rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 46%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 35%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.62rem;
        }

        .create-studio-pattern-picker-head h4 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.74rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .create-studio-pattern-picker-head p {
          margin: 0.12rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.64rem;
          line-height: 1.3;
        }

        .create-studio-pattern-list {
          display: grid;
          gap: 0.4rem;
        }

        .create-studio-pattern-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 2rem;
          gap: 0.42rem;
          align-items: stretch;
        }

        .create-studio-pattern-pick,
        .create-studio-pattern-delete {
          min-width: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 46%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          text-align: left;
        }

        .create-studio-pattern-pick {
          padding: 0.5rem 0.58rem;
        }

        .create-studio-pattern-pick:hover:not(:disabled),
        .create-studio-pattern-row.is-selected .create-studio-pattern-pick {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 72%, var(--sidebar-border));
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-pattern-pick strong,
        .create-studio-pattern-pick small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-pattern-pick strong {
          color: var(--foreground);
          font-size: 0.72rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .create-studio-pattern-pick small {
          margin-top: 0.12rem;
          color: var(--muted-foreground);
          font-size: 0.61rem;
          line-height: 1.25;
        }

        .create-studio-pattern-delete {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--muted-foreground);
        }

        .create-studio-pattern-delete:hover:not(:disabled) {
          color: var(--destructive);
          box-shadow: var(--sidebar-neu-raised);
        }

        .create-studio-pattern-delete-backdrop {
          position: fixed;
          inset: 0;
          z-index: 90;
          display: grid;
          place-items: center;
          background: color-mix(in oklch, var(--background) 42%, transparent);
          backdrop-filter: blur(10px);
          padding: 1rem;
        }

        .create-studio-pattern-delete-modal {
          width: min(100%, 26rem);
          border: 1px solid color-mix(in oklch, var(--destructive) 36%, var(--sidebar-border));
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 94%, var(--background));
          box-shadow: var(--sidebar-neu-raised-active), 0 1rem 2.5rem rgb(0 0 0 / 0.34);
          padding: 0.9rem;
        }

        .create-studio-pattern-delete-modal h3 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.92rem;
          font-weight: 750;
        }

        .create-studio-pattern-delete-modal p {
          margin: 0.3rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.35;
        }

        .create-studio-pattern-delete-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.55rem;
          margin-top: 0.85rem;
        }

        .create-studio-pattern-delete-actions button {
          height: 2rem;
          border-radius: var(--radius);
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0 0.8rem;
        }

        .create-studio-review-body {
          display: grid;
          min-height: auto;
          min-width: 0;
          grid-template-columns: minmax(0, 1.14fr) minmax(17rem, 0.86fr);
          gap: 0.85rem;
          overflow: visible;
          padding: 0.75rem clamp(0.85rem, 3vw, 2rem);
        }

        .create-studio-review-body.is-brief-only {
          display: block;
        }

        .create-studio-tune-bar {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 0.5rem;
          border-bottom: 1px solid color-mix(in oklch, var(--sidebar-border) 42%, transparent);
          padding: 0.65rem clamp(0.85rem, 3vw, 2rem);
        }

        .create-studio-tune-trigger,
        .create-studio-tune-selected button,
        .create-studio-tune-reset,
        .create-studio-tune-close,
        .create-studio-tune-grid button {
          appearance: none;
          border: 0;
          color: inherit;
          cursor: pointer;
          font: inherit;
          -webkit-tap-highlight-color: transparent;
        }

        .create-studio-tune-trigger {
          display: inline-flex;
          height: 2rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          border-radius: var(--radius);
          color: var(--sidebar-primary);
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0 0.7rem;
        }

        .create-studio-tune-trigger strong {
          display: inline-flex;
          min-width: 1.05rem;
          height: 1.05rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-primary) 82%, white);
          color: black;
          font-size: 0.62rem;
          line-height: 1;
        }

        .create-studio-tune-bar > p {
          min-width: 0;
          margin: 0;
          color: var(--muted-foreground);
          font-size: 0.7rem;
          line-height: 1.25;
        }

        .create-studio-tune-selected {
          display: flex;
          min-width: 0;
          flex: 1;
          flex-wrap: wrap;
          gap: 0.35rem;
        }

        .create-studio-tune-selected button,
        .create-studio-tune-selected span {
          display: inline-flex;
          height: 1.65rem;
          align-items: center;
          gap: 0.25rem;
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 82%, black);
          box-shadow: var(--sidebar-neu-raised-active);
          color: var(--sidebar-primary);
          font-size: 0.66rem;
          font-weight: 650;
          padding: 0 0.52rem;
        }

        .create-studio-tune-reset {
          margin-left: auto;
          border-radius: var(--radius);
          color: var(--muted-foreground);
          font-size: 0.68rem;
          font-weight: 650;
          padding: 0.35rem 0.45rem;
        }

        .create-studio-tune-overlay {
          position: fixed;
          inset: 0;
          z-index: 1001;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          background: hsl(0 0% 0% / 0.38);
          backdrop-filter: blur(3px);
        }

        .create-studio-tune-panel {
          display: flex;
          width: min(46rem, calc(100vw - 2rem));
          max-height: min(42rem, calc(100dvh - 2rem));
          flex-direction: column;
          overflow: hidden;
          border: 1px solid color-mix(in oklch, var(--sidebar-button-border) 70%, var(--sidebar-border));
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.018), transparent 42%),
            linear-gradient(180deg, var(--sidebar-depth-raised), color-mix(in oklch, var(--sidebar-depth-input) 82%, black));
          box-shadow: 0 1.4rem 4rem hsl(0 0% 0% / 0.52), var(--sidebar-neu-raised);
        }

        .create-studio-tune-head,
        .create-studio-tune-foot {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 0.75rem;
          padding: 0.8rem;
        }

        .create-studio-tune-foot {
          justify-content: flex-end;
        }

        .create-studio-tune-head {
          border-bottom: 1px solid color-mix(in oklch, var(--sidebar-border) 48%, transparent);
        }

        .create-studio-tune-head h3 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.95rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .create-studio-tune-head p {
          margin: 0.2rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.35;
        }

        .create-studio-tune-close {
          display: inline-flex;
          width: 2rem;
          height: 2rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius);
          color: var(--muted-foreground);
        }

        .create-studio-tune-body {
          display: grid;
          gap: 0.75rem;
          overflow: auto;
          padding: 0.8rem;
        }

        .create-studio-tune-group h4 {
          margin: 0 0 0.42rem;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          font-weight: 750;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .create-studio-tune-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.5rem;
        }

        .create-studio-tune-grid button {
          min-width: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 48%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.62rem;
          text-align: left;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
        }

        .create-studio-tune-grid button:hover:not(:disabled),
        .create-studio-tune-grid button.is-active {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 72%, var(--sidebar-border));
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-tune-grid strong,
        .create-studio-tune-grid small {
          display: block;
          min-width: 0;
        }

        .create-studio-tune-grid strong {
          color: var(--foreground);
          font-size: 0.75rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .create-studio-tune-grid small {
          margin-top: 0.22rem;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          line-height: 1.32;
        }

        .create-studio-tune-grid button.is-active small {
          color: color-mix(in oklch, var(--sidebar-primary) 40%, var(--muted-foreground));
        }

        .create-studio-tune-foot {
          justify-content: flex-end;
          border-top: 1px solid color-mix(in oklch, var(--sidebar-border) 48%, transparent);
        }

        .create-studio-review-main,
        .create-studio-review-side {
          min-width: 0;
          min-height: 0;
          display: grid;
          align-content: start;
          gap: 0.55rem;
          overflow: visible;
        }

        .create-studio-review-section {
          min-width: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 50% 0%, hsl(0 0% 100% / 0.016), transparent 42%),
            color-mix(in oklch, var(--sidebar-depth-input) 44%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.65rem;
        }

        .create-studio-review-editor {
          min-height: min(28rem, calc(100dvh - 9rem));
          display: flex;
          flex-direction: column;
          border-color: color-mix(in oklch, var(--sidebar-button-border) 64%, var(--sidebar-border));
          background:
            radial-gradient(circle at 38% 0%, hsl(0 0% 100% / 0.018), transparent 46%),
            color-mix(in oklch, var(--sidebar-depth-input) 50%, transparent);
          padding: 0.8rem;
        }

        .create-studio-review-textarea {
          min-height: 20rem;
          flex: 1;
          width: 100%;
          resize: vertical;
          border: 0;
          border-radius: calc(var(--radius) - 0.08rem);
          background:
            linear-gradient(180deg, color-mix(in oklch, var(--sidebar-depth-canvas) 52%, transparent), color-mix(in oklch, var(--sidebar-depth-canvas) 38%, transparent));
          box-shadow: var(--sidebar-neu-inset);
          color: var(--foreground);
          font: inherit;
          font-size: 0.92rem;
          line-height: 1.55;
          outline: none;
          padding: 0.85rem;
        }

        .create-studio-review-textarea:focus {
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--sidebar-button-border-active) 58%, transparent),
            var(--sidebar-neu-inset);
        }

        .create-studio-review-textarea::placeholder {
          color: var(--muted-foreground);
        }

        .create-studio-review-section-head {
          display: flex;
          min-width: 0;
          align-items: center;
          justify-content: space-between;
          gap: 0.55rem;
          margin-bottom: 0.48rem;
        }

        .create-studio-review-section-head h3 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.76rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-review-section-head span {
          max-width: 46%;
          overflow: hidden;
          border-radius: calc(var(--radius) - 0.18rem);
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 80%, black);
          color: var(--sidebar-primary);
          font-size: 0.62rem;
          font-weight: 650;
          line-height: 1;
          padding: 0.34rem 0.45rem;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-review-brief {
          border-color: color-mix(in oklch, var(--sidebar-button-border) 64%, var(--sidebar-border));
        }

        .create-studio-review-brief p,
        .create-studio-review-lines p,
        .create-studio-review-soft {
          margin: 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.42;
        }

        .create-studio-review-brief p {
          color: var(--foreground);
          font-size: 0.78rem;
        }

        .create-studio-review-lines {
          display: grid;
          gap: 0.34rem;
        }

        .create-studio-review-lines strong {
          color: var(--foreground);
          font-weight: 650;
        }

        .create-studio-review-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.55rem;
        }

        .create-studio-review-prompt-home {
          margin: -0.2rem 0 0.5rem;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          line-height: 1.25;
        }

        .create-studio-review-image-list {
          display: grid;
          gap: 0.42rem;
        }

        .create-studio-review-image {
          display: grid;
          min-width: 0;
          grid-template-columns: 2.8rem minmax(0, 1fr);
          gap: 0.5rem;
          align-items: center;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 48%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 30%, transparent);
          padding: 0.42rem;
        }

        .create-studio-review-image img {
          width: 2.8rem;
          height: 2.8rem;
          border-radius: calc(var(--radius) - 0.1rem);
          object-fit: cover;
          box-shadow: 0 0.55rem 1rem hsl(0 0% 0% / 0.22);
        }

        .create-studio-review-image strong,
        .create-studio-review-image small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-review-image strong {
          color: var(--foreground);
          font-size: 0.72rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-review-image small {
          margin-top: 0.16rem;
          color: var(--muted-foreground);
          font-size: 0.62rem;
          line-height: 1.2;
        }

        .create-studio-review-flow {
          display: grid;
          gap: 0.45rem;
        }

        .create-studio-review-flow article {
          display: grid;
          grid-template-columns: 1.55rem minmax(0, 1fr);
          gap: 0.5rem;
          align-items: start;
        }

        .create-studio-review-flow article > span {
          display: inline-flex;
          width: 1.55rem;
          height: 1.55rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 82%, black);
          box-shadow: var(--sidebar-neu-raised-active);
          color: var(--sidebar-primary);
          font-size: 0.62rem;
          font-weight: 750;
        }

        .create-studio-review-flow strong {
          display: block;
          color: var(--foreground);
          font-size: 0.72rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-review-flow p {
          margin: 0.14rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          line-height: 1.34;
        }

        .create-studio-review-toggle,
        .create-studio-review-edit {
          display: inline-flex;
          height: 1.9rem;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius);
          color: var(--foreground);
          font-size: 0.7rem;
          font-weight: 600;
          padding: 0 0.65rem;
        }

        .create-studio-review-full {
          max-height: none;
          overflow: visible;
          margin: 0.55rem 0 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 42%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 46%, black 8%);
          color: var(--foreground);
          font-family: var(--font-mono);
          font-size: 0.64rem;
          line-height: 1.42;
          padding: 0.65rem;
          white-space: pre-wrap;
        }

        .create-studio-review-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 0.45rem;
        }

        .create-studio-data-side-head h3 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.76rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-data-side-head p {
          margin: 0.14rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          line-height: 1.25;
        }

        .create-studio-vault-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.38rem;
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-canvas) 38%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.3rem;
        }

        .create-studio-vault-tabs button {
          display: inline-flex;
          min-width: 0;
          height: 1.95rem;
          align-items: center;
          justify-content: center;
          gap: 0.42rem;
          border-radius: calc(var(--radius) - 0.16rem);
          color: var(--muted-foreground);
          font-size: 0.72rem;
          font-weight: 700;
          transition: color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
        }

        .create-studio-vault-tabs button:hover:not(:disabled),
        .create-studio-vault-tabs button.is-active {
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 88%, black);
          box-shadow: var(--sidebar-neu-raised-active);
          color: var(--sidebar-primary);
        }

        .create-studio-vault-tabs span {
          display: inline-flex;
          min-width: 1.2rem;
          height: 1.2rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-depth-input) 58%, transparent);
          color: inherit;
          font-size: 0.62rem;
          line-height: 1;
          padding: 0 0.28rem;
        }

        .create-studio-vault-picker,
        .create-studio-vault-files,
        .create-studio-raw-file-list {
          display: grid;
          gap: 0.45rem;
        }

        .create-studio-vault-picker {
          min-height: 0;
          overflow: auto;
          padding-right: 0.1rem;
        }

        .create-studio-vault-files {
          min-height: 0;
          flex: 1;
          overflow: hidden;
        }

        .create-studio-vault-picker > p,
        .create-studio-data-status,
        .create-studio-data-error {
          margin: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 42%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 44%, transparent);
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.3;
          padding: 0.55rem 0.6rem;
        }

        .create-studio-vault-picker > p.is-error,
        .create-studio-data-error {
          color: var(--destructive);
        }

        .create-studio-vault-choice,
        .create-studio-vault-tabs button,
        .create-studio-vault-file-list button,
        .create-studio-scope-row button,
        .create-studio-raw-role-row button {
          appearance: none;
          border: 0;
          color: inherit;
          font: inherit;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .create-studio-vault-choice {
          display: block;
          min-width: 0;
          border-radius: var(--radius);
          padding: 0.55rem 0.65rem;
          text-align: left;
          color: var(--muted-foreground);
          transition: color 0.18s ease, box-shadow 0.18s ease;
        }

        .create-studio-vault-choice:hover:not(:disabled),
        .create-studio-vault-choice.is-active {
          color: var(--sidebar-primary);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-vault-choice strong,
        .create-studio-vault-choice small,
        .create-studio-vault-file-list button span,
        .create-studio-vault-file-list button small,
        .create-studio-raw-file-main strong,
        .create-studio-raw-file-main small {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-studio-vault-choice strong,
        .create-studio-raw-file-main strong {
          color: var(--foreground);
          font-size: 0.75rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-vault-choice small,
        .create-studio-raw-file-main small {
          margin-top: 0.16rem;
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-size: 0.62rem;
          line-height: 1.25;
        }

        .create-studio-scope-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.35rem;
        }

        .create-studio-scope-row button,
        .create-studio-raw-role-row button {
          height: 1.65rem;
          border-radius: calc(var(--radius) - 0.18rem);
          background: color-mix(in oklch, var(--sidebar-depth-raised) 78%, black);
          color: var(--muted-foreground);
          font-size: 0.64rem;
          font-weight: 600;
          line-height: 1;
          padding: 0 0.45rem;
          transition: color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
        }

        .create-studio-scope-row button:hover:not(:disabled),
        .create-studio-scope-row button.is-active,
        .create-studio-raw-role-row button:hover:not(:disabled),
        .create-studio-raw-role-row button.is-active {
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 88%, black);
          color: var(--sidebar-primary);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-vault-file-list {
          display: grid;
          min-height: 0;
          flex: 1;
          gap: 0.4rem;
          overflow: auto;
          padding-right: 0.1rem;
        }

        .create-studio-vault-file-list button {
          min-width: 0;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 46%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.5rem 0.6rem;
          text-align: left;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
        }

        .create-studio-vault-file-list button:hover:not(:disabled),
        .create-studio-vault-file-list button.is-active {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 72%, var(--sidebar-border));
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-vault-file-list button span {
          color: var(--foreground);
          font-size: 0.72rem;
          font-weight: 600;
        }

        .create-studio-vault-file-list button small {
          margin-top: 0.12rem;
          color: var(--muted-foreground);
          font-size: 0.62rem;
        }

        .create-studio-data-text {
          min-height: 5.8rem;
          max-height: 10rem;
          width: 100%;
          resize: vertical;
          border: 0;
          color: var(--foreground);
          font: inherit;
          font-size: 0.76rem;
          line-height: 1.4;
          outline: none;
          padding: 0.6rem 0.65rem;
        }

        .create-studio-data-text::placeholder {
          color: var(--muted-foreground);
        }

        .create-studio-data-group {
          display: grid;
          gap: 0.48rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 48%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 100% 0%, hsl(0 0% 100% / 0.018), transparent 38%),
            color-mix(in oklch, var(--sidebar-depth-canvas) 24%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.65rem;
        }

        .create-studio-raw-input-group {
          border-color: color-mix(in oklch, var(--sidebar-border) 62%, transparent);
        }

        .create-studio-raw-source-group {
          border-color: color-mix(in oklch, var(--sidebar-button-border) 64%, var(--sidebar-border));
        }

        .create-studio-finished-group {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 64%, var(--sidebar-border));
          background:
            radial-gradient(circle at 100% 0%, hsl(0 0% 100% / 0.018), transparent 44%),
            color-mix(in oklch, var(--sidebar-depth-canvas) 28%, transparent);
          box-shadow: var(--sidebar-neu-raised-active);
        }

        .create-studio-data-card-label {
          display: inline-flex;
          width: fit-content;
          margin-bottom: 0.28rem;
          border-radius: calc(var(--radius) - 0.2rem);
          background: color-mix(in oklch, var(--sidebar-depth-search-on) 84%, black);
          color: var(--sidebar-primary);
          font-size: 0.58rem;
          font-weight: 750;
          line-height: 1;
          padding: 0.28rem 0.36rem;
          text-transform: uppercase;
        }

        .create-studio-data-group-head {
          display: flex;
          min-width: 0;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.55rem;
        }

        .create-studio-data-group-head > div {
          min-width: 0;
          flex: 1;
        }

        .create-studio-data-group-head h4 {
          margin: 0;
          color: var(--foreground);
          font-size: 0.72rem;
          font-weight: 650;
          line-height: 1.2;
        }

        .create-studio-data-group-head p {
          margin: 0.12rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.64rem;
          line-height: 1.25;
        }

        .create-studio-raw-upload-row {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 0.45rem;
        }

        .create-studio-raw-upload-row .create-studio-data-error {
          flex: 1;
          padding: 0.42rem 0.5rem;
        }

        .create-studio-raw-add {
          display: inline-flex;
          height: 1.9rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          gap: 0.28rem;
          border-radius: var(--radius);
          color: var(--foreground);
          font-size: 0.7rem;
          font-weight: 600;
          padding: 0 0.6rem;
        }

        .create-studio-raw-file {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 1.75rem;
          gap: 0.45rem;
          align-items: start;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 54%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 50%, transparent);
          box-shadow: var(--sidebar-neu-inset);
          padding: 0.48rem;
        }

        .create-studio-raw-file-main {
          min-width: 0;
          display: grid;
          gap: 0.35rem;
        }

        .create-studio-raw-role-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }

        .create-studio-data-module button:disabled {
          cursor: default;
          opacity: 0.45;
        }

        .create-studio-shell .neu-raised-active,
        .create-studio-shell .create-studio-create,
        .create-studio-shell .create-studio-image-done,
        .create-studio-shell button.create-studio-create,
        .create-studio-shell button.create-studio-image-done,
        .create-studio-shell button.neu-raised-active {
          border: 1px solid transparent;
          background: var(--sidebar-depth-selected);
          box-shadow: var(--sidebar-neu-selected);
          color: var(--sidebar-primary-foreground);
          backdrop-filter: none;
        }

        .create-studio-shell .create-studio-create:hover:not(:disabled),
        .create-studio-shell .create-studio-image-done:hover:not(:disabled),
        .create-studio-shell button.create-studio-create:hover:not(:disabled),
        .create-studio-shell button.create-studio-image-done:hover:not(:disabled),
        .create-studio-shell button.neu-raised-active:hover:not(:disabled) {
          background: var(--sidebar-depth-selected);
          box-shadow: var(--sidebar-neu-selected);
          color: var(--sidebar-primary-foreground);
        }

        .create-studio-shell .create-studio-output.is-active,
        .create-studio-shell .create-studio-option.is-on,
        .create-studio-shell .create-studio-client-tabs button.is-active,
        .create-studio-shell .create-studio-vault-tabs button.is-active,
        .create-studio-shell .create-studio-vault-choice.is-active,
        .create-studio-shell .create-studio-scope-row button.is-active,
        .create-studio-shell .create-studio-raw-role-row button.is-active,
        .create-studio-shell .create-studio-vault-file-list button.is-active,
        .create-studio-shell .create-studio-profile-row.is-selected,
        .create-studio-shell .create-studio-profile-row.is-focused,
        .create-studio-shell .create-studio-selected-person.is-open,
        .create-studio-shell .create-studio-template-row.is-selected,
        .create-studio-shell .create-studio-template-options button.is-active,
        .create-studio-shell .create-studio-tune-grid button.is-active,
        .create-studio-shell .create-studio-placement-row button.is-active,
        .create-studio-shell .create-studio-route-grid button.is-active,
        .create-studio-shell .create-studio-document-format button.is-active,
        .create-studio-shell .create-studio-output-choice-grid button.is-active {
          border-color: transparent;
          background: var(--sidebar-depth-selected);
          box-shadow: var(--sidebar-neu-selected);
          color: var(--sidebar-primary-foreground);
        }

        .create-studio-shell .create-studio-output.is-active .create-studio-output-icon,
        .create-studio-shell .create-studio-option.is-on .create-studio-option-icon,
        .create-studio-shell .create-studio-output-choice-grid button.is-active small,
        .create-studio-shell .create-studio-route-grid button.is-active small,
        .create-studio-shell .create-studio-vault-choice.is-active strong,
        .create-studio-shell .create-studio-vault-choice.is-active small {
          color: var(--sidebar-primary-foreground);
        }

        .create-studio-shell .create-studio-output,
        .create-studio-shell .create-studio-option,
        .create-studio-shell .create-studio-client-tabs button,
        .create-studio-shell .create-studio-vault-tabs button,
        .create-studio-shell .create-studio-vault-choice,
        .create-studio-shell .create-studio-scope-row button,
        .create-studio-shell .create-studio-raw-role-row button,
        .create-studio-shell .create-studio-vault-file-list button,
        .create-studio-shell .create-studio-placement-row button,
        .create-studio-shell .create-studio-profile-row,
        .create-studio-shell .create-studio-template-row,
        .create-studio-shell .create-studio-template-options button,
        .create-studio-shell .create-studio-tune-grid button,
        .create-studio-shell .create-studio-context-edit,
        .create-studio-shell .create-studio-raw-add,
        .create-studio-shell .create-studio-small-button,
        .create-studio-shell .create-studio-review-toggle,
        .create-studio-shell .create-studio-review-edit,
        .create-studio-shell .create-studio-profile-edit-button,
        .create-studio-shell .create-studio-profile-remove {
          border: 1px solid var(--sidebar-button-border);
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--sidebar-foreground);
        }

        .create-studio-shell .create-studio-output:hover:not(:disabled),
        .create-studio-shell .create-studio-option:hover:not(:disabled),
        .create-studio-shell .create-studio-client-tabs button:hover:not(:disabled),
        .create-studio-shell .create-studio-vault-tabs button:hover:not(:disabled),
        .create-studio-shell .create-studio-vault-choice:hover:not(:disabled),
        .create-studio-shell .create-studio-scope-row button:hover:not(:disabled),
        .create-studio-shell .create-studio-raw-role-row button:hover:not(:disabled),
        .create-studio-shell .create-studio-vault-file-list button:hover:not(:disabled),
        .create-studio-shell .create-studio-placement-row button:hover:not(:disabled),
        .create-studio-shell .create-studio-profile-row:hover:not(:disabled),
        .create-studio-shell .create-studio-template-row:hover:not(:disabled),
        .create-studio-shell .create-studio-template-options button:hover:not(:disabled),
        .create-studio-shell .create-studio-tune-grid button:hover:not(:disabled),
        .create-studio-shell .create-studio-context-edit:hover:not(:disabled),
        .create-studio-shell .create-studio-raw-add:hover:not(:disabled),
        .create-studio-shell .create-studio-small-button:hover:not(:disabled),
        .create-studio-shell .create-studio-review-toggle:hover:not(:disabled),
        .create-studio-shell .create-studio-review-edit:hover:not(:disabled),
        .create-studio-shell .create-studio-profile-edit-button:hover:not(:disabled),
        .create-studio-shell .create-studio-profile-remove:hover:not(:disabled) {
          border-color: color-mix(in oklch, var(--sidebar-button-border-hover) 72%, transparent);
          background: var(--sidebar-depth-raised-hover);
          box-shadow: var(--sidebar-neu-raised-hover);
          color: var(--sidebar-foreground);
        }

        .create-studio-shell .create-studio-output.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-option.is-on:hover:not(:disabled),
        .create-studio-shell .create-studio-client-tabs button.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-vault-tabs button.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-vault-choice.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-scope-row button.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-raw-role-row button.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-vault-file-list button.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-profile-row.is-selected:hover:not(:disabled),
        .create-studio-shell .create-studio-profile-row.is-focused:hover:not(:disabled),
        .create-studio-shell .create-studio-selected-person.is-open:hover:not(:disabled),
        .create-studio-shell .create-studio-template-row.is-selected:hover:not(:disabled),
        .create-studio-shell .create-studio-template-options button.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-tune-grid button.is-active:hover:not(:disabled),
        .create-studio-shell .create-studio-placement-row button.is-active:hover:not(:disabled) {
          border-color: transparent;
          background: color-mix(in oklch, var(--sidebar-depth-selected) 88%, var(--sidebar-depth-raised-hover));
          box-shadow: var(--sidebar-neu-selected);
          color: var(--sidebar-primary-foreground);
        }

        .create-studio-shell .create-studio-output.is-active:hover .create-studio-output-icon,
        .create-studio-shell .create-studio-option.is-on:hover .create-studio-option-icon,
        .create-studio-shell .create-studio-vault-choice.is-active:hover strong,
        .create-studio-shell .create-studio-vault-choice.is-active:hover small {
          color: var(--sidebar-primary-foreground);
        }

        .create-studio-shell .create-studio-prompt-row,
        .create-studio-shell .create-studio-prompt-bucket textarea,
        .create-studio-shell .create-studio-search,
        .create-studio-shell .create-studio-data-text,
        .create-studio-shell .create-studio-review-textarea,
        .create-studio-shell .create-studio-prompt-bucket textarea,
        .create-studio-shell .create-studio-image-meta input,
        .create-studio-shell .create-studio-profile-editor-form input,
        .create-studio-shell .create-studio-profile-editor-form textarea,
        .create-studio-shell .create-studio-profile-draft input,
        .create-studio-shell .create-studio-profile-draft textarea {
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 78%, var(--sidebar-depth-canvas));
          background: var(--sidebar-depth-input);
          box-shadow: var(--sidebar-neu-composer);
        }

        .create-studio-shell .create-studio-prompt-row:focus-within,
        .create-studio-shell .create-studio-prompt-bucket textarea:focus,
        .create-studio-shell .create-studio-review-textarea:focus {
          border-color: color-mix(in oklch, var(--sidebar-button-border-active) 78%, var(--sidebar-border));
          background: var(--sidebar-depth-input);
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--sidebar-button-border-active) 60%, transparent),
            var(--sidebar-neu-composer);
        }

        .create-studio-shell .create-studio-data-side,
        .create-studio-shell .create-studio-client-side,
        .create-studio-shell .create-studio-template-side,
        .create-studio-shell .create-studio-review-section,
        .create-studio-shell .create-studio-data-group,
        .create-studio-shell .create-studio-template-card,
        .create-studio-shell .create-studio-profile-card,
        .create-studio-shell .create-studio-profile-draft,
        .create-studio-shell .create-studio-selected-person,
        .create-studio-shell .create-studio-image-card,
        .create-studio-shell .create-studio-raw-file,
        .create-studio-shell .create-studio-vault-file-list button,
        .create-studio-shell .create-studio-template-row,
        .create-studio-shell .create-studio-profile-row,
        .create-studio-shell .create-studio-tune-grid button {
          border-color: color-mix(in oklch, var(--sidebar-border) 62%, transparent);
          background: color-mix(in oklch, var(--sidebar-depth-input) 46%, transparent);
          box-shadow: var(--sidebar-neu-inset);
        }

        .create-studio-shell .create-studio-data-raw-side,
        .create-studio-shell .create-studio-client-profile-side,
        .create-studio-shell .create-studio-template-carry-side,
        .create-studio-shell .create-studio-raw-source-group,
        .create-studio-shell .create-studio-finished-group {
          border-color: color-mix(in oklch, var(--sidebar-border) 62%, transparent);
          background: color-mix(in oklch, var(--sidebar-depth-input) 46%, transparent);
          box-shadow: var(--sidebar-neu-inset);
        }

        .create-studio-shell .create-studio-vault-tabs {
          background: var(--sidebar-depth-input);
          box-shadow: var(--sidebar-neu-composer);
        }

        .create-studio-shell .create-studio-data-card-label,
        .create-studio-shell .create-studio-review-section-head span,
        .create-studio-shell .create-studio-tune-selected button,
        .create-studio-shell .create-studio-tune-selected span,
        .create-studio-shell .create-studio-review-flow article > span,
        .create-studio-shell .create-studio-profile-tags span {
          background: var(--sidebar-depth-raised);
          box-shadow: var(--sidebar-neu-raised);
          color: var(--sidebar-foreground);
        }

        .create-studio-shell {
          background: var(--sidebar-depth-canvas);
        }

        .create-studio-sheet,
        .create-studio-image-module,
        .create-studio-data-module,
        .create-studio-client-module,
        .create-studio-template-module,
        .create-studio-review-module {
          background: var(--sidebar-depth-raised);
          box-shadow: none;
        }

        .create-studio-panel,
        .create-studio-output-zone,
        .create-studio-prompt-zone,
        .create-studio-image-foot,
        .create-studio-submodule-head,
        .create-studio-tune-head,
        .create-studio-tune-foot {
          background: var(--sidebar-depth-raised);
          backdrop-filter: none;
          box-shadow: none;
        }

        .create-studio-context-card,
        .create-studio-image-card,
        .create-studio-data-group,
        .create-studio-template-card,
        .create-studio-prompt-bucket textarea,
        .create-studio-review-editor,
        .create-studio-review-textarea,
        .create-studio-finished-group {
          background: color-mix(in oklch, var(--sidebar-depth-input) 46%, transparent);
        }

        @media (max-width: 760px) {
          .create-studio-shell {
            align-items: stretch;
            overflow: hidden;
            padding: 0;
          }

          .create-studio-sheet {
            min-height: 100dvh;
            height: 100dvh;
            max-height: 100dvh;
            width: 100%;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
          }

          .create-studio-sheet.is-submodule-mode,
          .create-studio-sheet.is-data-mode,
          .create-studio-sheet.is-client-mode,
          .create-studio-sheet.is-template-mode,
          .create-studio-sheet.is-review-mode {
            display: block;
            height: 100dvh;
            width: 100%;
            max-height: 100dvh;
            overflow-x: hidden;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
          }

          .create-studio-sheet.is-submodule-mode > .create-studio-image-module,
          .create-studio-sheet.is-submodule-mode > .create-studio-data-module,
          .create-studio-sheet.is-submodule-mode > .create-studio-client-module,
          .create-studio-sheet.is-submodule-mode > .create-studio-template-module,
          .create-studio-sheet.is-submodule-mode > .create-studio-review-module {
            min-height: 100%;
            overflow: visible;
          }

          .create-studio-image-body,
          .create-studio-data-body,
          .create-studio-client-body,
          .create-studio-template-body,
          .create-studio-review-body {
            min-height: auto;
            overflow: visible;
          }

          .create-studio-image-body {
            grid-template-columns: 1fr;
          }

          .create-studio-agent-orb {
            margin-top: max(0.8rem, calc(env(safe-area-inset-top, 0px) + 0.8rem));
          }

          .create-studio-prompt-zone {
            padding: 0.8rem;
          }

          .create-studio-prompt-buckets {
            grid-template-columns: 1fr;
            gap: 0.5rem;
          }

          .create-studio-prompt-bucket textarea {
            min-height: 3.7rem;
          }

          .create-studio-option-grid {
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 0.32rem;
            margin-top: 0.55rem;
          }

          .create-studio-option {
            height: 2.25rem;
            gap: 0.35rem;
            padding: 0 0.45rem;
          }

          .create-studio-context-board {
            grid-template-columns: 1fr;
          }

          .create-studio-context-card {
            min-height: auto;
          }

          .create-studio-context-image-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .create-studio-context-image {
            grid-template-columns: 3rem minmax(0, 1fr);
          }

          .create-studio-context-image img {
            width: 3rem;
            height: 3rem;
          }

          .create-studio-output-zone {
            align-items: flex-start;
            flex-direction: column;
            gap: 0.35rem;
            overflow: visible;
            padding: 0.42rem 0.55rem;
          }

          .create-studio-output-label {
            display: block;
          }

          .create-studio-output-list {
            width: 100%;
            flex-wrap: wrap;
            overflow: visible;
            padding-bottom: 0;
            scrollbar-width: auto;
          }

          .create-studio-output-list::-webkit-scrollbar {
            display: initial;
          }

          .create-studio-output {
            max-width: 100%;
            min-height: 1.62rem;
            padding: 0.16rem 0.46rem;
          }

          .create-studio-tune-bar {
            align-items: stretch;
            flex-direction: column;
            padding: 0.65rem 0.75rem;
          }

          .create-studio-tune-selected {
            flex: 0 0 auto;
          }

          .create-studio-tune-reset {
            align-self: flex-start;
            margin-left: 0;
          }

          .create-studio-tune-overlay {
            align-items: flex-end;
            padding: 0;
          }

          .create-studio-tune-panel {
            width: 100%;
            max-height: min(78dvh, 42rem);
            border-right: 0;
            border-bottom: 0;
            border-left: 0;
            border-radius: var(--radius) var(--radius) 0 0;
          }

          .create-studio-tune-grid {
            grid-template-columns: 1fr;
          }

          .create-studio-create {
            align-self: flex-end;
            width: auto;
          }

          .create-studio-data-body {
            grid-template-columns: 1fr;
            min-height: auto;
          }

          .create-studio-client-body {
            grid-template-columns: 1fr;
            min-height: auto;
          }

          .create-studio-selected-people,
          .create-studio-profile-use-options {
            grid-template-columns: 1fr;
          }

          .create-studio-profile-editor-body {
            grid-template-columns: 1fr;
          }

          .create-studio-profile-editor-modal {
            max-height: calc(100dvh - 1.5rem);
            overflow-y: auto;
          }

          .create-studio-template-body {
            grid-template-columns: 1fr;
            min-height: auto;
          }

          .create-studio-review-body {
            grid-template-columns: 1fr;
            min-height: auto;
          }

          .create-studio-data-side,
          .create-studio-client-side,
          .create-studio-template-side,
          .create-studio-review-main,
          .create-studio-review-side {
            overflow: visible;
            flex: 0 0 auto;
          }

          .create-studio-raw-card-stack,
          .create-studio-vault-picker,
          .create-studio-vault-files,
          .create-studio-vault-file-list {
            overflow: visible;
          }

          .create-studio-data-group-head {
            align-items: stretch;
          }

          .create-studio-image-card {
            grid-template-columns: 3.4rem minmax(0, 1fr) 1.75rem;
            gap: 0.45rem;
          }

          .create-studio-image-card img {
            width: 3.4rem;
            height: 3.4rem;
          }
        }

        @media (max-width: 480px) {
          .create-studio-heading h2 {
            font-size: 1rem;
          }

          .create-studio-mode-panel {
            grid-template-columns: 1fr;
            padding: 0.85rem;
          }

          .create-studio-mode-card {
            min-height: 5.4rem;
          }

          .create-studio-output {
            font-size: 0.66rem;
          }

          .create-studio-output-detail {
            padding: 0.68rem;
          }

          .create-studio-document-format {
            grid-template-columns: 1fr;
          }

          .create-studio-option {
            height: 2.62rem;
            flex-direction: column;
            justify-content: center;
            gap: 0.14rem;
            padding: 0.22rem 0.18rem;
            text-align: center;
          }

          .create-studio-option-icon {
            width: 0.92rem;
            height: 0.92rem;
          }

          .create-studio-option span {
            width: 100%;
            flex: 0 1 auto;
          }

          .create-studio-option strong {
            font-size: 0.64rem;
            line-height: 1;
          }

          .create-studio-option small {
            display: none;
          }

          .create-studio-output-choice-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .create-studio-route-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .create-studio-image-body {
            grid-template-columns: 1fr;
            gap: 0.75rem;
          }

          .create-studio-image-card {
            grid-template-columns: 3rem minmax(0, 1fr) 1.75rem;
          }

          .create-studio-template-options {
            grid-template-columns: 1fr;
          }

          .create-studio-review-grid {
            grid-template-columns: 1fr;
          }

          .create-studio-review-actions {
            width: 100%;
          }

          .create-studio-review-actions > button {
            flex: 1;
          }

          .create-studio-selected-person {
            grid-template-columns: 1fr;
          }

          .create-studio-selected-person-actions {
            flex-direction: row;
          }

          .create-studio-profile-draft-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
