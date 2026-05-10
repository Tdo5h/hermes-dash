"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-[var(--sidebar-button-border)] shadow-[var(--sidebar-neu-inset)] transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-[var(--sidebar-button-border-hover)] focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-transparent data-checked:bg-[var(--sidebar-depth-selected)] data-checked:shadow-[var(--sidebar-neu-selected)] data-unchecked:bg-[var(--sidebar-depth-input)] data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-[var(--sidebar-depth-raised-hover)] shadow-[var(--sidebar-neu-raised)] ring-0 transition-transform group-data-[size=default]/switch:h-[calc(100%-4px)] group-data-[size=default]/switch:w-[calc(50%-3px)] group-data-[size=sm]/switch:h-[calc(100%-4px)] group-data-[size=sm]/switch:w-[calc(50%-3px)] group-data-[size=default]/switch:data-checked:translate-x-[calc(100%+2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%+2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0.5 group-data-[size=sm]/switch:data-unchecked:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
