import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccount } from "@/lib/auth-server";
import { normalizeSavedFlightSearches, type SavedFlightSearch } from "@/lib/skyscanner-links";
import { getCurrentTrip, getTripSection, saveTripSection } from "@/lib/trip-store";
import {
  normalizeRoutePlan,
  normalizeSelectedFlights,
  normalizeLocalInfoData,
  normalizeScheduleItems,
  normalizeTrainPlans,
  type LocalInfoData,
  type RoutePlan,
  type ScheduleItem,
  type SelectedFlight,
  type TrainPlan,
  type TripSectionName,
} from "@/lib/trip-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sectionName(value: string): TripSectionName | null {
  if (value === "route" || value === "schedule") return value;
  if (value === "flight-search") return "flightSearch";
  if (value === "selected-flights") return "selectedFlights";
  if (value === "local-info") return "localInfo";
  return value === "train" ? "train" : null;
}

function sectionLabel(section: TripSectionName) {
  if (section === "route") return "항공 구간";
  if (section === "schedule") return "일정";
  if (section === "flightSearch") return "항공 검색 링크";
  if (section === "selectedFlights") return "선택 항공편";
  return section === "localInfo" ? "현지 정보" : "열차 계획";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const account = await getAuthenticatedAccount(request);
  if (!account) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const section = sectionName((await params).section);
  if (!section) return NextResponse.json({ error: "지원하지 않는 여행 정보입니다." }, { status: 404 });

  try {
    return NextResponse.json(
      { section: getTripSection(account.id, section) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: `${sectionLabel(section)}을 불러오지 못했습니다.` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const account = await getAuthenticatedAccount(request);
  if (!account) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const section = sectionName((await params).section);
  if (!section) return NextResponse.json({ error: "지원하지 않는 여행 정보입니다." }, { status: 404 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 500_000) return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "올바른 JSON 요청이 필요합니다." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: `${sectionLabel(section)} 정보가 필요합니다.` }, { status: 400 });
  const input = body as Record<string, unknown>;
  const version = Number(input.version);
  const data: RoutePlan | ScheduleItem[] | SavedFlightSearch[] | SelectedFlight[] | LocalInfoData | TrainPlan[] | null = section === "route"
    ? normalizeRoutePlan(input.data)
    : section === "schedule"
      ? normalizeScheduleItems(input.data)
      : section === "flightSearch"
        ? normalizeSavedFlightSearches(input.data)
        : section === "selectedFlights"
          ? normalizeSelectedFlights(input.data)
        : section === "localInfo"
          ? normalizeLocalInfoData(input.data)
          : normalizeTrainPlans(input.data);
  if (!data || !Number.isInteger(version) || version < 0) {
    return NextResponse.json({ error: `유효한 ${sectionLabel(section)} 정보와 버전이 필요합니다.` }, { status: 400 });
  }

  if (section === "schedule" && Array.isArray(data)) {
    const trip = getCurrentTrip(account.id);
    if (!trip) return NextResponse.json({ error: "먼저 여행 기본 정보를 저장해 주세요." }, { status: 404 });
    if ((data as ScheduleItem[]).some((item) => item.date < trip.startDate || item.date > trip.endDate)) {
      return NextResponse.json({ error: "일정 날짜는 여행 기간 안에 있어야 합니다." }, { status: 400 });
    }
  }

  if (section === "train" && Array.isArray(data)) {
    const trip = getCurrentTrip(account.id);
    if (!trip) return NextResponse.json({ error: "먼저 여행 기본 정보를 저장해 주세요." }, { status: 404 });
    if ((data as TrainPlan[]).some((plan) => plan.date < trip.startDate || plan.date > trip.endDate)) {
      return NextResponse.json({ error: "탑승일은 여행 기간 안에 있어야 합니다." }, { status: 400 });
    }
  }

  if (section === "selectedFlights" && Array.isArray(data)) {
    const trip = getCurrentTrip(account.id);
    if (!trip) return NextResponse.json({ error: "먼저 여행 기본 정보를 저장해 주세요." }, { status: 404 });
    const flights = data as SelectedFlight[];
    if (flights.some((flight) => flight.departureDate < trip.startDate || flight.departureDate > trip.endDate)) {
      return NextResponse.json({ error: "항공편 출발일은 여행 기간 안에 있어야 합니다." }, { status: 400 });
    }
  }

  try {
    const result = saveTripSection<RoutePlan | ScheduleItem[] | SavedFlightSearch[] | SelectedFlight[] | LocalInfoData | TrainPlan[]>(account.id, section, data, version);
    if (result.status === "missing-trip") return NextResponse.json({ error: "먼저 여행 기본 정보를 저장해 주세요." }, { status: 404 });
    if (result.status === "conflict") {
      return NextResponse.json({ error: `다른 화면에서 ${sectionLabel(section)}이 변경되었습니다.`, section: result.section }, { status: 409 });
    }
    return NextResponse.json({ section: result.section });
  } catch {
    return NextResponse.json({ error: `${sectionLabel(section)}을 저장하지 못했습니다.` }, { status: 500 });
  }
}
