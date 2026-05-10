export type CreateProductionAsset = {
  id: string;
  name: string;
  url: string;
  toolPath?: string;
  caption?: string;
  tags?: string[];
  role?: string;
  mimeType?: string;
  size?: number;
  guidance?: string;
};

export type CreateProductionPerson = {
  id: string;
  name: string;
  kind?: string;
  company?: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
  useAs?: string;
  vaultName?: string;
  evidencePaths?: string[];
};

export type CreateProductionVault = {
  slug: string;
  name: string;
  visibility?: "private" | "shared";
  scope: "whole" | "selected";
  selectedFiles?: { name: string; relativePath: string }[];
};

export type CreateProductionTemplate = {
  id: string;
  name: string;
  vaultSlug?: string;
  vaultName?: string;
  outlinePath?: string;
  structurePath?: string;
  carryOver?: string[];
};

export type CreateProductionDesignDnaSystem = {
  id: string;
  name: string;
  slug?: string;
  category?: string;
  description?: string;
  path?: string;
};

export type CreateProductionDesignDna = {
  systems?: CreateProductionDesignDnaSystem[];
  autoSelect?: boolean;
  carryOver?: string[];
  strength?: "light" | "strong" | "blueprint";
  avoidCopying?: string[];
};

export type CreateProductionMode = "standard" | "frontier";

export type CreateProductionBrief = {
  version: 1;
  createdAt: string;
  creationMode?: CreateProductionMode;
  intent: string;
  output: {
    id: string;
    label: string;
    displayName: string;
    documentFormat?: string;
  };
  subtype: {
    id: string;
    label: string;
    routeHint?: string;
  };
  extraRoutes?: { id: string; label: string; routeHint: string }[];
  openDesign?: {
    candidateSkills?: string[];
  };
  user: {
    brief?: string;
    reviewedBrief?: string;
    sourceMaterial?: string;
    exactCopy?: string;
    dataNotes?: string;
    tuneTags?: { id: string; label: string; profile: string }[];
  };
  assets?: {
    themeImages?: CreateProductionAsset[];
    includeImages?: CreateProductionAsset[];
    useImages?: CreateProductionAsset[];
    rawFiles?: CreateProductionAsset[];
  };
  vault?: CreateProductionVault;
  people?: CreateProductionPerson[];
  template?: CreateProductionTemplate;
  designDna?: CreateProductionDesignDna;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function cleanString(v: unknown, max = 100000): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function cleanStringArray(v: unknown, maxItems = 80): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((item) => cleanString(item, 400))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
  return out.length ? out : undefined;
}

function cleanAsset(v: unknown): CreateProductionAsset | null {
  if (!isRecord(v)) return null;
  const id = cleanString(v.id, 200);
  const name = cleanString(v.name, 240);
  const url = cleanString(v.url, 2000);
  if (!id || !name || !url) return null;
  const size = typeof v.size === "number" && Number.isFinite(v.size) ? v.size : undefined;
  return {
    id,
    name,
    url,
    ...(cleanString(v.toolPath, 3000) ? { toolPath: cleanString(v.toolPath, 3000) } : {}),
    ...(cleanString(v.caption, 2000) ? { caption: cleanString(v.caption, 2000) } : {}),
    ...(cleanStringArray(v.tags, 40) ? { tags: cleanStringArray(v.tags, 40) } : {}),
    ...(cleanString(v.role, 120) ? { role: cleanString(v.role, 120) } : {}),
    ...(cleanString(v.mimeType, 200) ? { mimeType: cleanString(v.mimeType, 200) } : {}),
    ...(typeof size === "number" ? { size } : {}),
    ...(cleanString(v.guidance, 5000) ? { guidance: cleanString(v.guidance, 5000) } : {}),
  };
}

function cleanAssets(v: unknown): CreateProductionAsset[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map(cleanAsset)
    .filter((item): item is CreateProductionAsset => Boolean(item))
    .slice(0, 80);
  return out.length ? out : undefined;
}

function cleanPeople(v: unknown): CreateProductionPerson[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = cleanString(item.id, 200);
      const name = cleanString(item.name, 240);
      if (!id || !name) return null;
      return {
        id,
        name,
        ...(cleanString(item.kind, 80) ? { kind: cleanString(item.kind, 80) } : {}),
        ...(cleanString(item.company, 240) ? { company: cleanString(item.company, 240) } : {}),
        ...(cleanString(item.role, 240) ? { role: cleanString(item.role, 240) } : {}),
        ...(cleanString(item.email, 240) ? { email: cleanString(item.email, 240) } : {}),
        ...(cleanString(item.phone, 120) ? { phone: cleanString(item.phone, 120) } : {}),
        ...(cleanString(item.notes, 5000) ? { notes: cleanString(item.notes, 5000) } : {}),
        ...(cleanString(item.useAs, 120) ? { useAs: cleanString(item.useAs, 120) } : {}),
        ...(cleanString(item.vaultName, 240) ? { vaultName: cleanString(item.vaultName, 240) } : {}),
        ...(cleanStringArray(item.evidencePaths, 10)
          ? { evidencePaths: cleanStringArray(item.evidencePaths, 10) }
          : {}),
      };
    })
    .filter((item): item is CreateProductionPerson => Boolean(item))
    .slice(0, 80);
  return out.length ? out : undefined;
}

function cleanDesignDna(v: unknown): CreateProductionDesignDna | undefined {
  if (!isRecord(v)) return undefined;
  const autoSelect = v.autoSelect === true;
  const systems = Array.isArray(v.systems)
    ? v.systems
        .map((item) => {
          if (!isRecord(item)) return null;
          const id = cleanString(item.id, 160);
          const name = cleanString(item.name, 240);
          if (!id || !name) return null;
          return {
            id,
            name,
            ...(cleanString(item.slug, 160) ? { slug: cleanString(item.slug, 160) } : {}),
            ...(cleanString(item.category, 240) ? { category: cleanString(item.category, 240) } : {}),
            ...(cleanString(item.description, 600)
              ? { description: cleanString(item.description, 600) }
              : {}),
            ...(cleanString(item.path, 1000) ? { path: cleanString(item.path, 1000) } : {}),
          };
        })
        .filter((item): item is CreateProductionDesignDnaSystem => Boolean(item))
        .slice(0, 5)
    : [];
  if (!systems.length && !autoSelect) return undefined;
  const strength =
    v.strength === "light" || v.strength === "strong" || v.strength === "blueprint"
      ? v.strength
      : undefined;
  return {
    ...(systems.length ? { systems } : {}),
    ...(autoSelect ? { autoSelect } : {}),
    ...(cleanStringArray(v.carryOver, 24)
      ? { carryOver: cleanStringArray(v.carryOver, 24) }
      : {}),
    ...(strength ? { strength } : {}),
    ...(cleanStringArray(v.avoidCopying, 16)
      ? { avoidCopying: cleanStringArray(v.avoidCopying, 16) }
      : {}),
  };
}

export function parseCreateProductionBrief(raw: unknown): CreateProductionBrief | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.version !== 1) return undefined;
  const output = isRecord(raw.output) ? raw.output : null;
  const subtype = isRecord(raw.subtype) ? raw.subtype : null;
  const user = isRecord(raw.user) ? raw.user : null;
  const creationMode =
    raw.creationMode === "standard" || raw.creationMode === "frontier"
      ? raw.creationMode
      : undefined;
  const intent = cleanString(raw.intent, 120);
  const createdAt = cleanString(raw.createdAt, 120);
  const outputId = cleanString(output?.id, 120);
  const outputLabel = cleanString(output?.label, 160);
  const displayName = cleanString(output?.displayName, 160);
  const subtypeId = cleanString(subtype?.id, 160);
  const subtypeLabel = cleanString(subtype?.label, 160);
  if (!intent || !createdAt || !outputId || !outputLabel || !displayName || !subtypeId || !subtypeLabel || !user) {
    return undefined;
  }

  const extraRoutes = Array.isArray(raw.extraRoutes)
    ? raw.extraRoutes
        .map((item) => {
          if (!isRecord(item)) return null;
          const id = cleanString(item.id, 160);
          const label = cleanString(item.label, 200);
          const routeHint = cleanString(item.routeHint, 2000);
          return id && label && routeHint ? { id, label, routeHint } : null;
        })
        .filter((item): item is { id: string; label: string; routeHint: string } => Boolean(item))
        .slice(0, 12)
    : undefined;

  const assets = isRecord(raw.assets)
    ? {
        ...(cleanAssets(raw.assets.themeImages) ? { themeImages: cleanAssets(raw.assets.themeImages) } : {}),
        ...(cleanAssets(raw.assets.includeImages) ? { includeImages: cleanAssets(raw.assets.includeImages) } : {}),
        ...(cleanAssets(raw.assets.useImages) ? { useImages: cleanAssets(raw.assets.useImages) } : {}),
        ...(cleanAssets(raw.assets.rawFiles) ? { rawFiles: cleanAssets(raw.assets.rawFiles) } : {}),
      }
    : undefined;
  const openDesignRaw = isRecord(raw.openDesign) ? raw.openDesign : null;
  const vaultRaw = isRecord(raw.vault) ? raw.vault : null;
  const templateRaw = isRecord(raw.template) ? raw.template : null;
  const designDna = cleanDesignDna(raw.designDna);

  const vault: CreateProductionVault | undefined =
    vaultRaw && cleanString(vaultRaw.slug, 240) && cleanString(vaultRaw.name, 240)
      ? {
          slug: cleanString(vaultRaw.slug, 240)!,
          name: cleanString(vaultRaw.name, 240)!,
          ...(vaultRaw.visibility === "private" || vaultRaw.visibility === "shared"
            ? { visibility: vaultRaw.visibility }
            : {}),
          scope: vaultRaw.scope === "whole" ? ("whole" as const) : ("selected" as const),
          ...(Array.isArray(vaultRaw.selectedFiles)
            ? {
                selectedFiles: vaultRaw.selectedFiles
                  .map((item) => {
                    if (!isRecord(item)) return null;
                    const name = cleanString(item.name, 240);
                    const relativePath = cleanString(item.relativePath, 1000);
                    return name && relativePath ? { name, relativePath } : null;
                  })
                  .filter((item): item is { name: string; relativePath: string } => Boolean(item))
                  .slice(0, 100),
              }
            : {}),
        }
      : undefined;

  const template =
    templateRaw && cleanString(templateRaw.id, 200) && cleanString(templateRaw.name, 240)
      ? {
          id: cleanString(templateRaw.id, 200)!,
          name: cleanString(templateRaw.name, 240)!,
          ...(cleanString(templateRaw.vaultSlug, 240) ? { vaultSlug: cleanString(templateRaw.vaultSlug, 240) } : {}),
          ...(cleanString(templateRaw.vaultName, 240) ? { vaultName: cleanString(templateRaw.vaultName, 240) } : {}),
          ...(cleanString(templateRaw.outlinePath, 1000) ? { outlinePath: cleanString(templateRaw.outlinePath, 1000) } : {}),
          ...(cleanString(templateRaw.structurePath, 1000)
            ? { structurePath: cleanString(templateRaw.structurePath, 1000) }
            : {}),
          ...(cleanStringArray(templateRaw.carryOver, 16) ? { carryOver: cleanStringArray(templateRaw.carryOver, 16) } : {}),
        }
      : undefined;

  return {
    version: 1,
    createdAt,
    ...(creationMode ? { creationMode } : {}),
    intent,
    output: {
      id: outputId,
      label: outputLabel,
      displayName,
      ...(cleanString(output?.documentFormat, 80) ? { documentFormat: cleanString(output?.documentFormat, 80) } : {}),
    },
    subtype: {
      id: subtypeId,
      label: subtypeLabel,
      ...(cleanString(subtype?.routeHint, 2000) ? { routeHint: cleanString(subtype?.routeHint, 2000) } : {}),
    },
    ...(extraRoutes?.length ? { extraRoutes } : {}),
    ...(openDesignRaw && cleanStringArray(openDesignRaw.candidateSkills, 80)
      ? { openDesign: { candidateSkills: cleanStringArray(openDesignRaw.candidateSkills, 80) } }
      : {}),
    user: {
      ...(cleanString(user.brief) ? { brief: cleanString(user.brief) } : {}),
      ...(cleanString(user.reviewedBrief) ? { reviewedBrief: cleanString(user.reviewedBrief) } : {}),
      ...(cleanString(user.sourceMaterial) ? { sourceMaterial: cleanString(user.sourceMaterial) } : {}),
      ...(cleanString(user.exactCopy) ? { exactCopy: cleanString(user.exactCopy) } : {}),
      ...(cleanString(user.dataNotes) ? { dataNotes: cleanString(user.dataNotes) } : {}),
      ...(Array.isArray(user.tuneTags)
        ? {
            tuneTags: user.tuneTags
              .map((item) => {
                if (!isRecord(item)) return null;
                const id = cleanString(item.id, 120);
                const label = cleanString(item.label, 120);
                const profile = cleanString(item.profile, 1000);
                return id && label && profile ? { id, label, profile } : null;
              })
              .filter((item): item is { id: string; label: string; profile: string } => Boolean(item))
              .slice(0, 24),
          }
        : {}),
    },
    ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
    ...(vault ? { vault } : {}),
    ...(cleanPeople(raw.people) ? { people: cleanPeople(raw.people) } : {}),
    ...(template ? { template } : {}),
    ...(designDna ? { designDna } : {}),
  };
}
