"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { TravelWorkspace } from "@/components/travel-workspace";
import {
  normalizeLocalInfoData,
  normalizeRoutePlan,
  normalizeScheduleItems,
  normalizeSelectedFlights,
  normalizeTrainPlans,
} from "@/lib/trip-sections";

export type TripDraft = {
  name: string;
  startDate: string;
  endDate: string;
  confirmed: boolean;
  version: number;
};

type TripResponse = { trip?: unknown; error?: string };
type SaveResult = { status: "saved"; trip: TripDraft } | { status: "conflict"; trip: TripDraft } | { status: "error"; message: string };
type ReadinessData = {
  flightLabel: string;
  scheduleLabel: string;
  localLabel: string;
  trainLabel: string;
};

const LEGACY_STORAGE_KEY = "travel-planner:first-trip";
const EMPTY_TRIP: TripDraft = {
  name: "",
  startDate: "",
  endDate: "",
  confirmed: false,
  version: 0,
};

function storedSectionData(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (!payload.section || typeof payload.section !== "object") return null;
  return (payload.section as Record<string, unknown>).data;
}

async function fetchTripReadiness(): Promise<ReadinessData> {
  const paths = ["route", "selected-flights", "schedule", "local-info", "train"];
  const responses = await Promise.all(paths.map((path) => fetch(`/api/trips/current/sections/${path}`, { cache: "no-store" })));
  if (responses.some((response) => !response.ok)) throw new Error("readiness");
  const payloads = await Promise.all(responses.map((response) => response.json() as Promise<unknown>));
  const route = normalizeRoutePlan(storedSectionData(payloads[0]));
  const flights = normalizeSelectedFlights(storedSectionData(payloads[1]) ?? []) ?? [];
  const schedule = normalizeScheduleItems(storedSectionData(payloads[2]) ?? []) ?? [];
  const localInfo = normalizeLocalInfoData(storedSectionData(payloads[3]) ?? { videos: [], weather: null });
  const trains = normalizeTrainPlans(storedSectionData(payloads[4]) ?? []) ?? [];

  return {
    flightLabel: flights.length ? `${flights.length}편 저장` : route?.confirmed ? "구간 확정" : "미확정",
    scheduleLabel: schedule.length ? `${schedule.length}개 일정` : "일정 없음",
    localLabel: localInfo?.weather ? "날씨 저장" : localInfo?.videos.length ? `영상 ${localInfo.videos.length}개` : "미설정",
    trainLabel: trains.length ? `${trains.length}개 계획` : "계획 없음",
  };
}

function TripReadiness() {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(false);
    try {
      setData(await fetchTripReadiness());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const nextData = await fetchTripReadiness();
        if (!disposed) setData(nextData);
      } catch {
        if (!disposed) setError(true);
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => { disposed = true; };
  }, []);

  const items = data ? [
    { icon: "✈", label: "항공", value: data.flightLabel },
    { icon: "◷", label: "일정", value: data.scheduleLabel },
    { icon: "⌖", label: "현지", value: data.localLabel },
    { icon: "▤", label: "열차", value: data.trainLabel },
  ] : [];

  return (
    <section className="trip-readiness" aria-label="여행 준비 현황" aria-busy={loading}>
      <div className="trip-readiness-heading">
        <div><span>TRIP STATUS</span><strong>준비 현황</strong></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="여행 준비 현황 새로고침">↻</button>
      </div>
      {error ? <p className="trip-readiness-error" role="alert">준비 현황을 불러오지 못했습니다.</p> : loading && !data ? (
        <div className="trip-readiness-loading" aria-label="여행 준비 현황 불러오는 중"><span /><span /><span /><span /></div>
      ) : (
        <div className="trip-readiness-list">
          {items.map((item) => <div key={item.label}><span aria-hidden="true">{item.icon}</span><p><small>{item.label}</small><strong>{item.value}</strong></p></div>)}
        </div>
      )}
    </section>
  );
}

function normalizeTrip(value: unknown): TripDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TripDraft>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.startDate !== "string" ||
    typeof candidate.endDate !== "string" ||
    typeof candidate.confirmed !== "boolean"
  ) return null;
  return {
    name: candidate.name,
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    confirmed: candidate.confirmed,
    version: Number.isInteger(candidate.version) && Number(candidate.version) >= 0 ? Number(candidate.version) : 0,
  };
}

function storageKey(accountId: string) {
  return `travel-planner:${accountId}:first-trip`;
}

function readCachedTrip(accountId: string) {
  try {
    const key = storageKey(accountId);
    let saved = window.localStorage.getItem(key);
    if (!saved && (accountId === "admin" || accountId === "guest1")) {
      saved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) window.localStorage.setItem(key, saved);
    }
    return saved ? normalizeTrip(JSON.parse(saved)) : null;
  } catch {
    window.localStorage.removeItem(storageKey(accountId));
    return null;
  }
}

function cacheTrip(accountId: string, trip: TripDraft) {
  window.localStorage.setItem(storageKey(accountId), JSON.stringify(trip));
}

async function saveTripToServer(trip: TripDraft): Promise<SaveResult> {
  try {
    const response = await fetch("/api/trips/current", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trip),
    });
    const payload = await response.json() as TripResponse;
    const returnedTrip = normalizeTrip(payload.trip);
    if (response.status === 409 && returnedTrip) return { status: "conflict", trip: returnedTrip };
    if (!response.ok || !returnedTrip) return { status: "error", message: payload.error ?? "서버 저장에 실패했습니다." };
    return { status: "saved", trip: returnedTrip };
  } catch {
    return { status: "error", message: "서버에 연결할 수 없습니다." };
  }
}

function formatKoreanDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function getTripDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function TripPlanner({ accountId }: { accountId: string }) {
  const [trip, setTrip] = useState<TripDraft>(EMPTY_TRIP);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const startDateId = useId();
  const endDateId = useId();

  useEffect(() => {
    let cancelled = false;

    async function restoreTrip() {
      const cached = readCachedTrip(accountId);
      try {
        const response = await fetch("/api/trips/current", { cache: "no-store" });
        const payload = await response.json() as TripResponse;
        if (!response.ok) throw new Error(payload.error);
        const serverTrip = normalizeTrip(payload.trip);

        if (serverTrip) {
          if (!cancelled) {
            setTrip(serverTrip);
            cacheTrip(accountId, serverTrip);
          }
        } else if (cached?.name && cached.startDate && cached.endDate) {
          const migration = await saveTripToServer({ ...cached, version: 0 });
          if (!cancelled && migration.status !== "error") {
            setTrip(migration.trip);
            cacheTrip(accountId, migration.trip);
            setSyncMessage(migration.status === "saved" ? "기존 브라우저 여행 정보를 서버로 이전했습니다." : "서버의 최신 여행 정보를 불러왔습니다.");
          } else if (!cancelled) {
            setTrip(cached);
            setSyncMessage("서버 이전에 실패해 이 브라우저의 저장 정보를 사용합니다.");
          }
        }
      } catch {
        if (!cancelled && cached) setTrip(cached);
        if (!cancelled) setSyncMessage("서버에 연결하지 못해 이 브라우저의 저장 정보를 사용합니다.");
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void restoreTrip();
    return () => { cancelled = true; };
  }, [accountId]);

  function updateTrip(field: "name" | "startDate" | "endDate", value: string) {
    setTrip((current) => ({ ...current, [field]: value }));
    setError("");
    setSyncMessage("");
  }

  async function applySave(nextTrip: TripDraft) {
    setSaving(true);
    const result = await saveTripToServer(nextTrip);
    setSaving(false);

    if (result.status === "saved") {
      setTrip(result.trip);
      cacheTrip(accountId, result.trip);
      setSyncMessage("이 PC의 서버에 저장했습니다.");
      return;
    }
    if (result.status === "conflict") {
      setTrip(result.trip);
      cacheTrip(accountId, result.trip);
      setSyncMessage("다른 화면에서 변경된 최신 여행 정보를 불러왔습니다. 내용을 확인해 주세요.");
      return;
    }

    setTrip(nextTrip);
    cacheTrip(accountId, nextTrip);
    setSyncMessage(`${result.message} 변경 내용은 이 브라우저에 임시 저장했습니다.`);
  }

  async function confirmTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = trip.name.trim();

    if (!trimmedName || !trip.startDate || !trip.endDate) {
      setError("여행 이름과 출발일, 도착일을 모두 입력해 주세요.");
      return;
    }
    if (trip.endDate < trip.startDate) {
      setError("도착일은 출발일보다 빠를 수 없습니다.");
      return;
    }

    setError("");
    await applySave({ ...trip, name: trimmedName, confirmed: true });
  }

  async function editTrip() {
    setError("");
    await applySave({ ...trip, confirmed: false });
  }

  if (!ready) {
    return (
      <div className="planner-stack">
        <section className="planner-card" aria-label="여행 정보 불러오는 중" aria-busy="true">
          <div className="skeleton skeleton-label" />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-field" />
          <div className="skeleton skeleton-field" />
        </section>
      </div>
    );
  }

  return (
    <div className={`planner-stack ${trip.confirmed ? "has-confirmed-trip" : ""}`}>
      <section className={`planner-card ${trip.confirmed ? "is-confirmed" : ""}`} aria-labelledby="planner-title">
        <div className="card-heading">
          <div><span className="step-label">STEP 01</span><h2 id="planner-title">여행 기본 정보</h2></div>
          <span className={`status-badge ${trip.confirmed ? "is-confirmed" : ""}`}><span aria-hidden="true">{trip.confirmed ? "✓" : "○"}</span>{trip.confirmed ? "확정" : "작성 중"}</span>
        </div>

        {syncMessage ? <p className="sync-message" role="status">{syncMessage}</p> : null}

        {trip.confirmed ? (
          <>
            <div className="confirmed-summary" aria-live="polite">
              <div className="summary-icon" aria-hidden="true">✓</div>
              <p className="summary-kicker">여행 일정이 확정되었습니다</p>
              <h3>{trip.name}</h3>
              <div className="date-summary">
                <div><span>출발</span><strong>{formatKoreanDate(trip.startDate)}</strong></div>
                <span className="date-arrow" aria-hidden="true">→</span>
                <div><span>도착</span><strong>{formatKoreanDate(trip.endDate)}</strong></div>
              </div>
              <p className="trip-length">총 {getTripDays(trip.startDate, trip.endDate)}일의 여행</p>
              <button className="secondary-button" type="button" onClick={() => void editTrip()} disabled={saving}><span aria-hidden="true">✎</span>{saving ? "서버에 저장 중…" : "일정 수정하기"}</button>
            </div>
            <TripReadiness key={`${trip.name}:${trip.startDate}:${trip.endDate}`} />
          </>
        ) : (
          <form onSubmit={(event) => void confirmTrip(event)} noValidate>
            <div className="field-group">
              <label htmlFor={nameId}>여행 이름</label>
              <input id={nameId} type="text" value={trip.name} onChange={(event) => updateTrip("name", event.target.value)} placeholder="예: 가을의 교토와 오사카" autoComplete="off" />
              <span className="field-hint">동행자가 알아보기 쉬운 이름을 지어주세요.</span>
            </div>
            <fieldset className="date-fields">
              <legend>여행 기간</legend>
              <div className="date-grid">
                <div className="field-group"><label htmlFor={startDateId}>출발일</label><span className="date-input-frame"><input id={startDateId} type="date" value={trip.startDate} onChange={(event) => updateTrip("startDate", event.target.value)} /><span className="date-input-icon" aria-hidden="true">▦</span></span></div>
                <span className="date-divider" aria-hidden="true">→</span>
                <div className="field-group"><label htmlFor={endDateId}>도착일</label><span className="date-input-frame"><input id={endDateId} type="date" min={trip.startDate || undefined} value={trip.endDate} onChange={(event) => updateTrip("endDate", event.target.value)} /><span className="date-input-icon" aria-hidden="true">▦</span></span></div>
              </div>
            </fieldset>
            {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
            <button className="primary-button" type="submit" disabled={saving}>{saving ? "서버에 저장 중…" : "여행 일정 확정하기"}<span aria-hidden="true">→</span></button>
          </form>
        )}
      </section>
      {trip.confirmed ? <TravelWorkspace accountId={accountId} trip={trip} /> : null}
    </div>
  );
}
