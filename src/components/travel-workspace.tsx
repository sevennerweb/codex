"use client";

import {
  DndContext,
  DragOverlay,
  DragEndEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { ReservationCard } from "@/components/reservation-card";
import type { TripDraft } from "@/components/trip-planner";
import { LocalInfoTools, ShinkansenTools } from "@/components/trip-tools";
import airportDataset from "@/data/airports.json";
import {
  buildSkyscannerSearches,
  normalizeSavedFlightSearches,
  parseSkyscannerLink,
  type SavedFlightSearch,
} from "@/lib/skyscanner-links";
import {
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
  normalizeLocalInfoData,
  normalizeGoogleMapsUrl,
  normalizeRoutePlan,
  normalizeScheduleItems,
  normalizeSelectedFlights,
  normalizeTrainPlans,
  openStreetMapUrl,
  type LocalInfoData,
  type RoutePlan,
  type ScheduleCategory,
  type ScheduleItem,
  type SelectedFlight,
  type StoredTripSection,
  type TrainPlan,
} from "@/lib/trip-sections";

type Airport = (typeof airportDataset.airports)[number];

function normalizeAirportQuery(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const AIRPORTS = airportDataset.airports;
const AIRPORT_BY_CODE = new Map(AIRPORTS.map((airport) => [airport.code, airport]));
const SEARCHABLE_AIRPORTS = AIRPORTS.map((airport) => ({
  airport,
  terms: [airport.name, airport.city, ...airport.aliases, ...airport.keywords]
    .map(normalizeAirportQuery)
    .filter(Boolean),
}));

function airportDisplay(airport: Airport) {
  return `${airport.code} — ${airport.name}${airport.city ? ` (${airport.city})` : ""}`;
}

function searchAirports(value: string, limit = 8) {
  const query = normalizeAirportQuery(value);
  if (query.length < 2) return [];

  return SEARCHABLE_AIRPORTS
    .map(({ airport, terms }) => {
      const normalizedCode = airport.code.toLocaleLowerCase("ko-KR");
      let rank = Number.POSITIVE_INFINITY;
      if (normalizedCode === query) rank = 0;
      else if (normalizedCode.startsWith(query)) rank = 1;
      else if (terms.some((term) => term === query)) rank = 2;
      else if (terms.some((term) => term.startsWith(query))) rank = 3;
      else if (terms.some((term) => term.includes(query))) rank = 4;
      return { airport, rank };
    })
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((left, right) => left.rank - right.rank || left.airport.code.localeCompare(right.airport.code))
    .slice(0, limit)
    .map(({ airport }) => airport);
}

type PlaceResult = {
  id: number;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
};

const EMPTY_ROUTE: RoutePlan = {
  outboundOrigin: "",
  outboundDestination: "",
  returnOrigin: "",
  returnDestination: "",
  confirmed: false,
};

const CATEGORY_ICON: Record<ScheduleCategory, string> = {
  관광: "◎",
  숙소: "⌂",
  식사: "◇",
  교통: "↗",
  기타: "•",
};

function legacyStorageKey(kind: "route" | "schedule", trip: TripDraft) {
  return `travel-planner:${kind}:${trip.name}:${trip.startDate}:${trip.endDate}`;
}

function storageKey(accountId: string, kind: "route" | "schedule", trip: TripDraft) {
  return `travel-planner:${accountId}:${kind}:${trip.name}:${trip.startDate}:${trip.endDate}`;
}

function legacyRouteStorageKey(trip: TripDraft) {
  return `travel-planner:route:${trip.name}`;
}

function routeStorageKey(accountId: string, trip: TripDraft) {
  return `travel-planner:${accountId}:route:${trip.name}`;
}

function legacyFlightSearchStorageKey(trip: TripDraft) {
  return `travel-planner:flight-search:${trip.name}`;
}

function flightSearchStorageKey(accountId: string, trip: TripDraft) {
  return `travel-planner:${accountId}:flight-search:${trip.name}`;
}

function migratableLegacyKeys(accountId: string, ...keys: string[]) {
  return accountId === "admin" || accountId === "guest1" ? keys : [];
}

function readStoredValue<T>(key: string, fallback: T, legacyKeys: string[] = []): T {
  try {
    let value = window.localStorage.getItem(key);
    for (const legacyKey of legacyKeys) {
      if (value) break;
      value = window.localStorage.getItem(legacyKey);
    }
    if (value && !window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

type RouteSectionResponse = {
  section?: unknown;
  error?: string;
};

type RouteSaveResult =
  | { status: "saved"; section: StoredTripSection<RoutePlan> }
  | { status: "conflict"; section: StoredTripSection<RoutePlan> }
  | { status: "error"; message: string };

function normalizeRouteSection(value: unknown): StoredTripSection<RoutePlan> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const data = normalizeRoutePlan(input.data);
  if (!data || !Number.isInteger(input.version) || Number(input.version) < 1 || typeof input.updatedAt !== "string") return null;
  return { data, version: Number(input.version), updatedAt: input.updatedAt };
}

async function saveRouteToServer(route: RoutePlan, version: number): Promise<RouteSaveResult> {
  try {
    const response = await fetch("/api/trips/current/sections/route", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: route, version }),
    });
    const payload = await response.json() as RouteSectionResponse;
    const section = normalizeRouteSection(payload.section);
    if (response.status === 409 && section) return { status: "conflict", section };
    if (!response.ok || !section) return { status: "error", message: payload.error ?? "항공 구간 서버 저장에 실패했습니다." };
    return { status: "saved", section };
  } catch {
    return { status: "error", message: "서버에 연결할 수 없습니다." };
  }
}

type ScheduleSectionResponse = {
  section?: unknown;
  error?: string;
};

type ScheduleSaveResult =
  | { status: "saved"; section: StoredTripSection<ScheduleItem[]> }
  | { status: "conflict"; section: StoredTripSection<ScheduleItem[]> }
  | { status: "error"; message: string };

function normalizeScheduleSection(value: unknown): StoredTripSection<ScheduleItem[]> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const data = normalizeScheduleItems(input.data);
  if (!data || !Number.isInteger(input.version) || Number(input.version) < 1 || typeof input.updatedAt !== "string") return null;
  return { data, version: Number(input.version), updatedAt: input.updatedAt };
}

async function saveScheduleToServer(items: ScheduleItem[], version: number): Promise<ScheduleSaveResult> {
  try {
    const response = await fetch("/api/trips/current/sections/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: items, version }),
    });
    const payload = await response.json() as ScheduleSectionResponse;
    const section = normalizeScheduleSection(payload.section);
    if (response.status === 409 && section) return { status: "conflict", section };
    if (!response.ok || !section) return { status: "error", message: payload.error ?? "일정 서버 저장에 실패했습니다." };
    return { status: "saved", section };
  } catch {
    return { status: "error", message: "서버에 연결할 수 없습니다." };
  }
}

type FlightSearchSaveResult =
  | { status: "saved"; section: StoredTripSection<SavedFlightSearch[]> }
  | { status: "conflict"; section: StoredTripSection<SavedFlightSearch[]> }
  | { status: "error"; message: string };

function normalizeFlightSearchSection(value: unknown): StoredTripSection<SavedFlightSearch[]> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const data = normalizeSavedFlightSearches(input.data);
  if (!data || !Number.isInteger(input.version) || Number(input.version) < 1 || typeof input.updatedAt !== "string") return null;
  return { data, version: Number(input.version), updatedAt: input.updatedAt };
}

async function saveFlightSearchesToServer(searches: SavedFlightSearch[], version: number): Promise<FlightSearchSaveResult> {
  try {
    const response = await fetch("/api/trips/current/sections/flight-search", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: searches, version }),
    });
    const payload = await response.json() as ScheduleSectionResponse;
    const section = normalizeFlightSearchSection(payload.section);
    if (response.status === 409 && section) return { status: "conflict", section };
    if (!response.ok || !section) return { status: "error", message: payload.error ?? "항공 검색 링크 서버 저장에 실패했습니다." };
    return { status: "saved", section };
  } catch {
    return { status: "error", message: "서버에 연결할 수 없습니다." };
  }
}

type SelectedFlightSaveResult =
  | { status: "saved"; section: StoredTripSection<SelectedFlight[]> }
  | { status: "conflict"; section: StoredTripSection<SelectedFlight[]> }
  | { status: "error"; message: string };

function normalizeSelectedFlightSection(value: unknown): StoredTripSection<SelectedFlight[]> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const data = normalizeSelectedFlights(input.data);
  if (!data || !Number.isInteger(input.version) || Number(input.version) < 1 || typeof input.updatedAt !== "string") return null;
  return { data, version: Number(input.version), updatedAt: input.updatedAt };
}

async function saveSelectedFlightsToServer(flights: SelectedFlight[], version: number): Promise<SelectedFlightSaveResult> {
  try {
    const response = await fetch("/api/trips/current/sections/selected-flights", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: flights, version }),
    });
    const payload = await response.json() as ScheduleSectionResponse;
    const section = normalizeSelectedFlightSection(payload.section);
    if (response.status === 409 && section) return { status: "conflict", section };
    if (!response.ok || !section) return { status: "error", message: payload.error ?? "선택 항공편 서버 저장에 실패했습니다." };
    return { status: "saved", section };
  } catch {
    return { status: "error", message: "서버에 연결할 수 없습니다." };
  }
}

function getTripDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (cursor <= end) {
    dates.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
    );
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function formatDay(date: string, index: number) {
  const label = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));
  return { day: `DAY ${index + 1}`, label };
}

function airportCode(value: string) {
  const codeMatch = value.trim().match(/^([A-Za-z]{3})(?:\s|—|$)/);
  const code = codeMatch?.[1].toUpperCase();
  if (code && AIRPORT_BY_CODE.has(code)) return code;

  const query = normalizeAirportQuery(value);
  const matches = SEARCHABLE_AIRPORTS.filter(({ terms }) => terms.some((term) => term === query));
  return query && matches.length === 1 ? matches[0].airport.code : "";
}

function airportLabel(code: string) {
  const airport = AIRPORT_BY_CODE.get(code);
  return airport ? `${airport.code} · ${airport.city}` : code;
}

function AirportField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => searchAirports(value), [value]);
  const suggestionsId = `${id}-suggestions`;
  const showSuggestions = focused && normalizeAirportQuery(value).length >= 2;

  function selectAirport(airport: Airport) {
    onChange(airportDisplay(airport));
    setFocused(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectAirport(suggestions[activeIndex] ?? suggestions[0]);
    } else if (event.key === "Escape") {
      setFocused(false);
    }
  }

  return (
    <div className="field-group airport-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setFocused(true);
          setActiveIndex(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="공항명 또는 코드"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showSuggestions}
        aria-controls={suggestionsId}
        aria-activedescendant={showSuggestions && suggestions[activeIndex] ? `${suggestionsId}-${suggestions[activeIndex].code}` : undefined}
      />
      {showSuggestions ? (
        <div className="airport-suggestions" id={suggestionsId} role="listbox" aria-label={`${label} 검색 결과`}>
          {suggestions.length ? suggestions.map((airport, index) => (
            <button
              className={index === activeIndex ? "is-active" : undefined}
              id={`${suggestionsId}-${airport.code}`}
              key={airport.code}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectAirport(airport)}
            >
              <strong>{airport.code}</strong>
              <span><b>{airport.name}</b>{airport.city ? ` · ${airport.city}` : ""}</span>
              <small>{airport.country}</small>
            </button>
          )) : <p>검색 결과가 없습니다.</p>}
        </div>
      ) : null}
    </div>
  );
}

function FlightSearchPanel({ accountId, trip, route }: { accountId: string; trip: TripDraft; route: RoutePlan }) {
  const savedKey = flightSearchStorageKey(accountId, trip);
  const legacyKeys = useMemo(
    () => migratableLegacyKeys(accountId, legacyFlightSearchStorageKey(trip)),
    [accountId, trip],
  );
  const [adults, setAdults] = useState(1);
  const [nonStopOnly, setNonStopOnly] = useState(true);
  const [link, setLink] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedFlightSearch[]>([]);
  const [searchVersion, setSearchVersion] = useState(0);
  const [loadedSearchKey, setLoadedSearchKey] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const generatedSearches = useMemo(() => buildSkyscannerSearches(trip, route, adults, nonStopOnly), [adults, nonStopOnly, route, trip]);

  function searchMatchesCurrent(search: SavedFlightSearch) {
    if (search.kind === "roundTrip") {
      return search.departureDate === trip.startDate
        && search.returnDate === trip.endDate
        && search.outboundOrigin === route.outboundOrigin
        && search.outboundDestination === route.outboundDestination
        && search.returnOrigin === route.returnOrigin
        && search.returnDestination === route.returnDestination;
    }
    return generatedSearches.some((generated) => !generated.returnDate
      && search.departureDate === generated.departureDate
      && search.outboundOrigin === generated.origin
      && search.outboundDestination === generated.destination);
  }

  useEffect(() => {
    let disposed = false;
    const stored = readStoredValue<SavedFlightSearch[] | SavedFlightSearch | null>(savedKey, null, legacyKeys);
    const cachedSearches = normalizeSavedFlightSearches(stored ? (Array.isArray(stored) ? stored : [stored]) : []) ?? [];

    function applySearches(searches: SavedFlightSearch[], version: number) {
      setSavedSearches(searches);
      setSearchVersion(version);
      if (searches[0]) {
        setAdults(searches[0].adults);
        setNonStopOnly(searches[0].nonStopOnly);
      }
      if (searches.length) window.localStorage.setItem(savedKey, JSON.stringify(searches));
      else window.localStorage.removeItem(savedKey);
    }

    async function restoreSearches() {
      try {
        const response = await fetch("/api/trips/current/sections/flight-search", { cache: "no-store" });
        const payload = await response.json() as ScheduleSectionResponse;
        if (!response.ok) throw new Error(payload.error);
        const serverSection = payload.section === null || payload.section === undefined
          ? null
          : normalizeFlightSearchSection(payload.section);
        if (payload.section && !serverSection) throw new Error("서버 항공 검색 링크 형식이 올바르지 않습니다.");
        if (disposed) return;

        if (serverSection) {
          applySearches(serverSection.data, serverSection.version);
        } else if (cachedSearches.length) {
          const migration = await saveFlightSearchesToServer(cachedSearches, 0);
          if (disposed) return;
          if (migration.status === "saved" || migration.status === "conflict") {
            applySearches(migration.section.data, migration.section.version);
            setSyncMessage(migration.status === "saved" ? "기존 항공 검색 링크를 계정 저장소로 옮겼습니다." : "다른 화면의 최신 항공 검색 링크를 불러왔습니다.");
          } else {
            applySearches(cachedSearches, 0);
            setSyncMessage(`${migration.message} 이 브라우저의 링크는 유지했습니다.`);
          }
        } else {
          applySearches([], 0);
        }
      } catch {
        if (!disposed) {
          applySearches(cachedSearches, 0);
          setSyncMessage("서버에 연결하지 못해 이 브라우저의 항공 검색 링크를 표시합니다.");
        }
      } finally {
        if (!disposed) setLoadedSearchKey(savedKey);
      }
    }

    void restoreSearches();
    return () => { disposed = true; };
  }, [legacyKeys, savedKey]);

  function applySavedSearches(searches: SavedFlightSearch[], version: number) {
    setSavedSearches(searches);
    setSearchVersion(version);
    if (searches[0]) {
      setAdults(searches[0].adults);
      setNonStopOnly(searches[0].nonStopOnly);
    }
    if (searches.length) window.localStorage.setItem(savedKey, JSON.stringify(searches));
    else window.localStorage.removeItem(savedKey);
  }

  async function persistSavedSearches(nextSearches: SavedFlightSearch[]) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSyncMessage("");
    applySavedSearches(nextSearches, searchVersion);
    const result = await saveFlightSearchesToServer(nextSearches, searchVersion);
    if (result.status === "saved") {
      applySavedSearches(result.section.data, result.section.version);
      setSyncMessage("항공 검색 링크를 계정 저장소에 저장했습니다.");
    } else if (result.status === "conflict") {
      applySavedSearches(result.section.data, result.section.version);
      setSyncMessage("다른 화면에서 변경된 최신 항공 검색 링크를 불러왔습니다.");
    } else {
      setSyncMessage(`${result.message} 변경 내용은 이 브라우저에 유지했습니다.`);
    }
    savingRef.current = false;
    setSaving(false);
  }

  async function importLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImporting(true);
    try {
      let resultLink = link;
      let enteredUrl: URL;
      try {
        enteredUrl = new URL(link.trim());
      } catch {
        throw new Error("http 또는 https로 시작하는 전체 링크를 붙여 넣어 주세요.");
      }
      if (enteredUrl.hostname.toLowerCase() === "skyscanner.app.link") {
        const response = await fetch("/api/skyscanner/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: enteredUrl.toString() }),
        });
        const payload = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !payload.url) throw new Error(payload.error ?? "앱 공유 링크를 불러오지 못했습니다.");
        resultLink = payload.url;
      }

      const parsed = parseSkyscannerLink(resultLink);
      const next: SavedFlightSearch = { ...parsed, provider: "Skyscanner", importedAt: new Date().toISOString() };
      const nextSearches = [
        ...savedSearches.filter((saved) => !(saved.kind === next.kind
          && saved.outboundOrigin === next.outboundOrigin
          && saved.outboundDestination === next.outboundDestination
          && saved.departureDate === next.departureDate)),
        next,
      ];
      setAdults(next.adults);
      setNonStopOnly(next.nonStopOnly);
      setLink("");
      setError("");
      await persistSavedSearches(nextSearches);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "링크를 가져오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  function clearSavedSearch(search: SavedFlightSearch) {
    if (savingRef.current) return;
    const nextSearches = savedSearches.filter((saved) => saved !== search);
    void persistSavedSearches(nextSearches);
  }

  return (
    <section className="flight-search-panel" aria-labelledby="flight-search-heading">
      <div className="flight-search-heading">
        <div>
          <span className="step-label">EXTERNAL SEARCH</span>
          <h4 id="flight-search-heading">Skyscanner 최저가 검색</h4>
        </div>
        <button className="section-toggle-button" type="button" aria-expanded={detailsOpen} aria-controls="flight-search-details" onClick={() => setDetailsOpen((current) => !current)}>
          {detailsOpen ? "상세 접기" : "검색·링크 관리"}<span aria-hidden="true">{detailsOpen ? "−" : "+"}</span>
        </button>
      </div>
      <p className="collapsible-summary">{generatedSearches.map((search) => `${search.origin}→${search.destination}`).join(" · ")} · 저장된 링크 {savedSearches.length}개</p>
      {detailsOpen ? <div className="collapsible-details" id="flight-search-details">
        <div className="flight-search-form">
        <label>
          <span>성인 인원</span>
          <select value={adults} onChange={(event) => setAdults(Number(event.target.value))}>
            {Array.from({ length: 9 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}명</option>)}
          </select>
        </label>
        <label className="nonstop-option">
          <input type="checkbox" checked={nonStopOnly} onChange={(event) => setNonStopOnly(event.target.checked)} />
          <span><strong>직항 우선</strong><small>각 검색에 적용</small></span>
        </label>
        </div>

        {loadedSearchKey !== savedKey ? <p className="sync-message" role="status">계정에 저장된 항공 검색 링크를 불러오는 중입니다…</p> : syncMessage ? <p className="sync-message" role="status">{syncMessage}</p> : null}

        <div className={`flight-search-links ${generatedSearches.length > 1 ? "is-split" : ""}`}>
        {generatedSearches.map((search) => (
          <article key={search.key}>
            <div>
              <span>{search.label}</span>
              <strong>{search.origin} → {search.destination}</strong>
              <small>{search.departureDate}{search.returnDate ? ` ~ ${search.returnDate}` : " · 편도"}</small>
            </div>
            <a className="primary-button compact external-search-button" href={search.url} target="_blank" rel="noreferrer">
              검색 열기 <span aria-hidden="true">↗</span>
            </a>
          </article>
        ))}
        </div>

        <ol className="flight-search-steps">
        <li><span>1</span>공항이 서로 다르면 가는 편과 오는 편을 각각 열어 두 번 검색합니다.</li>
        <li><span>2</span>웹 결과 주소나 Skyscanner 앱의 공유 링크를 복사합니다.</li>
        <li><span>3</span>아래에 붙여 넣어 검색 조건과 결과 페이지를 여행에 저장합니다.</li>
        </ol>

        <form className="flight-link-form" onSubmit={importLink} noValidate>
        <label htmlFor="skyscanner-result-link">Skyscanner 결과 페이지 또는 앱 공유 링크</label>
        <div>
          <input id="skyscanner-result-link" type="url" value={link} onChange={(event) => { setLink(event.target.value); setError(""); }} placeholder="https://www.skyscanner.co.kr/transport/flights/..." inputMode="url" autoCapitalize="none" autoCorrect="off" />
          <button className="secondary-button compact" type="submit" disabled={importing || saving}>{importing ? "링크 확인 중…" : saving ? "서버에 저장 중…" : "링크 가져오기"}</button>
        </div>
        </form>

        {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
        {savedSearches.map((savedSearch) => {
        const matchesCurrent = searchMatchesCurrent(savedSearch);
        const isOneWay = savedSearch.kind === "oneWay" || !savedSearch.returnDate;
        return (
          <article className={`saved-flight-search ${matchesCurrent ? "" : "is-stale"}`} key={`${savedSearch.url}-${savedSearch.importedAt}`}>
            <div>
              <span>{matchesCurrent ? "저장된 검색 결과 페이지" : "이전 조건의 검색 결과 페이지"}</span>
              <strong>{savedSearch.outboundOrigin} → {savedSearch.outboundDestination}{isOneWay ? " · 편도" : ` · ${savedSearch.returnOrigin} → ${savedSearch.returnDestination}`}</strong>
              <small>{savedSearch.departureDate}{savedSearch.returnDate ? ` ~ ${savedSearch.returnDate}` : ""} · 성인 {savedSearch.adults}명{savedSearch.nonStopOnly ? " · 직항" : ""}</small>
              {!matchesCurrent ? <small className="selection-warning">현재 날짜 또는 항공 구간과 다릅니다. 새 조건으로 다시 검색해 주세요.</small> : null}
            </div>
            <div>
              <a className="secondary-button compact" href={savedSearch.url} target="_blank" rel="noreferrer">결과 다시 열기</a>
              <button className="text-button" type="button" onClick={() => clearSavedSearch(savedSearch)} disabled={saving}>삭제</button>
            </div>
          </article>
        );
        })}
        <p className="flight-disclaimer">결과 링크에는 검색 조건만 들어 있으며 개별 항공편·가격 목록은 포함되지 않습니다. 다음 단계에서 선택 항공편을 텍스트나 화면 공유로 가져오는 기능을 추가할 예정입니다.</p>
      </div> : null}
    </section>
  );
}

const FLIGHT_CARRIERS: Record<string, string> = {
  KE: "대한항공",
  OZ: "아시아나항공",
  NH: "ANA",
  JL: "일본항공",
  "7C": "제주항공",
  LJ: "진에어",
  TW: "티웨이항공",
  ZE: "이스타항공",
  RS: "에어서울",
  BX: "에어부산",
};

function extractFlightText(value: string) {
  const text = value.normalize("NFKC").trim();
  const flightMatch = text.toUpperCase().match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*-?\s*(\d{1,4})\b/);
  const times = [...text.matchAll(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g)].map((match) => match[0]);
  const priceMatch = text.match(/(?:KRW|₩)\s*([\d,]+)|([\d,]+)\s*원/i);
  const code = flightMatch?.[1] ?? "";
  const fallbackCarrier = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line.length <= 100 && !/\d{2}:\d{2}|(?:KRW|₩)|\d[\d,]*원/i.test(line)) ?? "";
  return {
    carrier: FLIGHT_CARRIERS[code] ?? fallbackCarrier,
    flightNumber: flightMatch ? `${code}${flightMatch[2]}` : "",
    departureTime: times[0] ?? "",
    arrivalTime: times[1] ?? "",
    priceKrw: priceMatch ? Number((priceMatch[1] ?? priceMatch[2]).replaceAll(",", "")) : undefined,
  };
}

function SelectedFlightPanel({ accountId, trip, route }: { accountId: string; trip: TripDraft; route: RoutePlan }) {
  const sectionKey = `travel-planner:${accountId}:selected-flights:${trip.name}:${trip.startDate}:${trip.endDate}`;
  const [flights, setFlights] = useState<SelectedFlight[]>([]);
  const [version, setVersion] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [direction, setDirection] = useState<"outbound" | "return">("outbound");
  const [sourceText, setSourceText] = useState("");
  const [carrier, setCarrier] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [priceKrw, setPriceKrw] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let cached: SelectedFlight[] = [];
    try {
      cached = normalizeSelectedFlights(JSON.parse(window.localStorage.getItem(sectionKey) ?? "[]")) ?? [];
    } catch {
      window.localStorage.removeItem(sectionKey);
    }
    async function restoreFlights() {
      try {
        const response = await fetch("/api/trips/current/sections/selected-flights", { cache: "no-store" });
        const payload = await response.json() as ScheduleSectionResponse;
        if (!response.ok) throw new Error(payload.error);
        const section = payload.section === null || payload.section === undefined ? null : normalizeSelectedFlightSection(payload.section);
        if (payload.section && !section) throw new Error("서버 선택 항공편 형식이 올바르지 않습니다.");
        if (!disposed && section) {
          setFlights(section.data);
          setVersion(section.version);
          window.localStorage.setItem(sectionKey, JSON.stringify(section.data));
        } else if (!disposed && cached.length) {
          const migration = await saveSelectedFlightsToServer(cached, 0);
          if (disposed) return;
          if (migration.status === "saved" || migration.status === "conflict") {
            setFlights(migration.section.data);
            setVersion(migration.section.version);
            window.localStorage.setItem(sectionKey, JSON.stringify(migration.section.data));
            setMessage(migration.status === "saved" ? "기존 선택 항공편을 계정 저장소로 옮겼습니다." : "다른 화면의 최신 선택 항공편을 불러왔습니다.");
          } else {
            setFlights(cached);
            setMessage(`${migration.message} 이 브라우저의 선택 항공편은 유지했습니다.`);
          }
        } else if (!disposed) {
          setFlights([]);
          setVersion(0);
        }
      } catch {
        if (!disposed) {
          setFlights(cached);
          setMessage("선택 항공편을 서버에서 불러오지 못해 이 브라우저의 내용을 표시합니다.");
        }
      } finally {
        if (!disposed) setLoadedKey(sectionKey);
      }
    }
    void restoreFlights();
    return () => { disposed = true; };
  }, [sectionKey]);

  function routeDetails(nextDirection = direction) {
    return nextDirection === "outbound"
      ? { origin: route.outboundOrigin, destination: route.outboundDestination, date: trip.startDate }
      : { origin: route.returnOrigin, destination: route.returnDestination, date: trip.endDate };
  }

  function clearForm(nextDirection = direction) {
    setDirection(nextDirection);
    setSourceText("");
    setCarrier("");
    setFlightNumber("");
    setDepartureTime("");
    setArrivalTime("");
    setPriceKrw("");
    setError("");
  }

  function editFlight(flight: SelectedFlight) {
    setFormOpen(true);
    setDirection(flight.direction);
    setSourceText(flight.sourceText ?? "");
    setCarrier(flight.carrier);
    setFlightNumber(flight.flightNumber);
    setDepartureTime(flight.departureTime);
    setArrivalTime(flight.arrivalTime);
    setPriceKrw(flight.priceKrw === undefined ? "" : String(flight.priceKrw));
    setError("");
    window.requestAnimationFrame(() => document.getElementById("selected-flight-form")?.scrollIntoView({ block: "start" }));
  }

  function extract() {
    if (!sourceText.trim()) {
      setError("Skyscanner 또는 예약 화면에서 복사한 항공편 정보를 붙여 넣어 주세요.");
      return;
    }
    const extracted = extractFlightText(sourceText);
    setCarrier(extracted.carrier);
    setFlightNumber(extracted.flightNumber);
    setDepartureTime(extracted.departureTime);
    setArrivalTime(extracted.arrivalTime);
    setPriceKrw(extracted.priceKrw === undefined ? "" : String(extracted.priceKrw));
    setError(extracted.flightNumber && extracted.departureTime && extracted.arrivalTime
      ? ""
      : "일부 정보를 찾지 못했습니다. 아래 입력칸을 직접 보완해 주세요.");
  }

  async function persist(next: SelectedFlight[]) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    setFlights(next);
    window.localStorage.setItem(sectionKey, JSON.stringify(next));
    const result = await saveSelectedFlightsToServer(next, version);
    if (result.status === "saved") {
      setFlights(result.section.data);
      setVersion(result.section.version);
      window.localStorage.setItem(sectionKey, JSON.stringify(result.section.data));
      setMessage("선택 항공편을 계정 저장소에 저장했습니다.");
    } else if (result.status === "conflict") {
      setFlights(result.section.data);
      setVersion(result.section.version);
      window.localStorage.setItem(sectionKey, JSON.stringify(result.section.data));
      setMessage("다른 화면에서 변경된 최신 선택 항공편을 불러왔습니다.");
    } else {
      setMessage(result.message);
    }
    savingRef.current = false;
    setSaving(false);
  }

  function saveFlight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const details = routeDetails();
    const existing = flights.find((flight) => flight.direction === direction);
    const candidate: SelectedFlight = {
      id: existing?.id ?? crypto.randomUUID(),
      direction,
      carrier: carrier.trim(),
      flightNumber: flightNumber.trim().toUpperCase().replaceAll(" ", ""),
      origin: details.origin,
      destination: details.destination,
      departureDate: details.date,
      departureTime,
      arrivalTime,
      priceKrw: priceKrw ? Number(priceKrw) : undefined,
      sourceText: sourceText.trim() || undefined,
      confirmedAt: new Date().toISOString(),
    };
    const next = [...flights.filter((flight) => flight.direction !== direction), candidate];
    if (!normalizeSelectedFlights(next)) {
      setError("항공사, 편명, 출발·도착 시간을 확인해 주세요. 편명은 KE123 같은 형식이어야 합니다.");
      return;
    }
    void persist(next);
    clearForm(direction);
    setFormOpen(false);
  }

  const details = routeDetails();
  return (
    <section className="selected-flight-panel" aria-labelledby="selected-flight-title">
      <div className="flight-search-heading">
        <div><span className="step-label">CONFIRMED FLIGHT</span><h4 id="selected-flight-title">선택 항공편 기록</h4></div>
        <button className="section-toggle-button" type="button" aria-expanded={formOpen} aria-controls="selected-flight-form" onClick={() => { if (formOpen) { clearForm(); setFormOpen(false); } else { clearForm(); setFormOpen(true); } }}>
          {formOpen ? "입력 닫기" : "항공편 추가"}<span aria-hidden="true">{formOpen ? "−" : "+"}</span>
        </button>
      </div>
      {loadedKey !== sectionKey ? <p className="sync-message" role="status">선택 항공편을 불러오는 중입니다…</p> : message ? <p className="sync-message" role="status">{message}</p> : null}

      {formOpen ? <form className="selected-flight-form" id="selected-flight-form" onSubmit={saveFlight} noValidate>
        <div className="field-group">
          <label htmlFor="selected-flight-direction">구간</label>
          <select id="selected-flight-direction" value={direction} onChange={(event) => clearForm(event.target.value as "outbound" | "return")}>
            <option value="outbound">가는 편 · {route.outboundOrigin} → {route.outboundDestination}</option>
            <option value="return">오는 편 · {route.returnOrigin} → {route.returnDestination}</option>
          </select>
        </div>
        <div className="field-group selected-flight-source">
          <label htmlFor="selected-flight-source">복사한 항공편 정보</label>
          <textarea id="selected-flight-source" value={sourceText} onChange={(event) => { setSourceText(event.target.value); setError(""); }} rows={5} placeholder={"대한항공 KE2101\n09:00 ICN → 11:20 HND\n₩245,000"} />
          <button className="secondary-button compact" type="button" onClick={extract}>편명·시간·가격 추출</button>
        </div>
        <p className="selected-flight-route">{details.date} · {details.origin} → {details.destination}</p>
        <div className="selected-flight-grid">
          <div className="field-group"><label htmlFor="selected-flight-carrier">항공사</label><input id="selected-flight-carrier" value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="대한항공" /></div>
          <div className="field-group"><label htmlFor="selected-flight-number">편명</label><input id="selected-flight-number" value={flightNumber} onChange={(event) => setFlightNumber(event.target.value)} placeholder="KE2101" autoCapitalize="characters" /></div>
          <div className="field-group"><label htmlFor="selected-flight-departure">출발 시간</label><input id="selected-flight-departure" type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="selected-flight-arrival">도착 시간</label><input id="selected-flight-arrival" type="time" value={arrivalTime} onChange={(event) => setArrivalTime(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="selected-flight-price">가격 (원)</label><input id="selected-flight-price" type="number" min="0" max="100000000" step="1" inputMode="numeric" value={priceKrw} onChange={(event) => setPriceKrw(event.target.value)} placeholder="245000" /></div>
        </div>
        {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
        <button className="primary-button compact" type="submit" disabled={saving}>{saving ? "서버에 저장 중…" : `${direction === "outbound" ? "가는 편" : "오는 편"} 확정 저장`}</button>
      </form> : null}

      <div className="selected-flight-list">
        {flights.length ? flights.map((flight) => (
          <ReservationCard
            key={flight.id}
            icon="✈"
            tone="flight"
            eyebrow={`${flight.direction === "outbound" ? "가는 편" : "오는 편"} · ${flight.departureDate}`}
            title={`${flight.carrier} ${flight.flightNumber}`}
            meta={`${flight.origin} ${flight.departureTime} → ${flight.destination} ${flight.arrivalTime}`}
            detail={flight.priceKrw !== undefined ? <span>{flight.priceKrw.toLocaleString("ko-KR")}원</span> : undefined}
            actions={<><button className="text-button" type="button" onClick={() => editFlight(flight)} disabled={saving}>수정</button><button className="text-button" type="button" onClick={() => void persist(flights.filter((item) => item.id !== flight.id))} disabled={saving}>삭제</button></>}
          />
        )) : <p className="tool-empty">확정해 둔 항공편이 없습니다.</p>}
      </div>
    </section>
  );
}

function RoutePlanner({ accountId, trip }: { accountId: string; trip: TripDraft }) {
  const routeKey = routeStorageKey(accountId, trip);
  const legacyKeys = useMemo(
    () => migratableLegacyKeys(accountId, legacyRouteStorageKey(trip), legacyStorageKey("route", trip)),
    [accountId, trip],
  );
  const [route, setRoute] = useState<RoutePlan>(EMPTY_ROUTE);
  const [routeVersion, setRouteVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const outboundOriginId = useId();
  const outboundDestinationId = useId();
  const returnOriginId = useId();
  const returnDestinationId = useId();

  useEffect(() => {
    let cancelled = false;

    async function restoreRoute() {
      const cachedRoute = normalizeRoutePlan(readStoredValue<unknown>(routeKey, null, legacyKeys));
      try {
        const response = await fetch("/api/trips/current/sections/route", { cache: "no-store" });
        const payload = await response.json() as RouteSectionResponse;
        if (!response.ok) throw new Error(payload.error);
        const serverSection = normalizeRouteSection(payload.section);

        if (serverSection) {
          if (!cancelled) {
            setRoute(serverSection.data);
            setRouteVersion(serverSection.version);
            window.localStorage.setItem(routeKey, JSON.stringify(serverSection.data));
          }
        } else if (cachedRoute) {
          const migration = await saveRouteToServer(cachedRoute, 0);
          if (!cancelled && migration.status !== "error") {
            setRoute(migration.section.data);
            setRouteVersion(migration.section.version);
            window.localStorage.setItem(routeKey, JSON.stringify(migration.section.data));
            setSyncMessage(migration.status === "saved" ? "기존 항공 구간을 서버로 이전했습니다." : "서버의 최신 항공 구간을 불러왔습니다.");
          } else if (!cancelled) {
            setRoute(cachedRoute);
            setSyncMessage("서버 이전에 실패해 이 브라우저의 항공 구간을 사용합니다.");
          }
        }
      } catch {
        if (!cancelled && cachedRoute) setRoute(cachedRoute);
        if (!cancelled) setSyncMessage("서버에 연결하지 못해 이 브라우저의 항공 구간을 사용합니다.");
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void restoreRoute();
    return () => { cancelled = true; };
  }, [legacyKeys, routeKey]);

  function update(field: keyof RoutePlan, value: string | boolean) {
    setRoute((current) => ({ ...current, [field]: value }));
    setError("");
    setSyncMessage("");
  }

  function mirrorRoute() {
    setRoute((current) => ({
      ...current,
      returnOrigin: current.outboundDestination,
      returnDestination: current.outboundOrigin,
    }));
  }

  async function persistRoute(nextRoute: RoutePlan) {
    setSaving(true);
    const result = await saveRouteToServer(nextRoute, routeVersion);
    setSaving(false);

    if (result.status === "saved") {
      setRoute(result.section.data);
      setRouteVersion(result.section.version);
      window.localStorage.setItem(routeKey, JSON.stringify(result.section.data));
      setSyncMessage("항공 구간을 서버에 저장했습니다.");
      return;
    }
    if (result.status === "conflict") {
      setRoute(result.section.data);
      setRouteVersion(result.section.version);
      window.localStorage.setItem(routeKey, JSON.stringify(result.section.data));
      setSyncMessage("다른 화면에서 변경된 최신 항공 구간을 불러왔습니다. 내용을 확인해 주세요.");
      return;
    }

    setRoute(nextRoute);
    window.localStorage.setItem(routeKey, JSON.stringify(nextRoute));
    setSyncMessage(`${result.message} 변경 내용은 이 브라우저에 임시 저장했습니다.`);
  }

  async function confirmRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = {
      outboundOrigin: airportCode(route.outboundOrigin),
      outboundDestination: airportCode(route.outboundDestination),
      returnOrigin: airportCode(route.returnOrigin),
      returnDestination: airportCode(route.returnDestination),
    };

    if (Object.values(normalized).some((value) => !value)) {
      setError("목록에서 출국편과 귀국편 공항을 모두 선택해 주세요.");
      return;
    }

    if (
      normalized.outboundOrigin === normalized.outboundDestination ||
      normalized.returnOrigin === normalized.returnDestination
    ) {
      setError("각 구간의 출발 공항과 도착 공항은 달라야 합니다.");
      return;
    }

    const confirmedRoute = { ...normalized, confirmed: true };
    await persistRoute(confirmedRoute);
  }

  async function editRoute() {
    const editable = { ...route, confirmed: false };
    await persistRoute(editable);
  }

  if (!ready) {
    return <div className="workspace-loading" aria-label="항공 구간 불러오는 중" />;
  }

  if (route.confirmed) {
    return (
      <div className="route-confirmed">
        {syncMessage ? <p className="sync-message" role="status">{syncMessage}</p> : null}
        <div className="route-row">
          <div>
            <span>출국편 · {trip.startDate}</span>
            <strong>{airportLabel(route.outboundOrigin)}</strong>
          </div>
          <span className="route-row-arrow" aria-hidden="true">→</span>
          <div>
            <span>도착</span>
            <strong>{airportLabel(route.outboundDestination)}</strong>
          </div>
        </div>
        <div className="route-row">
          <div>
            <span>귀국편 · {trip.endDate}</span>
            <strong>{airportLabel(route.returnOrigin)}</strong>
          </div>
          <span className="route-row-arrow" aria-hidden="true">→</span>
          <div>
            <span>도착</span>
            <strong>{airportLabel(route.returnDestination)}</strong>
          </div>
        </div>
        <div className="route-actions">
          <button className="secondary-button compact" type="button" onClick={() => void editRoute()} disabled={saving}>
            {saving ? "서버에 저장 중…" : "구간 수정"}
          </button>
        </div>
        <FlightSearchPanel accountId={accountId} trip={trip} route={route} />
        <SelectedFlightPanel accountId={accountId} trip={trip} route={route} />
      </div>
    );
  }

  return (
    <form className="route-form" onSubmit={(event) => void confirmRoute(event)} noValidate>
      {syncMessage ? <p className="sync-message" role="status">{syncMessage}</p> : null}
      <div className="route-leg">
        <div className="route-leg-heading">
          <div>
            <span className="step-label">OUTBOUND</span>
            <h4>출국편</h4>
          </div>
          <time>{trip.startDate}</time>
        </div>
        <div className="airport-grid">
          <AirportField id={outboundOriginId} label="출발 공항" value={route.outboundOrigin} onChange={(value) => update("outboundOrigin", value)} />
          <span aria-hidden="true">→</span>
          <AirportField id={outboundDestinationId} label="도착 공항" value={route.outboundDestination} onChange={(value) => update("outboundDestination", value)} />
        </div>
      </div>

      <button className="mirror-route-button" type="button" onClick={mirrorRoute}>
        <span aria-hidden="true">⇅</span> 반대 경로로 귀국편 채우기
      </button>

      <div className="route-leg">
        <div className="route-leg-heading">
          <div>
            <span className="step-label">RETURN</span>
            <h4>귀국편</h4>
          </div>
          <time>{trip.endDate}</time>
        </div>
        <div className="airport-grid">
          <AirportField id={returnOriginId} label="출발 공항" value={route.returnOrigin} onChange={(value) => update("returnOrigin", value)} />
          <span aria-hidden="true">→</span>
          <AirportField id={returnDestinationId} label="도착 공항" value={route.returnDestination} onChange={(value) => update("returnDestination", value)} />
        </div>
      </div>

      {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
      <button className="primary-button" type="submit" disabled={saving}>{saving ? "서버에 저장 중…" : "항공 구간 확정하기"} <span aria-hidden="true">→</span></button>
      <p className="airport-data-note">
        <a href={airportDataset.meta.source} target="_blank" rel="noreferrer">OurAirports</a> 공항 데이터 · {airportDataset.meta.count.toLocaleString("ko-KR")}개
      </p>
    </form>
  );
}

function ScheduleCardPreview({ item }: { item: ScheduleItem }) {
  return (
    <article className="schedule-card schedule-card-overlay" aria-hidden="true">
      <span className="drag-handle">⠿</span>
      <span className={`category-icon category-${item.category}`}>{CATEGORY_ICON[item.category]}</span>
      <div className="schedule-card-body">
        <div className="schedule-card-heading">
          <span>{item.time || "시간 미정"} · {item.category}</span>
          <h5>{item.title}</h5>
        </div>
        {item.place ? <p>{item.place}</p> : null}
        {item.address ? <small className="schedule-address">{item.address}</small> : null}
        {item.category === "숙소" && (item.checkInTime || item.checkOutTime) ? <p className="schedule-stay-time">{item.checkInTime ? `체크인 ${item.checkInTime}` : ""}{item.checkInTime && item.checkOutTime ? " · " : ""}{item.checkOutTime ? `체크아웃 ${item.checkOutTime}` : ""}</p> : null}
        {item.note ? <p className="schedule-note">{item.note}</p> : null}
        {item.mapUrl ? <a className="schedule-map-link" href={item.mapUrl} target="_blank" rel="noreferrer">Google Maps에서 열기 <span aria-hidden="true">↗</span></a> : null}
      </div>
    </article>
  );
}

function SortableScheduleCard({
  item,
  order,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: ScheduleItem;
  order: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (item: ScheduleItem) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const style = { transform: CSS.Transform.toString(transform), transition };
  const osmUrl = typeof item.latitude === "number" && typeof item.longitude === "number"
    ? openStreetMapUrl(item.latitude, item.longitude)
    : "";

  return (
    <article ref={setNodeRef} style={style} className={`schedule-card ${item.category === "숙소" ? "is-reservation-stay" : ""} ${selected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""}`}>
      <button className="drag-handle" type="button" aria-label={`${item.title} 일정 이동`} {...attributes} {...listeners}>⠿</button>
      <span className={`category-icon category-${item.category}`} aria-hidden="true"><strong>{order}</strong><small>{CATEGORY_ICON[item.category]}</small></span>
      <button
        className="schedule-card-body schedule-card-summary"
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => { onSelect(item.id); setExpanded((current) => !current); }}
      >
        <div className="schedule-card-heading">
          <span>{item.time || "시간 미정"} · {item.category}</span>
          <h5>{item.title}</h5>
        </div>
        {item.place ? <p>{item.place}</p> : null}
        {item.category === "숙소" && (item.checkInTime || item.checkOutTime) ? <p className="schedule-stay-time">{item.checkInTime ? `체크인 ${item.checkInTime}` : ""}{item.checkInTime && item.checkOutTime ? " · " : ""}{item.checkOutTime ? `체크아웃 ${item.checkOutTime}` : ""}</p> : null}
        <span className="schedule-card-toggle" aria-hidden="true">{expanded ? "상세 접기 −" : "상세 보기 +"}</span>
      </button>
      <div className="schedule-card-actions">
        <button className="icon-button edit-button" type="button" onClick={() => onEdit(item)} aria-label={`${item.title} 수정`} title="일정 수정">✎</button>
        <button className="icon-button" type="button" onClick={() => onDelete(item.id)} aria-label={`${item.title} 삭제`} title="일정 삭제">×</button>
      </div>
      {expanded ? (
        <div className="schedule-card-details" id={detailsId}>
          {item.address ? <p><strong>주소</strong><span>{item.address}</span></p> : null}
          {item.note ? <p><strong>메모</strong><span>{item.note}</span></p> : null}
          {item.mapUrl || osmUrl ? (
            <div className="schedule-card-map-actions">
              {item.mapUrl ? <a href={item.mapUrl} target="_blank" rel="noreferrer">Google Maps에서 열기 <span aria-hidden="true">↗</span></a> : null}
              {osmUrl ? <a href={osmUrl} target="_blank" rel="noreferrer">OpenStreetMap에서 위치 보기 <span aria-hidden="true">↗</span></a> : null}
            </div>
          ) : null}
          {!item.address && !item.note && !item.mapUrl && !osmUrl ? <p className="schedule-card-no-details">저장된 장소 상세나 메모가 없습니다.</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function ScheduleDay({
  date,
  index,
  items,
  collapsed,
  selectedItemId,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
}: {
  date: string;
  index: number;
  items: ScheduleItem[];
  collapsed: boolean;
  selectedItemId: string | null;
  onSelect: (id: string) => void;
  onToggle: () => void;
  onEdit: (item: ScheduleItem) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });
  const formatted = formatDay(date, index);

  return (
    <section ref={setNodeRef} className={`schedule-day ${isOver ? "is-over" : ""}`}>
      <button className="schedule-day-heading" type="button" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="day-number">{formatted.day}</span>
        <span><strong>{formatted.label}</strong><small>{items.length ? `${items.length}개 일정` : "일정 없음"}</small></span>
        <span className="collapse-icon" aria-hidden="true">{collapsed ? "+" : "−"}</span>
      </button>
      {!collapsed ? (
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="schedule-list">
            {items.length ? items.map((item, itemIndex) => <SortableScheduleCard item={item} order={itemIndex + 1} selected={selectedItemId === item.id} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} key={item.id} />) : (
              <div className="schedule-empty">이 날짜에 첫 일정을 추가해 보세요.</div>
            )}
          </div>
        </SortableContext>
      ) : null}
    </section>
  );
}

function ItineraryMap({
  date,
  items,
  selectedItemId,
  onSelect,
}: {
  date: string;
  items: ScheduleItem[];
  selectedItemId: string | null;
  onSelect: (id: string) => void;
}) {
  const points = items.filter((item): item is ScheduleItem & { latitude: number; longitude: number } => (
    typeof item.latitude === "number" && typeof item.longitude === "number"
  ));
  const selected = points.find((item) => item.id === selectedItemId) ?? points[0];

  if (!points.length) {
    return (
      <section className="itinerary-map-card" aria-labelledby="itinerary-map-title">
        <div className="itinerary-map-heading"><div><span className="step-label">MAP</span><h4 id="itinerary-map-title">{date} 일정 지도</h4></div></div>
        <div className="itinerary-map-empty"><span aria-hidden="true">⌖</span><strong>지도에 표시할 장소가 없습니다</strong><p>일정 추가에서 장소 검색 결과를 선택하면 주소와 좌표가 저장되어 여기에 표시됩니다.</p></div>
      </section>
    );
  }

  const latitudes = points.map((item) => item.latitude);
  const longitudes = points.map((item) => item.longitude);
  const latitudePadding = Math.max((Math.max(...latitudes) - Math.min(...latitudes)) * 0.18, 0.008);
  const longitudePadding = Math.max((Math.max(...longitudes) - Math.min(...longitudes)) * 0.18, 0.008);
  const minLatitude = Math.min(...latitudes) - latitudePadding;
  const maxLatitude = Math.max(...latitudes) + latitudePadding;
  const minLongitude = Math.min(...longitudes) - longitudePadding;
  const maxLongitude = Math.max(...longitudes) + longitudePadding;
  const embedUrl = new URL("https://www.openstreetmap.org/export/embed.html");
  embedUrl.searchParams.set("bbox", `${minLongitude},${minLatitude},${maxLongitude},${maxLatitude}`);
  embedUrl.searchParams.set("layer", "mapnik");
  const directionsUrl = googleMapsDirectionsUrl(points);

  return (
    <section className="itinerary-map-card" aria-labelledby="itinerary-map-title">
      <div className="itinerary-map-heading">
        <div><span className="step-label">MAP</span><h4 id="itinerary-map-title">{date} 일정 지도</h4></div>
        <a href={directionsUrl} target="_blank" rel="noreferrer">Google Maps 하루 경로 <span aria-hidden="true">↗</span></a>
      </div>
      <div className="itinerary-map-frame">
        <iframe src={embedUrl.toString()} title={`${date} OpenStreetMap 일정 지도`} loading="lazy" />
        <div className="itinerary-map-pins" aria-label="지도 일정 위치">
          {points.map((item, index) => {
            const left = Math.min(94, Math.max(6, ((item.longitude - minLongitude) / (maxLongitude - minLongitude)) * 100));
            const top = Math.min(94, Math.max(6, ((maxLatitude - item.latitude) / (maxLatitude - minLatitude)) * 100));
            return (
              <button
                className={`itinerary-map-pin category-${item.category} ${selected?.id === item.id ? "is-selected" : ""}`}
                style={{ left: `${left}%`, top: `${top}%` }}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-label={`${index + 1}번 ${item.title} 위치 선택`}
                key={item.id}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      </div>
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">지도 © OpenStreetMap contributors</a>
      {selected ? (
        <div className="itinerary-map-selection" aria-live="polite">
          <span className={`category-icon category-${selected.category}`} aria-hidden="true">{CATEGORY_ICON[selected.category]}</span>
          <div><span>{selected.time || "시간 미정"} · {selected.category}</span><strong>{selected.title}</strong><small>{selected.address || selected.place}</small></div>
          {selected.mapUrl ? <a href={selected.mapUrl} target="_blank" rel="noreferrer">길찾기 ↗</a> : null}
        </div>
      ) : null}
    </section>
  );
}

function ItineraryPlanner({ accountId, trip }: { accountId: string; trip: TripDraft }) {
  const scheduleKey = storageKey(accountId, "schedule", trip);
  const legacyKeys = useMemo(
    () => migratableLegacyKeys(accountId, legacyStorageKey("schedule", trip)),
    [accountId, trip],
  );
  const dates = useMemo(() => getTripDates(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const [loadedScheduleKey, setLoadedScheduleKey] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [time, setTime] = useState("");
  const [category, setCategory] = useState<ScheduleCategory>("관광");
  const [title, setTitle] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [placeState, setPlaceState] = useState<"idle" | "loading" | "error">("idle");
  const [placeError, setPlaceError] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [note, setNote] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"timeline" | "map">("timeline");
  const [mapDate, setMapDate] = useState(dates[0]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let disposed = false;
    const cachedItems = normalizeScheduleItems(readStoredValue<unknown>(scheduleKey, [], legacyKeys)) ?? [];

    async function restoreSchedule() {
      try {
        const response = await fetch("/api/trips/current/sections/schedule", { cache: "no-store" });
        const payload = await response.json() as ScheduleSectionResponse;
        if (!response.ok) throw new Error(payload.error);
        const serverSection = payload.section === null || payload.section === undefined
          ? null
          : normalizeScheduleSection(payload.section);
        if (payload.section && !serverSection) throw new Error("서버 일정 형식이 올바르지 않습니다.");
        if (disposed) return;

        if (serverSection) {
          setItems(serverSection.data);
          setScheduleVersion(serverSection.version);
          window.localStorage.setItem(scheduleKey, JSON.stringify(serverSection.data));
        } else if (cachedItems.length) {
          const migration = await saveScheduleToServer(cachedItems, 0);
          if (disposed) return;
          if (migration.status === "saved" || migration.status === "conflict") {
            setItems(migration.section.data);
            setScheduleVersion(migration.section.version);
            window.localStorage.setItem(scheduleKey, JSON.stringify(migration.section.data));
            setSyncMessage(migration.status === "saved" ? "기존 일정을 계정 저장소로 옮겼습니다." : "다른 화면의 최신 일정을 불러왔습니다.");
          } else {
            setItems(cachedItems);
            setSyncMessage(`${migration.message} 이 브라우저의 일정은 유지했습니다.`);
          }
        } else {
          setItems([]);
          setScheduleVersion(0);
        }
      } catch {
        if (!disposed) {
          setItems(cachedItems);
          setSyncMessage("서버 일정을 불러오지 못해 이 브라우저에 저장된 일정을 표시합니다.");
        }
      } finally {
        if (!disposed) setLoadedScheduleKey(scheduleKey);
      }
    }

    void restoreSchedule();
    return () => { disposed = true; };
  }, [legacyKeys, scheduleKey]);

  async function persist(nextItems: ScheduleItem[]) {
    if (savingRef.current) {
      setSyncMessage("현재 저장이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSyncMessage("");
    setItems(nextItems);
    window.localStorage.setItem(scheduleKey, JSON.stringify(nextItems));
    const result = await saveScheduleToServer(nextItems, scheduleVersion);
    if (result.status === "saved") {
      setItems(result.section.data);
      setScheduleVersion(result.section.version);
      window.localStorage.setItem(scheduleKey, JSON.stringify(result.section.data));
      setSyncMessage("일정을 계정 저장소에 저장했습니다.");
    } else if (result.status === "conflict") {
      setItems(result.section.data);
      setScheduleVersion(result.section.version);
      window.localStorage.setItem(scheduleKey, JSON.stringify(result.section.data));
      setSyncMessage("다른 화면에서 변경된 최신 일정을 불러왔습니다. 내용을 확인해 주세요.");
    } else {
      setSyncMessage(`${result.message} 변경 내용은 이 브라우저에 유지했습니다.`);
    }
    savingRef.current = false;
    setSaving(false);
  }

  async function searchSchedulePlace() {
    const query = placeQuery.trim();
    if (query.length < 2) {
      setPlaceError("장소 검색어를 2자 이상 입력해 주세요.");
      return;
    }
    setPlaceState("loading");
    setPlaceError("");
    setPlaceResults([]);
    try {
      const response = await fetch(`/api/places?scope=place&q=${encodeURIComponent(query)}`);
      const payload = await response.json() as { results?: PlaceResult[]; error?: string };
      if (!response.ok || !payload.results) throw new Error(payload.error);
      setPlaceResults(payload.results);
      setPlaceState("idle");
      if (!payload.results.length) setPlaceError("검색 결과가 없습니다. Google Maps 링크를 직접 붙여넣을 수 있습니다.");
    } catch {
      setPlaceState("error");
      setPlaceError("장소 검색 서비스에 연결할 수 없습니다. Google Maps 링크를 직접 붙여넣어 주세요.");
    }
  }

  function chooseSchedulePlace(place: PlaceResult) {
    setSelectedPlace(place);
    setPlaceQuery(place.name);
    setMapUrl(googleMapsSearchUrl(place.latitude, place.longitude));
    setPlaceResults([]);
    setPlaceError("");
    setPlaceState("idle");
  }

  function resetScheduleForm() {
    setEditingId(null);
    setTitle("");
    setPlaceQuery("");
    setPlaceResults([]);
    setSelectedPlace(null);
    setPlaceState("idle");
    setPlaceError("");
    setMapUrl("");
    setNote("");
    setCheckInTime("");
    setCheckOutTime("");
    setError("");
  }

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("일정 이름을 입력해 주세요.");
      return;
    }
    const normalizedMapUrl = normalizeGoogleMapsUrl(mapUrl);
    if (mapUrl.trim() && !normalizedMapUrl) {
      setPlaceError("https://로 시작하는 Google Maps 공유 링크를 입력해 주세요.");
      return;
    }
    if (placeQuery.trim() && !selectedPlace && !normalizedMapUrl) {
      setPlaceError("검색 결과에서 장소를 선택하거나 Google Maps 링크를 붙여넣어 주세요.");
      return;
    }
    const existingItem = editingId ? items.find((item) => item.id === editingId) : undefined;
    const item: ScheduleItem = {
      id: existingItem?.id ?? crypto.randomUUID(),
      date: selectedDate,
      time,
      category,
      title: title.trim(),
      place: selectedPlace?.name ?? (placeQuery.trim() || (normalizedMapUrl ? "Google Maps 장소" : "")),
      address: selectedPlace?.region ?? "",
      latitude: selectedPlace?.latitude,
      longitude: selectedPlace?.longitude,
      mapUrl: normalizedMapUrl || (selectedPlace ? googleMapsSearchUrl(selectedPlace.latitude, selectedPlace.longitude) : ""),
      note: note.trim(),
      checkInTime: category === "숙소" ? checkInTime || undefined : undefined,
      checkOutTime: category === "숙소" ? checkOutTime || undefined : undefined,
    };
    if (existingItem) {
      const nextItems = existingItem.date === selectedDate
        ? items.map((current) => current.id === existingItem.id ? item : current)
        : [...items.filter((current) => current.id !== existingItem.id), item];
      void persist(nextItems);
    } else {
      void persist([...items, item]);
    }
    resetScheduleForm();
    setFormOpen(false);
    setMapDate(selectedDate);
    setSelectedScheduleId(item.id);
    setCollapsedDays((current) => {
      const next = new Set(current);
      next.delete(selectedDate);
      return next;
    });
  }

  function deleteSchedule(id: string) {
    if (savingRef.current) return;
    if (editingId === id) cancelEdit();
    if (selectedScheduleId === id) setSelectedScheduleId(null);
    void persist(items.filter((item) => item.id !== id));
  }

  function editSchedule(item: ScheduleItem) {
    setFormOpen(true);
    setMapDate(item.date);
    setSelectedScheduleId(item.id);
    setEditingId(item.id);
    setSelectedDate(item.date);
    setTime(item.time);
    setCategory(item.category);
    setTitle(item.title);
    setPlaceQuery(item.place);
    setSelectedPlace(
      typeof item.latitude === "number" && typeof item.longitude === "number"
        ? { id: 0, name: item.place, region: item.address ?? "", latitude: item.latitude, longitude: item.longitude }
        : null,
    );
    setPlaceResults([]);
    setPlaceState("idle");
    setPlaceError("");
    setMapUrl(item.mapUrl ?? "");
    setNote(item.note ?? "");
    setCheckInTime(item.checkInTime ?? "");
    setCheckOutTime(item.checkOutTime ?? "");
    setError("");
    setCollapsedDays((current) => {
      const next = new Set(current);
      next.delete(item.date);
      return next;
    });
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLFormElement>(".schedule-form")?.scrollIntoView({ block: "start" });
    });
  }

  function cancelEdit() {
    resetScheduleForm();
    setFormOpen(false);
  }

  function openScheduleForm() {
    resetScheduleForm();
    setSelectedDate(mapDate);
    setFormOpen(true);
    window.requestAnimationFrame(() => document.querySelector<HTMLFormElement>(".schedule-form")?.scrollIntoView({ block: "start" }));
  }

  function orderedItems(dayItems: Record<string, ScheduleItem[]>) {
    return dates.flatMap((date) => dayItems[date] ?? []);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItemId(null);
    if (savingRef.current) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeItem = items.find((item) => item.id === active.id);
    if (!activeItem) return;
    const overItem = items.find((item) => item.id === over.id);
    const targetDate = String(over.id).startsWith("day:") ? String(over.id).slice(4) : overItem?.date;
    if (!targetDate) return;

    const grouped = Object.fromEntries(dates.map((date) => [date, items.filter((item) => item.date === date)]));
    const sourceItems = grouped[activeItem.date];
    const sourceIndex = sourceItems.findIndex((item) => item.id === active.id);

    if (activeItem.date === targetDate) {
      const targetIndex = sourceItems.findIndex((item) => item.id === over.id);
      if (targetIndex >= 0) grouped[targetDate] = arrayMove(sourceItems, sourceIndex, targetIndex);
    } else {
      sourceItems.splice(sourceIndex, 1);
      const targetItems = grouped[targetDate];
      const targetIndex = overItem ? targetItems.findIndex((item) => item.id === over.id) : targetItems.length;
      targetItems.splice(targetIndex < 0 ? targetItems.length : targetIndex, 0, { ...activeItem, date: targetDate });
    }

    void persist(orderedItems(grouped));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveItemId(String(event.active.id));
  }

  if (loadedScheduleKey !== scheduleKey) return <p className="sync-message" role="status">계정에 저장된 일정을 불러오는 중입니다…</p>;

  return (
    <div className="itinerary-layout">
      {syncMessage ? <p className="sync-message" role="status">{syncMessage}</p> : null}
      <div className="itinerary-toolbar">
        <div className="itinerary-view-toggle" role="group" aria-label="일정 보기 방식">
          <button type="button" className={mobileView === "timeline" ? "is-active" : ""} aria-pressed={mobileView === "timeline"} onClick={() => setMobileView("timeline")}>타임라인</button>
          <button type="button" className={mobileView === "map" ? "is-active" : ""} aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")}>지도</button>
        </div>
        <button className="primary-button compact" type="button" onClick={openScheduleForm}>새 일정 추가 <span aria-hidden="true">＋</span></button>
      </div>
      {formOpen ? <form className="schedule-form" onSubmit={saveSchedule} noValidate>
        <div className="schedule-form-heading">
          <span className="step-label">{editingId ? "EDIT PLAN" : "NEW PLAN"}</span>
          <h4>{editingId ? "일정 수정" : "일정 추가"}</h4>
        </div>
        <div className="schedule-form-grid">
          <div className="field-group"><label htmlFor="schedule-date">날짜</label><select id="schedule-date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{dates.map((date, index) => <option value={date} key={date}>{formatDay(date, index).day} · {formatDay(date, index).label}</option>)}</select></div>
          <div className="field-group"><label htmlFor="schedule-time">시간</label><input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="schedule-category">유형</label><select id="schedule-category" value={category} onChange={(event) => setCategory(event.target.value as ScheduleCategory)}>{Object.keys(CATEGORY_ICON).map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
          {category === "숙소" ? (
            <fieldset className="schedule-stay-fields">
              <legend>숙소 이용 시간</legend>
              <div className="field-group"><label htmlFor="schedule-check-in">체크인</label><input id="schedule-check-in" type="time" value={checkInTime} onChange={(event) => setCheckInTime(event.target.value)} /></div>
              <div className="field-group"><label htmlFor="schedule-check-out">체크아웃</label><input id="schedule-check-out" type="time" value={checkOutTime} onChange={(event) => setCheckOutTime(event.target.value)} /></div>
            </fieldset>
          ) : null}
          <div className="field-group schedule-title-field"><label htmlFor="schedule-title">일정 이름</label><input id="schedule-title" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder="예: 기요미즈데라 산책" /></div>
          <div className="field-group schedule-place-field">
            <label htmlFor="schedule-place">장소 검색</label>
            <div className="schedule-place-search">
              <input
                id="schedule-place"
                value={placeQuery}
                onChange={(event) => {
                  if (selectedPlace && mapUrl === googleMapsSearchUrl(selectedPlace.latitude, selectedPlace.longitude)) setMapUrl("");
                  setPlaceQuery(event.target.value);
                  setSelectedPlace(null);
                  setPlaceResults([]);
                  setPlaceError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchSchedulePlace();
                  }
                }}
                placeholder="예: 기요미즈데라, 도쿄역 호텔"
                autoComplete="off"
                aria-describedby="schedule-place-help"
              />
              <button type="button" onClick={() => void searchSchedulePlace()} disabled={placeState === "loading"}>
                {placeState === "loading" ? "검색 중…" : "검색"}
              </button>
            </div>
            <span className="field-hint" id="schedule-place-help">검색 결과를 선택하면 주소·좌표와 Google Maps 링크가 저장됩니다.</span>
            {placeResults.length ? (
              <div className="place-results schedule-place-results" aria-label="장소 검색 결과">
                {placeResults.map((place) => (
                  <button type="button" onClick={() => chooseSchedulePlace(place)} key={place.id}>
                    <strong>{place.name}</strong><span>{place.region}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedPlace ? (
              <div className="selected-schedule-place" role="status">
                <span aria-hidden="true">⌖</span>
                <div><strong>{selectedPlace.name}</strong><small>{selectedPlace.region}</small></div>
              </div>
            ) : null}
            {placeError ? <p className="field-error" role="alert">{placeError}</p> : null}
            <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">장소 검색 © OpenStreetMap contributors</a>
          </div>
          <div className="field-group schedule-map-field">
            <label htmlFor="schedule-map-url">Google Maps 링크</label>
            <input id="schedule-map-url" inputMode="url" value={mapUrl} onChange={(event) => { setMapUrl(event.target.value); setPlaceError(""); }} placeholder="https://maps.app.goo.gl/..." />
            <span className="field-hint">Google Maps에서 공유한 링크를 붙여넣거나, 위 검색 결과를 선택하면 자동으로 채워집니다.</span>
          </div>
          <div className="field-group schedule-note-field">
            <label htmlFor="schedule-note">메모</label>
            <textarea id="schedule-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="예약 정보, 만날 위치, 준비물 등을 적어두세요." rows={3} />
          </div>
        </div>
        {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
        <div className="schedule-form-actions">
          <button className="secondary-button compact" type="button" onClick={cancelEdit}>{editingId ? "수정 취소" : "입력 닫기"}</button>
          <button className="primary-button compact" type="submit" disabled={saving}>{saving ? "서버에 저장 중…" : editingId ? "수정 저장" : "일정 추가"} <span aria-hidden="true">{editingId ? "✓" : "＋"}</span></button>
        </div>
      </form> : null}

      <div className="itinerary-content" data-mobile-view={mobileView}>
        <div className="itinerary-timeline">
        <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveItemId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="schedule-days">
          {dates.map((date, index) => (
            <ScheduleDay
              date={date}
              index={index}
              items={items.filter((item) => item.date === date)}
              collapsed={collapsedDays.has(date)}
              selectedItemId={selectedScheduleId}
              onSelect={(id) => { setSelectedScheduleId(id); setMapDate(date); }}
              onToggle={() => setCollapsedDays((current) => {
                const next = new Set(current);
                if (next.has(date)) next.delete(date); else next.add(date);
                return next;
              })}
              onEdit={editSchedule}
              onDelete={deleteSchedule}
              key={date}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeItemId ? <ScheduleCardPreview item={items.find((item) => item.id === activeItemId)!} /> : null}
        </DragOverlay>
      </DndContext>
        </div>
        <aside className="itinerary-map-pane">
          <div className="itinerary-map-dates" aria-label="지도 날짜 선택">
            {dates.map((date, index) => <button type="button" className={mapDate === date ? "is-active" : ""} aria-pressed={mapDate === date} onClick={() => { setMapDate(date); setSelectedScheduleId(items.find((item) => item.date === date)?.id ?? null); }} key={date}>{formatDay(date, index).day}</button>)}
          </div>
          <ItineraryMap date={mapDate} items={items.filter((item) => item.date === mapDate)} selectedItemId={selectedScheduleId} onSelect={setSelectedScheduleId} />
        </aside>
      </div>
    </div>
  );
}

type DayModeData = {
  schedule: ScheduleItem[];
  flights: SelectedFlight[];
  trains: TrainPlan[];
  localInfo: LocalInfoData;
};

function localCalendarDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function sectionData(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const section = (value as { section?: unknown }).section;
  if (!section || typeof section !== "object") return undefined;
  return (section as { data?: unknown }).data;
}

function TripDayMode({ trip, onBack }: { trip: TripDraft; onBack: () => void }) {
  const [data, setData] = useState<DayModeData | null>(null);
  const [error, setError] = useState("");
  const today = localCalendarDate();
  const isLive = today >= trip.startDate && today <= trip.endDate;
  const targetDate = isLive ? today : trip.startDate;

  useEffect(() => {
    let disposed = false;
    async function loadDayMode() {
      setError("");
      try {
        const [scheduleResponse, flightsResponse, trainsResponse, localInfoResponse] = await Promise.all([
          fetch("/api/trips/current/sections/schedule", { cache: "no-store" }),
          fetch("/api/trips/current/sections/selected-flights", { cache: "no-store" }),
          fetch("/api/trips/current/sections/train", { cache: "no-store" }),
          fetch("/api/trips/current/sections/local-info", { cache: "no-store" }),
        ]);
        if (![scheduleResponse, flightsResponse, trainsResponse, localInfoResponse].every((response) => response.ok)) throw new Error();
        const [schedulePayload, flightsPayload, trainsPayload, localInfoPayload] = await Promise.all([
          scheduleResponse.json(), flightsResponse.json(), trainsResponse.json(), localInfoResponse.json(),
        ]);
        const schedule = normalizeScheduleItems(sectionData(schedulePayload) ?? []) ?? [];
        const flights = normalizeSelectedFlights(sectionData(flightsPayload) ?? []) ?? [];
        const trains = normalizeTrainPlans(sectionData(trainsPayload) ?? []) ?? [];
        const localInfo = normalizeLocalInfoData(sectionData(localInfoPayload) ?? { videos: [], weather: null }) ?? { videos: [], weather: null };
        if (!disposed) setData({ schedule, flights, trains, localInfo });
      } catch {
        if (!disposed) setError("여행 중 화면에 필요한 정보를 불러오지 못했습니다.");
      }
    }
    void loadDayMode();
    return () => { disposed = true; };
  }, []);

  if (error) return <div className="day-mode-error"><p role="alert">{error}</p><button className="secondary-button compact" type="button" onClick={onBack}>계획 화면으로 돌아가기</button></div>;
  if (!data) return <p className="sync-message" role="status">오늘의 여행 정보를 불러오는 중입니다…</p>;

  const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const ordered = [...data.schedule].sort((left, right) => `${left.date} ${left.time || "99:99"}`.localeCompare(`${right.date} ${right.time || "99:99"}`));
  const nextItem = ordered.find((item) => item.date > targetDate || (item.date === targetDate && (!isLive || !item.time || Number(item.time.slice(0, 2)) * 60 + Number(item.time.slice(3, 5)) >= currentMinutes)));
  const dayItems = ordered.filter((item) => item.date === targetDate);
  const dayFlights = data.flights.filter((flight) => flight.departureDate === targetDate);
  const dayTrains = data.trains.filter((train) => train.date === targetDate);
  const dayStays = dayItems.filter((item) => item.category === "숙소");
  const weather = data.localInfo.weather;
  const weatherIndex = weather?.weather.daily.time.indexOf(targetDate) ?? -1;

  return (
    <div className="trip-day-mode">
      <div className="trip-day-hero">
        <div className="trip-day-heading">
          <div><span className="eyebrow">{isLive ? "TODAY ON YOUR TRIP" : "TRIP MODE PREVIEW"}</span><h3>{isLive ? "오늘의 다음 일정" : `${targetDate} 여행 화면`}</h3></div>
          <button className="secondary-button compact" type="button" onClick={onBack}>계획 편집으로 돌아가기</button>
        </div>
        {nextItem ? (
          <div className="next-schedule-card">
            <span>{nextItem.date} · {nextItem.time || "시간 미정"} · {nextItem.category}</span>
            <strong>{nextItem.title}</strong>
            <p>{nextItem.address || nextItem.place || "장소 미정"}</p>
            {nextItem.mapUrl ? <a className="trip-move-button" href={nextItem.mapUrl} target="_blank" rel="noreferrer">Google Maps로 이동하기 <span aria-hidden="true">→</span></a> : <span className="trip-move-button is-disabled" aria-disabled="true">장소를 추가하면 이동 버튼이 활성화됩니다</span>}
          </div>
        ) : <div className="next-schedule-card is-empty"><strong>등록된 다음 일정이 없습니다</strong><p>계획 화면에서 일정과 장소를 추가해 주세요.</p></div>}
        {weather && weatherIndex >= 0 ? <div className="trip-day-weather"><span>저장된 예보</span><strong>{Math.round(weather.weather.daily.temperature_2m_max[weatherIndex])}° / {Math.round(weather.weather.daily.temperature_2m_min[weatherIndex])}°</strong><small>강수 {weather.weather.daily.precipitation_probability_max[weatherIndex] ?? 0}%</small></div> : null}
      </div>

      <section className="trip-day-section" aria-labelledby="day-timeline-title">
        <div className="trip-day-section-heading"><span className="step-label">TIMELINE</span><h4 id="day-timeline-title">{targetDate} 일정</h4></div>
        <div className="day-readonly-timeline">
          {dayItems.length ? dayItems.map((item, index) => <article key={item.id}><span>{index + 1}</span><div><small>{item.time || "시간 미정"} · {item.category}</small><strong>{item.title}</strong><p>{item.place}</p></div>{item.mapUrl ? <a href={item.mapUrl} target="_blank" rel="noreferrer" aria-label={`${item.title} Google Maps에서 열기`}>이동 ↗</a> : null}</article>) : <p className="tool-empty">이 날짜에 등록된 일정이 없습니다.</p>}
        </div>
      </section>

      {dayFlights.length || dayTrains.length || dayStays.length ? (
        <section className="trip-day-section" aria-labelledby="day-reservations-title">
          <div className="trip-day-section-heading"><span className="step-label">RESERVATIONS</span><h4 id="day-reservations-title">오늘 필요한 예약</h4></div>
          <div className="reservation-list">
            {dayFlights.map((flight) => <ReservationCard key={flight.id} icon="✈" tone="flight" eyebrow={`${flight.direction === "outbound" ? "가는 편" : "오는 편"} · ${flight.departureDate}`} title={`${flight.carrier} ${flight.flightNumber}`} meta={`${flight.origin} ${flight.departureTime} → ${flight.destination} ${flight.arrivalTime}`} />)}
            {dayTrains.map((train) => <ReservationCard key={train.id} icon="▤" tone="train" eyebrow={`열차 · ${train.date} ${train.time}`} title={`${train.origin} → ${train.destination}`} meta="저장된 NAVITIME 검색 조건" actions={train.searchUrl ? <a className="train-result-link" href={train.searchUrl} target="_blank" rel="noreferrer">다시 검색</a> : undefined} />)}
            {dayStays.map((stay) => <ReservationCard key={stay.id} icon="⌂" tone="stay" eyebrow={`숙소 · ${stay.date}`} title={stay.title} meta={`${stay.checkInTime ? `체크인 ${stay.checkInTime}` : ""}${stay.checkInTime && stay.checkOutTime ? " · " : ""}${stay.checkOutTime ? `체크아웃 ${stay.checkOutTime}` : ""}` || stay.place} actions={stay.mapUrl ? <a className="train-result-link" href={stay.mapUrl} target="_blank" rel="noreferrer">지도 열기</a> : undefined} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function TravelWorkspace({ accountId, trip }: { accountId: string; trip: TripDraft }) {
  const [tab, setTab] = useState<"route" | "schedule" | "local" | "train">("route");
  const [mobileSection, setMobileSection] = useState<"trip" | "route" | "schedule" | "local" | "train">("route");
  const [dayMode, setDayMode] = useState(() => {
    const today = localCalendarDate();
    return today >= trip.startDate && today <= trip.endDate;
  });

  function changeTab(nextTab: "route" | "schedule" | "local" | "train") {
    setTab(nextTab);
    setMobileSection(nextTab);
  }

  function navigateMobile(target: "trip" | "route" | "schedule" | "local" | "train") {
    setMobileSection(target);
    if (target === "trip") {
      document.getElementById("main-content")?.scrollIntoView({ block: "start" });
      return;
    }
    setTab(target);
    window.requestAnimationFrame(() => document.getElementById("travel-workspace")?.scrollIntoView({ block: "start" }));
  }

  return (
    <>
      <section className="workspace-card" id="travel-workspace" aria-labelledby="workspace-title">
        <div className="workspace-heading">
          <div><span className="eyebrow">BUILD YOUR TRIP</span><h2 id="workspace-title">여행 계획</h2></div>
          <div className="workspace-heading-actions"><span className="workspace-trip-name">{trip.name}</span><button className="day-mode-toggle" type="button" onClick={() => setDayMode((current) => !current)}>{dayMode ? "계획 편집" : "여행 화면"}<span aria-hidden="true">{dayMode ? "✎" : "→"}</span></button></div>
        </div>
        {dayMode ? <TripDayMode trip={trip} onBack={() => setDayMode(false)} /> : <>
          <div className="workspace-active-section" aria-live="polite">
            <span>현재 메뉴</span>
            <strong>{tab === "route" ? "항공" : tab === "schedule" ? "일정" : tab === "local" ? "현지" : "열차"}</strong>
          </div>
          <div className="workspace-tabs" role="tablist" aria-label="여행 계획 메뉴">
          <button role="tab" aria-selected={tab === "route"} aria-controls="workspace-panel" className={tab === "route" ? "is-active" : ""} onClick={() => changeTab("route")}>항공</button>
          <button role="tab" aria-selected={tab === "schedule"} aria-controls="workspace-panel" className={tab === "schedule" ? "is-active" : ""} onClick={() => changeTab("schedule")}>일정</button>
          <button role="tab" aria-selected={tab === "local"} aria-controls="workspace-panel" className={tab === "local" ? "is-active" : ""} onClick={() => changeTab("local")}>현지</button>
          <button role="tab" aria-selected={tab === "train"} aria-controls="workspace-panel" className={tab === "train" ? "is-active" : ""} onClick={() => changeTab("train")}>열차</button>
        </div>
        <div id="workspace-panel" role="tabpanel">{tab === "route" ? <RoutePlanner accountId={accountId} trip={trip} /> : tab === "schedule" ? <ItineraryPlanner accountId={accountId} trip={trip} /> : tab === "local" ? <LocalInfoTools accountId={accountId} trip={trip} /> : <ShinkansenTools accountId={accountId} trip={trip} />}</div>
        </>}
      </section>

      {!dayMode ? <nav className="mobile-nav" aria-label="주요 메뉴">
        <button className={`mobile-nav-item ${mobileSection === "trip" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "trip" ? "page" : undefined} onClick={() => navigateMobile("trip")}>
          <span aria-hidden="true">⌂</span>여행
        </button>
        <button className={`mobile-nav-item ${mobileSection === "route" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "route" ? "page" : undefined} onClick={() => navigateMobile("route")}>
          <span aria-hidden="true">✈</span>항공
        </button>
        <button className={`mobile-nav-item ${mobileSection === "schedule" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "schedule" ? "page" : undefined} onClick={() => navigateMobile("schedule")}>
          <span aria-hidden="true">◷</span>일정
        </button>
        <button className={`mobile-nav-item ${mobileSection === "local" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "local" ? "page" : undefined} onClick={() => navigateMobile("local")}>
          <span aria-hidden="true">⌖</span>현지
        </button>
        <button className={`mobile-nav-item ${mobileSection === "train" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "train" ? "page" : undefined} onClick={() => navigateMobile("train")}>
          <span aria-hidden="true">▤</span>열차
        </button>
      </nav> : null}
    </>
  );
}
