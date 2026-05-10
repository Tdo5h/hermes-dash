import path from "path";
import { getHermesChatDataDir } from "@/lib/hermes-config";

export function getHermesChatSessionsJsonPath(): string {
  return path.join(getHermesChatDataDir(), "sessions.json");
}
