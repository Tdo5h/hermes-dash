"use client"

import type { ComponentProps } from "react"
import { useCallback, useRef } from "react"
import { ArrowDownIcon } from "lucide-react"
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type ConversationProps = ComponentProps<typeof StickToBottom>

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-auto", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
)

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content className={cn("p-4", className)} {...props} />
)

export type ConversationEmptyStateProps = Omit<
  ComponentProps<"div">,
  "title"
> & {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
}

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
)

export type ConversationScrollButtonProps = ComponentProps<typeof Button>

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { contentRef, isAtBottom, scrollRef, scrollToBottom } =
    useStickToBottomContext()
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressedRef = useRef(false)

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom()
  }, [scrollToBottom])

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handlePressStart = useCallback(() => {
    longPressedRef.current = false
    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      longPressedRef.current = true
      handleScrollToBottom()
    }, 450)
  }, [clearLongPressTimer, handleScrollToBottom])

  const handlePressEnd = useCallback(() => {
    clearLongPressTimer()
  }, [clearLongPressTimer])

  const handleScrollNext = useCallback(() => {
    if (longPressedRef.current) {
      longPressedRef.current = false
      return
    }

    const scrollEl = scrollRef.current
    const contentEl = contentRef.current
    if (!scrollEl || !contentEl) {
      handleScrollToBottom()
      return
    }

    const anchors = Array.from(
      contentEl.querySelectorAll<HTMLElement>("[data-chat-turn-anchor='user']")
    )
    const next = anchors.find((anchor) => anchor.offsetTop > scrollEl.scrollTop + 24)

    if (!next) {
      handleScrollToBottom()
      return
    }

    scrollEl.scrollTo({
      top: Math.max(0, next.offsetTop - 10),
      behavior: "smooth",
    })
  }, [contentRef, handleScrollToBottom, scrollRef])

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] z-10 size-16 translate-x-[-50%] rounded-full border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-sidebar-primary active:bg-transparent max-md:bottom-[calc(4.85rem+env(safe-area-inset-bottom,0px)+var(--hermes-visual-bottom-inset,0px))]",
          className
        )}
        onClick={handleScrollNext}
        onPointerCancel={handlePressEnd}
        onPointerDown={handlePressStart}
        onPointerLeave={handlePressEnd}
        onPointerUp={handlePressEnd}
        size="icon"
        type="button"
        variant="ghost"
        aria-label="Jump to next message"
        {...props}
      >
        <span className="neu-raised flex size-11 items-center justify-center rounded-full border border-sidebar-border/30 bg-background/55 shadow-none backdrop-blur-md transition-colors">
          <ArrowDownIcon className="size-4.5" />
        </span>
      </Button>
    )
  )
}
