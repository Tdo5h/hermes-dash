import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import Script from "next/script";
import { BuildVersionSync } from "@/components/BuildVersionSync";
import { UnregisterSerwistIfDisabled } from "@/components/UnregisterSerwistIfDisabled";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "http://localhost:3100";

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}/`),
  title: "Hermes chat",
  description: "AI Chat powered by Hermes",
  icons: {
    icon: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    /** iOS home screen + Safari; same asset as icon-192x192 (192×192 PNG). */
    apple: [
      { url: "/apple-touch-icon.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: ["/icon-192x192.png"],
  },
  openGraph: {
    title: "Hermes chat",
    description: "AI Chat powered by Hermes",
    images: [
      {
        url: "/icon-512x512.png",
        width: 512,
        height: 512,
        alt: "Hermes space chat",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hermes space chat",
    description: "AI Chat powered by Hermes",
    images: ["/icon-512x512.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Hermes space chat",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1015",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  /**
   * Helps Chrome/Android PWAs resize the layout viewport when the IME opens so fixed footers
   * track `visualViewport`; pairs with `--hermes-visual-bottom-inset` sync in this layout.
   * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag
   */
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appBuildId = process.env.NEXT_PUBLIC_APP_BUILD_ID ?? "";
  const themeBootScript = `(function(){try{var mode=localStorage.getItem("oc-theme")||"dark";var dark=mode==="dark";if(mode==="auto"){var h=(new Date()).getHours();dark=h<6||h>=18}document.documentElement.classList.toggle("dark",dark);var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",dark?"#0d1015":"#e1e4ea")}catch(e){document.documentElement.classList.add("dark")}})();`;
  const devSerwistCleanupScript = `(function(){var changed=false;var tasks=[];if("serviceWorker"in navigator){tasks.push(navigator.serviceWorker.getRegistrations().then(function(r){if(r.length)changed=true;return Promise.all(r.map(function(x){return x.unregister()}))}))}if("caches"in window){tasks.push(caches.keys().then(function(keys){if(keys.length)changed=true;return Promise.all(keys.map(function(k){return caches.delete(k)}))}))}Promise.all(tasks).then(function(){if(changed)location.reload()})})();`;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${roboto.variable} h-dvh max-h-dvh overflow-hidden bg-[var(--sidebar-depth-canvas)]`}
    >
      <head>
        <Script
          id="hermes-theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: themeBootScript,
          }}
        />
        {appBuildId ? (
          <meta name="app-build-id" content={appBuildId} />
        ) : null}
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
        {process.env.NEXT_PUBLIC_DISABLE_SERWIST === "true" ? (
          <Script
            id="hermes-dev-serwist-cleanup"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: devSerwistCleanupScript,
            }}
          />
        ) : null}
      </head>
      <body
        suppressHydrationWarning
        className="flex h-full min-h-0 max-h-full flex-col overflow-hidden bg-[var(--sidebar-depth-canvas)] text-foreground font-[var(--font-roboto),system-ui,sans-serif] antialiased"
      >
        <BuildVersionSync />
        <UnregisterSerwistIfDisabled />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
