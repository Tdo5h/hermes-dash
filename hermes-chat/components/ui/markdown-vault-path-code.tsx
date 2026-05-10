"use client";

import {
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/** Text content from React children (Streamdown may wrap inline code in elements). */
function textFromChildren(children: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  if (isValidElement(children)) {
    const ch = (children.props as { children?: ReactNode })?.children;
    return textFromChildren(ch ?? "");
  }
  return "";
}

/** When React children are empty (tokenized output), read text from hast node. */
function textFromHastNode(node: unknown): string {
  if (node == null || typeof node !== "object") return "";
  const n = node as {
    type?: string;
    value?: unknown;
    children?: unknown[];
  };
  if (n.type === "text" && typeof n.value === "string") return n.value;
  if (Array.isArray(n.children)) {
    return n.children.map(textFromHastNode).join("");
  }
  return "";
}

/**
 * Normalize text for vault path detection. Strip ZWSP, optional leading `file:` / `path:` /
 * `open ` (models often write `open projects/...`; removing all spaces *before* that would glue
 * to `openprojects/...` and break the `projects/` regex). Then collapse remaining whitespace.
 */
function normalizePathText(s: string): string {
  let t = s.replace(/\u200b/g, "").trim();
  t = t.replace(/^(?:file|path)\s*:\s*/i, "");
  t = t.replace(/^\s*open\s+/i, "");
  return t.replace(/\s+/g, "").trim();
}

/** Visible path for inline code — WYSIWYG, only trim ZWSP and leading path/file affordances. */
function displayPathInline(raw: string): string {
  let t = raw.replace(/\u200b/g, "").trim();
  t = t.replace(/^(?:file|path)\s*:\s*/i, "");
  t = t.replace(/^\s*open\s+/i, "");
  return t;
}

/** Visible path for shell-like fenced path-only block (non-comment lines, preserve newlines). */
function displayPathForShellFence(raw: string): string {
  const lines = raw.replace(/\u200b/g, "").split(/\r?\n/);
  const kept = lines.filter((line) => {
    const t = line.trim();
    return t.length > 0 && !/^\s*#/.test(line);
  });
  return kept.join("\n").trim();
}

/** Flat projects path or /vault-shared/... ; file resolves under sources/ via basename only. */
const RE_PROJECTS = /^projects\/([a-zA-Z0-9._-]+)\/(?:sources\/)?([^/\s]+)$/;
const RE_VAULT_SHARED =
  /^\/vault-shared\/([a-zA-Z0-9._-]+)\/(?:sources\/)?([^/\s]+)$/;

function parseVaultInlinePath(
  text: string
): { slug: string; basename: string } | null {
  const t = text.trim();
  let m = t.match(RE_PROJECTS);
  if (m?.[1] && m?.[2]) {
    return { slug: m[1], basename: m[2] };
  }
  m = t.match(RE_VAULT_SHARED);
  if (m?.[1] && m?.[2]) {
    return { slug: m[1], basename: m[2] };
  }
  return null;
}

function isSafeVaultBasename(b: string): boolean {
  if (!b || b === "." || b === "..") return false;
  if (b.startsWith(".")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(b);
}

function isFencedCodeBlock(className: string | undefined): boolean {
  if (!className?.trim()) return false;
  return /\blanguage-[\w-]+\b/.test(className);
}

/** Fenced blocks with these languages may be a single `open projects/…` hint (not real scripts). */
function isShellLikeFenceLanguage(className: string | undefined): boolean {
  if (!className?.trim()) return false;
  return /\blanguage-(?:bash|sh|shell|zsh|text)\b/i.test(className);
}

/**
 * After stripping full-line # comments and blank lines, detect exactly one vault path
 * (same rules as inline code) for shell-like fenced blocks.
 */
function normalizedVaultPathFromShellLikeFence(raw: string): string | null {
  const lines = raw.replace(/\u200b/g, "").split(/\r?\n/);
  const kept = lines.filter((line) => {
    const t = line.trim();
    return t.length > 0 && !/^\s*#/.test(line);
  });
  if (kept.length === 0) return null;

  const merged = kept.join("\n");
  const pathLike =
    /\bprojects\/[a-zA-Z0-9._-]+\/(?:sources\/)?[a-zA-Z0-9._-]+/g;
  const hits = merged.match(pathLike);
  if (hits && hits.length > 1) return null;

  const normalized = normalizePathText(merged);
  const parsed = parseVaultInlinePath(normalized);
  return parsed && isSafeVaultBasename(parsed.basename) ? normalized : null;
}

export type MarkdownVaultPathCodeProps = ComponentPropsWithoutRef<"code"> & {
  /** Hast/rehype node when available (fallback for empty React text extraction). */
  node?: unknown;
};

/**
 * Inline `code` that looks like a vault path: render it as **muted, non-clickable** text so it
 * does not duplicate [MarkdownVaultFileLink](markdown-vault-file-link.tsx) Download/Preview
 * when the same message also has a `/api/projects/.../file` link. Fenced code blocks with a
 * `language-*` class pass through as normal `code`, except **shell-like** fences whose body is
 * only a single vault path — same muted display, optionally multiline.
 */
export function MarkdownVaultPathCode({
  className,
  children,
  node,
  ...rest
}: MarkdownVaultPathCodeProps) {
  const raw =
    textFromChildren(children) || textFromHastNode(node);

  let parsed: { slug: string; basename: string } | null = null;
  let pathSource: "fence" | "inline" | null = null;

  if (isFencedCodeBlock(className)) {
    if (isShellLikeFenceLanguage(className)) {
      const normalized = normalizedVaultPathFromShellLikeFence(raw);
      if (normalized) {
        const p = parseVaultInlinePath(normalized);
        if (p && isSafeVaultBasename(p.basename)) {
          parsed = p;
          pathSource = "fence";
        }
      }
    }
  } else {
    const text = normalizePathText(raw);
    const p = parseVaultInlinePath(text);
    if (p && isSafeVaultBasename(p.basename)) {
      parsed = p;
      pathSource = "inline";
    }
  }

  if (!parsed) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  const displayText =
    pathSource === "fence" ? displayPathForShellFence(raw) : displayPathInline(raw);
  const text = displayText || raw.replace(/\u200b/g, "").trim();

  return (
    <span
      className={cn(
        "min-w-0 max-w-full font-mono text-xs text-muted-foreground [overflow-wrap:anywhere] align-middle",
        pathSource === "fence" && "whitespace-pre-wrap",
        className
      )}
    >
      {text}
    </span>
  );
}
