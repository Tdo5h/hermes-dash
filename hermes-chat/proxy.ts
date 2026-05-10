import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const API_NO_STORE =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

function isImmutableApiAsset(pathname: string): boolean {
  return /^\/api\/images\/[^/]+$/i.test(pathname);
}

/**
 * Avoid long-lived HTTP caching of HTML document shells; immutable assets stay under `/_next/static`.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    const res = NextResponse.next();
    if (request.method === "GET" && isImmutableApiAsset(pathname)) {
      res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return res;
    }
    res.headers.set("Cache-Control", API_NO_STORE);
    res.headers.set("CDN-Cache-Control", "no-store");
    res.headers.set("Vercel-CDN-Cache-Control", "no-store");
    res.headers.set("Surrogate-Control", "no-store");
    return res;
  }
  if (pathname === "/sw.js") return NextResponse.next();
  if (pathname === "/manifest.webmanifest") return NextResponse.next();
  if (pathname === "/favicon.ico") return NextResponse.next();
  if (
    /\.(?:ico|png|svg|jpg|jpeg|gif|webp|woff2?|ttf|eot|json|js|css|map|txt|webmanifest)$/i.test(
      pathname
    )
  ) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  res.headers.set("Cache-Control", "private, no-cache, must-revalidate");
  return res;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/|api/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|woff2?|ttf|eot|json|js|css|map|txt|webmanifest)$).*)",
    "/",
  ],
};
