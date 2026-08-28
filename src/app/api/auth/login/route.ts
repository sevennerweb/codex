import { NextRequest, NextResponse } from "next/server";
import { getAccountByUsername, verifyPassword } from "@/lib/auth-server";
import { createSessionToken, getAuthConfig, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-session";
import { getUserCredential } from "@/lib/user-store";

type LoginAttempt = { failures: number; blockedUntil: number };

const attemptsGlobal = globalThis as typeof globalThis & { travelLoginAttempts?: Map<string, LoginAttempt> };
const loginAttempts = attemptsGlobal.travelLoginAttempts ?? new Map<string, LoginAttempt>();
if (process.env.NODE_ENV !== "production") attemptsGlobal.travelLoginAttempts = loginAttempts;

function clientKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function blockedResponse(seconds: number) {
  return NextResponse.json(
    { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(seconds) } },
  );
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4_096) return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });

  const key = clientKey(request);
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (attempt?.blockedUntil && attempt.blockedUntil > now) return blockedResponse(Math.ceil((attempt.blockedUntil - now) / 1_000));

  const authConfig = getAuthConfig();
  if (!authConfig) {
    return NextResponse.json({ error: "로그인 설정이 완료되지 않았습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "로그인 정보를 확인해 주세요." }, { status: 400 });
  }

  const username = typeof body === "object" && body && "username" in body && typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body === "object" && body && "password" in body && typeof body.password === "string" ? body.password : "";
  const account = getAccountByUsername(username);
  const fallbackCredential = getUserCredential("admin");
  const credential = account ? getUserCredential(account.id) : fallbackCredential;
  if (!fallbackCredential) {
    return NextResponse.json({ error: "로그인 계정이 준비되지 않았습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const validPassword = await verifyPassword(password, credential?.passwordHash ?? fallbackCredential.passwordHash);
  const valid = Boolean(account && credential && validPassword);

  if (!valid) {
    const failures = (attempt?.failures ?? 0) + 1;
    const blockedUntil = failures >= 5 ? now + 15 * 60 * 1_000 : 0;
    loginAttempts.set(key, { failures: blockedUntil ? 0 : failures, blockedUntil });
    if (blockedUntil) return blockedResponse(15 * 60);
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  loginAttempts.delete(key);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken({ ...account!, sessionVersion: credential!.sessionVersion }, authConfig.secret),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
