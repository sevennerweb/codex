"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { TravelWorkspace } from "@/components/travel-workspace";

export type TripDraft = {
  name: string;
  startDate: string;
  endDate: string;
  confirmed: boolean;
};

const STORAGE_KEY = "travel-planner:first-trip";
const EMPTY_TRIP: TripDraft = {
  name: "",
  startDate: "",
  endDate: "",
  confirmed: false,
};

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

export function TripPlanner() {
  const [trip, setTrip] = useState<TripDraft>(EMPTY_TRIP);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const nameId = useId();
  const startDateId = useId();
  const endDateId = useId();

  useEffect(() => {
    const restoreFrame = window.requestAnimationFrame(() => {
      try {
        const savedTrip = window.localStorage.getItem(STORAGE_KEY);
        if (savedTrip) {
          const parsedTrip = JSON.parse(savedTrip) as Partial<TripDraft>;
          if (
            typeof parsedTrip.name === "string" &&
            typeof parsedTrip.startDate === "string" &&
            typeof parsedTrip.endDate === "string" &&
            typeof parsedTrip.confirmed === "boolean"
          ) {
            setTrip(parsedTrip as TripDraft);
          }
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setReady(true);
      }
    });

    return () => window.cancelAnimationFrame(restoreFrame);
  }, []);

  function updateTrip(field: keyof TripDraft, value: string | boolean) {
    setTrip((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function confirmTrip(event: FormEvent<HTMLFormElement>) {
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

    const confirmedTrip = { ...trip, name: trimmedName, confirmed: true };
    setTrip(confirmedTrip);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmedTrip));
    setError("");
  }

  function editTrip() {
    const editableTrip = { ...trip, confirmed: false };
    setTrip(editableTrip);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(editableTrip));
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
    <div className="planner-stack">
      <section className="planner-card" aria-labelledby="planner-title">
      <div className="card-heading">
        <div>
          <span className="step-label">STEP 01</span>
          <h2 id="planner-title">여행 기본 정보</h2>
        </div>
        <span className={`status-badge ${trip.confirmed ? "is-confirmed" : ""}`}>
          <span aria-hidden="true">{trip.confirmed ? "✓" : "○"}</span>
          {trip.confirmed ? "확정" : "작성 중"}
        </span>
      </div>

      {trip.confirmed ? (
        <div className="confirmed-summary" aria-live="polite">
          <div className="summary-icon" aria-hidden="true">✓</div>
          <p className="summary-kicker">여행 일정이 확정되었습니다</p>
          <h3>{trip.name}</h3>
          <div className="date-summary">
            <div>
              <span>출발</span>
              <strong>{formatKoreanDate(trip.startDate)}</strong>
            </div>
            <span className="date-arrow" aria-hidden="true">→</span>
            <div>
              <span>도착</span>
              <strong>{formatKoreanDate(trip.endDate)}</strong>
            </div>
          </div>
          <p className="trip-length">총 {getTripDays(trip.startDate, trip.endDate)}일의 여행</p>
          <button className="secondary-button" type="button" onClick={editTrip}>
            <span aria-hidden="true">✎</span>
            일정 수정하기
          </button>
        </div>
      ) : (
        <form onSubmit={confirmTrip} noValidate>
          <div className="field-group">
            <label htmlFor={nameId}>여행 이름</label>
            <input
              id={nameId}
              type="text"
              value={trip.name}
              onChange={(event) => updateTrip("name", event.target.value)}
              placeholder="예: 가을의 교토와 오사카"
              autoComplete="off"
            />
            <span className="field-hint">동행자가 알아보기 쉬운 이름을 지어주세요.</span>
          </div>

          <fieldset className="date-fields">
            <legend>여행 기간</legend>
            <div className="date-grid">
              <div className="field-group">
                <label htmlFor={startDateId}>출발일</label>
                <span className="date-input-frame">
                  <input
                    id={startDateId}
                    type="date"
                    value={trip.startDate}
                    onChange={(event) => updateTrip("startDate", event.target.value)}
                  />
                  <span className="date-input-icon" aria-hidden="true">▦</span>
                </span>
              </div>
              <span className="date-divider" aria-hidden="true">→</span>
              <div className="field-group">
                <label htmlFor={endDateId}>도착일</label>
                <span className="date-input-frame">
                  <input
                    id={endDateId}
                    type="date"
                    min={trip.startDate || undefined}
                    value={trip.endDate}
                    onChange={(event) => updateTrip("endDate", event.target.value)}
                  />
                  <span className="date-input-icon" aria-hidden="true">▦</span>
                </span>
              </div>
            </div>
          </fieldset>

          {error ? (
            <p className="form-error" role="alert">
              <span aria-hidden="true">!</span>
              {error}
            </p>
          ) : null}

          <button className="primary-button" type="submit">
            여행 일정 확정하기
            <span aria-hidden="true">→</span>
          </button>
        </form>
      )}
      </section>
      {trip.confirmed ? <TravelWorkspace trip={trip} /> : null}
    </div>
  );
}
