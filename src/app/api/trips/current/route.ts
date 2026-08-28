import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccount } from "@/lib/auth-server";
import { getCurrentTrip, saveCurrentTrip, type TripInput } from "@/lib/trip-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseTripInput(value: unknown): TripInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80 || !isDate(input.startDate) || !isDate(input.endDate) || input.endDate < input.startDate) return null;
  if (typeof input.confirmed !== "boolean" || !Number.isInteger(input.version) || Number(input.version) < 0) return null;
  return { name, startDate: input.startDate, endDate: input.endDate, confirmed: input.confirmed, version: Number(input.version) };
}

export async function GET(request: NextRequest) {
  const account = await getAuthenticatedAccount(request);
  if (!account) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    return NextResponse.json({ trip: getCurrentTrip(account.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "여행 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const account = await getAuthenticatedAccount(request);
  if (!account) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 10_000) return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });

  let input: TripInput | null = null;
  try {
    input = parseTripInput(await request.json());
  } catch {
    // The shared validation response below covers malformed JSON.
  }
  if (!input) return NextResponse.json({ error: "여행 이름과 올바른 출발일·도착일이 필요합니다." }, { status: 400 });

  try {
    const result = saveCurrentTrip(account.id, input);
    if (result.status === "conflict") {
      return NextResponse.json({ error: "다른 화면에서 여행 정보가 변경되었습니다.", trip: result.trip }, { status: 409 });
    }
    return NextResponse.json({ trip: result.trip });
  } catch {
    return NextResponse.json({ error: "여행 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}
