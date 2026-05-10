import { imageIdToPath } from "@/lib/images";
import { getChatModel, getHermesBaseUrl, getHermesToken } from "@/lib/hermes-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PaletteColor = {
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
  colors: PaletteColor[];
  source: "vision" | "palette-fallback";
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanColors(value: unknown): PaletteColor[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const hex = cleanString(o.hex);
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
      return {
        hex: hex.toLowerCase(),
        ...(cleanString(o.name) ? { name: cleanString(o.name) } : {}),
        ...(cleanString(o.role) ? { role: cleanString(o.role) } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 8) as PaletteColor[];
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const direct = tryParseObject(trimmed);
  if (direct) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = tryParseObject(fenced.trim());
    if (parsed) return parsed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParseObject(trimmed.slice(start, end + 1));
  return null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function fallbackAnalysis(colors: PaletteColor[]): ThemeImageAnalysis {
  const names = colors
    .map((color) => `${color.name ?? ""} ${color.hex}`.trim())
    .filter(Boolean);
  const paletteWords = colors
    .map((color) => `${color.name ?? ""} ${color.role ?? ""}`.toLowerCase())
    .join(" ");
  const warm = /\b(orange|yellow|amber|ochre|red|burgundy|magenta)\b/.test(
    paletteWords
  );
  const cool = /\b(blue|navy|cyan|teal|green|purple|violet)\b/.test(paletteWords);
  const dark = /\b(black|charcoal|navy|deep|forest|burgundy)\b/.test(paletteWords);
  const light = /\b(white|cream|yellow|grey)\b/.test(paletteWords);
  const mood = [
    dark ? "dark/grounded" : light ? "light/open" : "",
    warm ? "warm/energetic" : cool ? "cool/technical" : "",
    warm && dark ? "gritty editorial" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const brandFeel = warm && dark
    ? "raw, bold, high-contrast, less corporate"
    : cool && dark
      ? "technical, premium, controlled"
      : light
        ? "clean, approachable, open"
        : "use the reference as a style anchor";
  const contrast =
    dark && light
      ? "strong dark/light contrast"
      : dark
        ? "low-key dark contrast"
        : "moderate contrast";
  const palette = colors
    .map((color) => [color.name, color.hex].filter(Boolean).join(" "))
    .join(", ");
  return {
    source: "palette-fallback",
    colors,
    summary: palette
      ? `Use the reference palette as the main visual cue: ${palette}.`
      : "Use the reference image as a style cue where useful.",
    mood,
    palette: palette || "",
    brandFeel,
    typography: dark
      ? "bold headings with restrained mono or sharp sans accents"
      : "clear sans headings with simple readable body type",
    layout: "use strong hierarchy, clear sections, and enough negative space to keep it readable",
    texture: warm && dark ? "controlled grit, worn edges, or subtle paper/noise texture" : "subtle texture only",
    contrast,
    composition:
      names.length > 0
        ? "let the dominant colors carry the background/surface and reserve accents for key moments"
        : "",
  };
}

function normalizeAnalysis(
  raw: Record<string, unknown>,
  fallbackColors: PaletteColor[]
): ThemeImageAnalysis {
  const colors = cleanColors(raw.colors);
  const mergedColors = colors.length > 0 ? colors : fallbackColors;
  const fallback = fallbackAnalysis(mergedColors);
  return {
    source: "vision",
    colors: mergedColors,
    summary: cleanString(raw.summary) || fallback.summary,
    mood: cleanString(raw.mood),
    palette: cleanString(raw.palette) || fallback.palette,
    brandFeel: cleanString(raw.brandFeel),
    typography: cleanString(raw.typography),
    layout: cleanString(raw.layout),
    texture: cleanString(raw.texture),
    contrast: cleanString(raw.contrast),
    composition: cleanString(raw.composition),
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    imageId?: unknown;
    colors?: unknown;
  } | null;
  const imageId = cleanString(body?.imageId);
  if (!imageId || imageId.includes("/") || imageId.includes("\\") || imageId.includes("..")) {
    return Response.json({ error: "Invalid image id" }, { status: 400 });
  }

  const fallbackColors = cleanColors(body?.colors);
  const fallback = fallbackAnalysis(fallbackColors);
  const base = getHermesBaseUrl();
  const token = getHermesToken();
  if (!base || !token) {
    return Response.json({ analysis: fallback });
  }

  const imagePath = imageIdToPath(imageId);
  const paletteHint = fallbackColors.length
    ? fallbackColors
        .map((color) => `${color.name || "color"} ${color.hex}${color.role ? ` (${color.role})` : ""}`)
        .join(", ")
    : "none";

  const prompt = [
    `[media attached: ${imagePath}]`,
    "",
    "Extract reusable style guidance from this theme/reference image for a Create workflow.",
    "Return strict JSON only. Do not create files. Do not design the final artifact.",
    "Use the attached image if vision is available. Use the palette hint only as a fallback/check.",
    "",
    `Palette hint from local sampling: ${paletteHint}`,
    "",
    "JSON shape:",
    '{"summary":"","mood":"","palette":"","brandFeel":"","typography":"","layout":"","texture":"","contrast":"","composition":"","colors":[{"hex":"#000000","name":"","role":""}]}',
    "",
    "Keep every field short, concrete, and usable inside a prompt. Mention exact color families when visible.",
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getChatModel(),
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a visual style extractor for HermesChat Create. Return only compact JSON that can be injected into a design brief.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return Response.json({ analysis: fallback });
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJsonObject(content);
    if (!parsed) return Response.json({ analysis: fallback });
    return Response.json({ analysis: normalizeAnalysis(parsed, fallbackColors) });
  } catch (e) {
    console.error("[create-assets/theme-analysis] failed:", e);
    return Response.json({ analysis: fallback });
  }
}
