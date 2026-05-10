/** Shared dynamic import so chat layout can warm the module before first speak. */
let deepgramSdkModulePromise: Promise<typeof import("@deepgram/sdk")> | null =
  null;

export function warmDeepgramSdk(): Promise<typeof import("@deepgram/sdk")> {
  if (!deepgramSdkModulePromise) {
    deepgramSdkModulePromise = import("@deepgram/sdk");
  }
  return deepgramSdkModulePromise;
}
