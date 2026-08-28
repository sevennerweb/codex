import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccount } from "@/lib/auth-server";
import {
  TRIP_BACKUP_FORMAT,
  TRIP_BACKUP_SCHEMA_VERSION,
  normalizeTripBackup,
  type TripBackup,
} from "@/lib/trip-backup-schema";
import { getCurrentTrip, getTripSection, restoreTripBackup } from "@/lib/trip-store";
import type { SavedFlightSearch } from "@/lib/skyscanner-links";
import type { LocalInfoData, RoutePlan, ScheduleItem, SelectedFlight, TrainPlan } from "@/lib/trip-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getAdmin(request: NextRequest) {
  const account = await getAuthenticatedAccount(request);
  return account?.role === "admin" ? account : null;
}

export async function GET(request: NextRequest) {
  const account = await getAdmin(request);
  if (!account) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  try {
    const trip = getCurrentTrip(account.id);
    if (!trip) return NextResponse.json({ error: "내보낼 여행 정보가 없습니다." }, { status: 404 });
    const backup: TripBackup = {
      format: TRIP_BACKUP_FORMAT,
      schemaVersion: TRIP_BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      trip: {
        name: trip.name,
        startDate: trip.startDate,
        endDate: trip.endDate,
        confirmed: trip.confirmed,
      },
      sections: {
        route: getTripSection<RoutePlan>(account.id, "route")?.data ?? null,
        flightSearch: getTripSection<SavedFlightSearch[]>(account.id, "flightSearch")?.data ?? null,
        selectedFlights: getTripSection<SelectedFlight[]>(account.id, "selectedFlights")?.data ?? null,
        schedule: getTripSection<ScheduleItem[]>(account.id, "schedule")?.data ?? null,
        localInfo: getTripSection<LocalInfoData>(account.id, "localInfo")?.data ?? null,
        train: getTripSection<TrainPlan[]>(account.id, "train")?.data ?? null,
      },
    };
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="travel-backup-${date}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "여행 백업을 만들지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const account = await getAdmin(request);
  if (!account) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000) return NextResponse.json({ error: "백업 파일이 너무 큽니다." }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "올바른 JSON 백업이 필요합니다." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "복원 정보가 필요합니다." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const backup = normalizeTripBackup(input.backup);
  const expectedVersion = Number(input.expectedVersion);
  if (!backup || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return NextResponse.json({ error: "지원하는 형식의 여행 백업과 현재 버전이 필요합니다." }, { status: 400 });
  }
  if (input.confirmation !== backup.trip.name) {
    return NextResponse.json({ error: "복원할 여행 이름을 정확히 입력해 주세요." }, { status: 400 });
  }

  try {
    const result = restoreTripBackup(account.id, backup, expectedVersion);
    if (result.status === "conflict") {
      return NextResponse.json({ error: "다른 화면에서 현재 여행이 변경되었습니다. 다시 확인해 주세요.", trip: result.trip }, { status: 409 });
    }
    return NextResponse.json({ trip: result.trip });
  } catch {
    return NextResponse.json({ error: "여행 백업을 복원하지 못했습니다." }, { status: 500 });
  }
}
