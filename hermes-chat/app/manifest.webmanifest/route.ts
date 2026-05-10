import type { MetadataRoute } from "next";

const manifest: MetadataRoute.Manifest = {
  name: "Hermes chat",
  short_name: "Hermes space chat",
  description: "AI Chat powered by Hermes",
  start_url: "/chat",
  display: "standalone",
  background_color: "#0d1015",
  theme_color: "#0d1015",
  orientation: "portrait",
  icons: [
    {
      src: "/icon-192x192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/icon-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icon-192x192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/icon-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "monochrome",
    },
  ],
};

export function GET() {
  return Response.json(manifest, {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
