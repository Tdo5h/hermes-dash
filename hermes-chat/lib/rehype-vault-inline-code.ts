import type { Element, Root, Text } from "hast";
import { visit } from "unist-util-visit";

/**
 * Turn bare `projects/<slug>/...` path strings in paragraph text into `<code>` nodes so
 * `MarkdownVaultPathCode` can attach download/preview (models often omit backticks and write
 * "open projects/... " as plain text).
 */
export function rehypeVaultInlineCode() {
  return (tree: Root) => {
    const replacements: {
      parent: Element;
      index: number;
      parts: (Text | Element)[];
    }[] = [];

    visit(tree, "text", (node, index, parent) => {
      if (!parent || parent.type !== "element") return;
      const p = parent as Element;
      if (
        p.tagName === "code" ||
        p.tagName === "pre" ||
        p.tagName === "script" ||
        p.tagName === "style"
      ) {
        return;
      }

      const t = node as Text;
      const value = t.value;
      if (!value?.includes("projects/")) return;

      const re =
        /\bprojects\/[a-zA-Z0-9._-]+\/(?:sources\/)?[a-zA-Z0-9._-]+/g;
      const matches = [...value.matchAll(re)];
      if (matches.length === 0) return;

      const parts: (Text | Element)[] = [];
      let cursor = 0;
      for (const m of matches) {
        const start = m.index ?? 0;
        if (start > cursor) {
          parts.push({ type: "text", value: value.slice(cursor, start) });
        }
        parts.push({
          type: "element",
          tagName: "code",
          properties: {},
          children: [{ type: "text", value: m[0] }],
        });
        cursor = start + m[0].length;
      }
      if (cursor < value.length) {
        parts.push({ type: "text", value: value.slice(cursor) });
      }

      if (parts.length === 1) return;
      replacements.push({
        parent: p,
        index: index as number,
        parts,
      });
    });

    replacements.sort((a, b) => {
      if (a.parent !== b.parent) return 0;
      return (b.index as number) - (a.index as number);
    });

    for (const { parent, index, parts } of replacements) {
      parent.children.splice(index, 1, ...parts);
    }
  };
}
