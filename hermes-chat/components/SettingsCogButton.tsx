"use client";

import { SettingsIcon } from "lucide-react";
import { useSettings } from "@/app/chat/layout";

export function SettingsCogButton({
  className = "",
}: {
  className?: string;
}) {
  const { openSettings } = useSettings();
  return (
    <button
      type="button"
      onClick={openSettings}
      className={`neu-raised rounded-lg p-2 text-muted-foreground transition-colors hover:text-sidebar-primary ${className}`}
      aria-label="Open settings"
      data-hermes-tip="Open settings for theme, notifications, models, voice, and tips."
    >
      <SettingsIcon className="size-5" />
    </button>
  );
}
