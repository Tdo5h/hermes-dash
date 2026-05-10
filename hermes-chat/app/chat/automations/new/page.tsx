import { Suspense } from "react";
import { GuidedHermesSetupPage } from "@/components/GuidedHermesSetupPage";

export default function NewAutomationPage() {
  return (
    <Suspense fallback={null}>
      <GuidedHermesSetupPage mode="automation" />
    </Suspense>
  );
}
