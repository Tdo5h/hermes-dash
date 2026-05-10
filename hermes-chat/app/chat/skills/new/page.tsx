import { Suspense } from "react";
import { GuidedHermesSetupPage } from "@/components/GuidedHermesSetupPage";

export default function NewSkillPage() {
  return (
    <Suspense fallback={null}>
      <GuidedHermesSetupPage mode="skill" />
    </Suspense>
  );
}
