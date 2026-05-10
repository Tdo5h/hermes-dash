import { redirect } from "next/navigation";

import { getHermesSetupStatus } from "@/lib/setup-status";

export const dynamic = "force-dynamic";

export default async function Home() {
  const status = await getHermesSetupStatus();
  redirect(status.ready ? "/chat" : "/setup");
}
