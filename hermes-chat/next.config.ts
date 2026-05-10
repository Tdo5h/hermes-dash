import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: false,
  register: true,
  reloadOnOnline: true,
  /** Dev: off. SSH tunnel / odd ports: set NEXT_PUBLIC_DISABLE_SERWIST=true so precache does not hit the wrong origin (e.g. :80 vs :8080). */
  disable:
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_DISABLE_SERWIST === "true",
});

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  /** Large chat image uploads (base64 JSON) — avoids 413 / truncated bodies on some hosts. */
  experimental: {
    /*
     * Route handlers that parse multipart uploads call req.formData().
     * In Next 16 this body clone limit is separate from Server Actions;
     * keep it aligned with the vault upload route's 80 MB file cap.
     */
    proxyClientMaxBodySize: "85mb",
    /*
     * Next 16 defaults to Turbopack and may merge/reorder CSS chunks.
     * Keep import order strict so the Hermes theme keeps its pre-upgrade cascade.
     */
    cssChunking: "strict",
    serverActions: {
      bodySizeLimit: "35mb",
    },
    turbopackFileSystemCacheForDev: true,
  },
  turbopack: {
    resolveAlias: {
      ws: {
        browser: "./empty.ts",
      },
    },
  },
  // Use || so empty NEXT_PUBLIC_APP_BUILD_ID from Docker ARG does not win over ?? and yield "" (breaks standalone BUILD_ID).
  generateBuildId: async () =>
    process.env.NEXT_PUBLIC_APP_BUILD_ID ||
    process.env.NEXT_BUILD_ID ||
    `hermeschat-${Date.now()}`,
};

export default withSerwist(nextConfig);
