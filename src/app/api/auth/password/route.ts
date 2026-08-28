import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccount, hashPassword, verifyPassword } from "@/lib/auth-server";
import { SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { getUserCredential, updateUserPassword } from "@/lib/user-store";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  const account = await getAuthenticatedAccount(request);
  if (!account) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4_096) return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "비밀번호 정보를 확인해 주세요." }, { status: 400 });
  }

  const currentPassword = typeof body === "object" && body && "currentPassword" in body && typeof body.currentPassword === "string"
    ? body.currentPassword
    : "";
  const newPassword = typeof body === "object" && body && "newPassword" in body && typeof body.newPassword === "string"
    ? body.newPassword
    : "";

  if (newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json({ error: "새 비밀번호는 8자 이상 128자 이하로 입력해 주세요." }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "현재 비밀번호와 다른 비밀번호를 입력해 주세요." }, { status: 400 });
  }

  const credential = getUserCredential(account.id);
  if (!credential || !await verifyPassword(currentPassword, credential.passwordHash)) {
    return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const updated = updateUserPassword(account.id, await hashPassword(newPassword));
  if (!updated) return NextResponse.json({ error: "비밀번호를 변경하지 못했습니다." }, { status: 500 });

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
