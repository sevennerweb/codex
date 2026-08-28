import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig, SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const authConfig = getAuthConfig();
  const account = authConfig
    ? await verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value, authConfig)
    : null;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!authConfig) {
    if (pathname.startsWith("/api/")) return jsonError("로그인 설정이 완료되지 않았습니다.", 503);
    return NextResponse.redirect(new URL("/login?config=missing", request.url));
  }

  if (!account) {
    if (pathname.startsWith("/api/")) return jsonError("로그인이 필요합니다.", 401);
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
