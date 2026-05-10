"use client"

import { memo, type ComponentProps } from "react"
import { Streamdown, type Components } from "streamdown"

import { MarkdownImageWithActions } from "@/components/ui/markdown-image"
import { MarkdownVaultFileLink } from "@/components/ui/markdown-vault-file-link"
import { MarkdownVaultPathCode } from "@/components/ui/markdown-vault-path-code"
import { rehypeVaultInlineCode } from "@/lib/rehype-vault-inline-code"
import { cn } from "@/lib/utils"

type ResponseProps = ComponentProps<typeof Streamdown>

export const Response = memo(
  ({
    className,
    components,
    rehypePlugins,
    ...props
  }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      components={
        {
          ...components,
          a: MarkdownVaultFileLink,
          code: MarkdownVaultPathCode,
          inlineCode: MarkdownVaultPathCode,
          img: MarkdownImageWithActions,
        } as Components
      }
      rehypePlugins={[rehypeVaultInlineCode, ...(rehypePlugins ?? [])]}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

Response.displayName = "Response"
