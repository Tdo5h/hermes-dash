/** Runs once on Node server startup — ensures `.env.local` is merged when running in Docker standalone. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadEnvLocalIntoProcess } = await import("./lib/load-env-local");
    loadEnvLocalIntoProcess();
  }
}
