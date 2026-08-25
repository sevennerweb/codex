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
import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import type { TripDraft } from "@/components/trip-planner";
import { LocalInfoTools, ShinkansenTools } from "@/components/trip-tools";
import airportDataset from "@/data/airports.json";
import { buildSkyscannerSearches, parseSkyscannerLink, type SavedFlightSearch } from "@/lib/skyscanner-links";

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

type RoutePlan = {
  outboundOrigin: string;
  outboundDestination: string;
  returnOrigin: string;
  returnDestination: string;
  confirmed: boolean;
};

type ScheduleCategory = "관광" | "숙소" | "식사" | "교통" | "기타";

type ScheduleItem = {
  id: string;
  date: string;
  time: string;
  category: ScheduleCategory;
  title: string;
  place: string;
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

function storageKey(kind: "route" | "schedule", trip: TripDraft) {
  return `travel-planner:${kind}:${trip.name}:${trip.startDate}:${trip.endDate}`;
}

function routeStorageKey(trip: TripDraft) {
  return `travel-planner:route:${trip.name}`;
}

function flightSearchStorageKey(trip: TripDraft) {
  return `travel-planner:flight-search:${trip.name}`;
}

function readStoredValue<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
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

function FlightSearchPanel({ trip, route }: { trip: TripDraft; route: RoutePlan }) {
  const savedKey = flightSearchStorageKey(trip);
  const [adults, setAdults] = useState(1);
  const [nonStopOnly, setNonStopOnly] = useState(true);
  const [link, setLink] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedFlightSearch[]>([]);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
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
    const frame = window.requestAnimationFrame(() => {
      const stored = readStoredValue<SavedFlightSearch[] | SavedFlightSearch | null>(savedKey, null);
      const legacySearches = stored ? (Array.isArray(stored) ? stored : [stored]) : [];
      const restored = legacySearches.map((search) => ({
        ...search,
        kind: search.kind || (search.returnDate
          ? (search.returnOrigin === search.outboundDestination && search.returnDestination === search.outboundOrigin ? "roundTrip" : "multiCity")
          : "oneWay"),
      } satisfies SavedFlightSearch));
      setSavedSearches(restored);
      if (restored[0]) {
        setAdults(restored[0].adults);
        setNonStopOnly(restored[0].nonStopOnly);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [savedKey]);

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
      setSavedSearches(nextSearches);
      setAdults(next.adults);
      setNonStopOnly(next.nonStopOnly);
      setLink("");
      setError("");
      window.localStorage.setItem(savedKey, JSON.stringify(nextSearches));
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "링크를 가져오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  function clearSavedSearch(search: SavedFlightSearch) {
    const nextSearches = savedSearches.filter((saved) => saved !== search);
    setSavedSearches(nextSearches);
    if (nextSearches.length) window.localStorage.setItem(savedKey, JSON.stringify(nextSearches));
    else window.localStorage.removeItem(savedKey);
  }

  return (
    <section className="flight-search-panel" aria-labelledby="flight-search-heading">
      <div className="flight-search-heading">
        <div>
          <span className="step-label">EXTERNAL SEARCH</span>
          <h4 id="flight-search-heading">Skyscanner 최저가 검색</h4>
        </div>
        <span className="environment-badge environment-production">API 키 불필요</span>
      </div>

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
          <button className="secondary-button compact" type="submit" disabled={importing}>{importing ? "링크 확인 중…" : "링크 가져오기"}</button>
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
              <button className="text-button" type="button" onClick={() => clearSavedSearch(savedSearch)}>삭제</button>
            </div>
          </article>
        );
      })}
      <p className="flight-disclaimer">결과 링크에는 검색 조건만 들어 있으며 개별 항공편·가격 목록은 포함되지 않습니다. 다음 단계에서 선택 항공편을 텍스트나 화면 공유로 가져오는 기능을 추가할 예정입니다.</p>
    </section>
  );
}

function RoutePlanner({ trip }: { trip: TripDraft }) {
  const routeKey = routeStorageKey(trip);
  const legacyRouteKey = storageKey("route", trip);
  const [route, setRoute] = useState<RoutePlan>(EMPTY_ROUTE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const outboundOriginId = useId();
  const outboundDestinationId = useId();
  const returnOriginId = useId();
  const returnDestinationId = useId();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stableRoute = readStoredValue<RoutePlan | null>(routeKey, null);
      const restoredRoute = stableRoute ?? readStoredValue(legacyRouteKey, EMPTY_ROUTE);
      setRoute(restoredRoute);
      if (!stableRoute && restoredRoute !== EMPTY_ROUTE) {
        window.localStorage.setItem(routeKey, JSON.stringify(restoredRoute));
      }
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [legacyRouteKey, routeKey]);

  function update(field: keyof RoutePlan, value: string | boolean) {
    setRoute((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function mirrorRoute() {
    setRoute((current) => ({
      ...current,
      returnOrigin: current.outboundDestination,
      returnDestination: current.outboundOrigin,
    }));
  }

  function confirmRoute(event: FormEvent<HTMLFormElement>) {
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
    setRoute(confirmedRoute);
    window.localStorage.setItem(routeKey, JSON.stringify(confirmedRoute));
  }

  function editRoute() {
    const editable = { ...route, confirmed: false };
    setRoute(editable);
    window.localStorage.setItem(routeKey, JSON.stringify(editable));
  }

  if (!ready) {
    return <div className="workspace-loading" aria-label="항공 구간 불러오는 중" />;
  }

  if (route.confirmed) {
    return (
      <div className="route-confirmed">
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
          <button className="secondary-button compact" type="button" onClick={editRoute}>
            구간 수정
          </button>
        </div>
        <FlightSearchPanel trip={trip} route={route} />
      </div>
    );
  }

  return (
    <form className="route-form" onSubmit={confirmRoute} noValidate>
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
      <button className="primary-button" type="submit">항공 구간 확정하기 <span aria-hidden="true">→</span></button>
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
      </div>
    </article>
  );
}

function SortableScheduleCard({
  item,
  onEdit,
  onDelete,
}: {
  item: ScheduleItem;
  onEdit: (item: ScheduleItem) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <article ref={setNodeRef} style={style} className={`schedule-card ${isDragging ? "is-dragging" : ""}`}>
      <button className="drag-handle" type="button" aria-label={`${item.title} 일정 이동`} {...attributes} {...listeners}>⠿</button>
      <span className={`category-icon category-${item.category}`} aria-hidden="true">{CATEGORY_ICON[item.category]}</span>
      <div className="schedule-card-body">
        <div className="schedule-card-heading">
          <span>{item.time || "시간 미정"} · {item.category}</span>
          <h5>{item.title}</h5>
        </div>
        {item.place ? <p>{item.place}</p> : null}
      </div>
      <div className="schedule-card-actions">
        <button className="icon-button edit-button" type="button" onClick={() => onEdit(item)} aria-label={`${item.title} 수정`} title="일정 수정">✎</button>
        <button className="icon-button" type="button" onClick={() => onDelete(item.id)} aria-label={`${item.title} 삭제`} title="일정 삭제">×</button>
      </div>
    </article>
  );
}

function ScheduleDay({
  date,
  index,
  items,
  collapsed,
  onToggle,
  onEdit,
  onDelete,
}: {
  date: string;
  index: number;
  items: ScheduleItem[];
  collapsed: boolean;
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
            {items.length ? items.map((item) => <SortableScheduleCard item={item} onEdit={onEdit} onDelete={onDelete} key={item.id} />) : (
              <div className="schedule-empty">이 날짜에 첫 일정을 추가해 보세요.</div>
            )}
          </div>
        </SortableContext>
      ) : null}
    </section>
  );
}

function ItineraryPlanner({ trip }: { trip: TripDraft }) {
  const scheduleKey = storageKey("schedule", trip);
  const dates = useMemo(() => getTripDates(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [time, setTime] = useState("");
  const [category, setCategory] = useState<ScheduleCategory>("관광");
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setItems(readStoredValue(scheduleKey, [])));
    return () => window.cancelAnimationFrame(frame);
  }, [scheduleKey]);

  function persist(nextItems: ScheduleItem[]) {
    setItems(nextItems);
    window.localStorage.setItem(scheduleKey, JSON.stringify(nextItems));
  }

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("일정 이름을 입력해 주세요.");
      return;
    }
    const existingItem = editingId ? items.find((item) => item.id === editingId) : undefined;
    const item: ScheduleItem = {
      id: existingItem?.id ?? crypto.randomUUID(),
      date: selectedDate,
      time,
      category,
      title: title.trim(),
      place: place.trim(),
    };
    if (existingItem) {
      const nextItems = existingItem.date === selectedDate
        ? items.map((current) => current.id === existingItem.id ? item : current)
        : [...items.filter((current) => current.id !== existingItem.id), item];
      persist(nextItems);
    } else {
      persist([...items, item]);
    }
    setEditingId(null);
    setTitle("");
    setPlace("");
    setError("");
    setCollapsedDays((current) => {
      const next = new Set(current);
      next.delete(selectedDate);
      return next;
    });
  }

  function deleteSchedule(id: string) {
    if (editingId === id) cancelEdit();
    persist(items.filter((item) => item.id !== id));
  }

  function editSchedule(item: ScheduleItem) {
    setEditingId(item.id);
    setSelectedDate(item.date);
    setTime(item.time);
    setCategory(item.category);
    setTitle(item.title);
    setPlace(item.place);
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
    setEditingId(null);
    setTitle("");
    setPlace("");
    setError("");
  }

  function orderedItems(dayItems: Record<string, ScheduleItem[]>) {
    return dates.flatMap((date) => dayItems[date] ?? []);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItemId(null);
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

    persist(orderedItems(grouped));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveItemId(String(event.active.id));
  }

  return (
    <div className="itinerary-layout">
      <form className="schedule-form" onSubmit={saveSchedule} noValidate>
        <div className="schedule-form-heading">
          <span className="step-label">{editingId ? "EDIT PLAN" : "NEW PLAN"}</span>
          <h4>{editingId ? "일정 수정" : "일정 추가"}</h4>
        </div>
        <div className="schedule-form-grid">
          <div className="field-group"><label htmlFor="schedule-date">날짜</label><select id="schedule-date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{dates.map((date, index) => <option value={date} key={date}>{formatDay(date, index).day} · {formatDay(date, index).label}</option>)}</select></div>
          <div className="field-group"><label htmlFor="schedule-time">시간</label><input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="schedule-category">유형</label><select id="schedule-category" value={category} onChange={(event) => setCategory(event.target.value as ScheduleCategory)}>{Object.keys(CATEGORY_ICON).map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
          <div className="field-group schedule-title-field"><label htmlFor="schedule-title">일정 이름</label><input id="schedule-title" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder="예: 기요미즈데라 산책" /></div>
          <div className="field-group schedule-place-field"><label htmlFor="schedule-place">장소·메모</label><input id="schedule-place" value={place} onChange={(event) => setPlace(event.target.value)} placeholder="주소나 만날 장소" /></div>
        </div>
        {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
        <div className="schedule-form-actions">
          {editingId ? <button className="secondary-button compact" type="button" onClick={cancelEdit}>수정 취소</button> : null}
          <button className="primary-button compact" type="submit">{editingId ? "수정 저장" : "일정 추가"} <span aria-hidden="true">{editingId ? "✓" : "＋"}</span></button>
        </div>
      </form>

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
  );
}

export function TravelWorkspace({ trip }: { trip: TripDraft }) {
  const [tab, setTab] = useState<"route" | "schedule" | "local" | "train">("route");
  const [mobileSection, setMobileSection] = useState<"trip" | "route" | "schedule">("route");

  function changeTab(nextTab: "route" | "schedule" | "local" | "train") {
    setTab(nextTab);
    if (nextTab === "route" || nextTab === "schedule") setMobileSection(nextTab);
  }

  function navigateMobile(target: "trip" | "route" | "schedule") {
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
          <div><span className="eyebrow">BUILD YOUR TRIP</span><h2 id="workspace-title">여행 채우기</h2></div>
          <span className="workspace-trip-name">{trip.name}</span>
        </div>
        <div className="workspace-tabs" role="tablist" aria-label="여행 계획 메뉴">
          <button role="tab" aria-selected={tab === "route"} aria-controls="workspace-panel" className={tab === "route" ? "is-active" : ""} onClick={() => changeTab("route")}>항공 구간</button>
          <button role="tab" aria-selected={tab === "schedule"} aria-controls="workspace-panel" className={tab === "schedule" ? "is-active" : ""} onClick={() => changeTab("schedule")}>날짜별 일정</button>
          <button role="tab" aria-selected={tab === "local"} aria-controls="workspace-panel" className={tab === "local" ? "is-active" : ""} onClick={() => changeTab("local")}>현지 정보</button>
          <button role="tab" aria-selected={tab === "train"} aria-controls="workspace-panel" className={tab === "train" ? "is-active" : ""} onClick={() => changeTab("train")}>신칸센</button>
        </div>
        <div id="workspace-panel" role="tabpanel">{tab === "route" ? <RoutePlanner trip={trip} /> : tab === "schedule" ? <ItineraryPlanner trip={trip} /> : tab === "local" ? <LocalInfoTools trip={trip} /> : <ShinkansenTools trip={trip} />}</div>
      </section>

      <nav className="mobile-nav" aria-label="주요 메뉴">
        <button className={`mobile-nav-item ${mobileSection === "trip" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "trip" ? "page" : undefined} onClick={() => navigateMobile("trip")}>
          <span aria-hidden="true">⌂</span>여행
        </button>
        <button className={`mobile-nav-item ${mobileSection === "schedule" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "schedule" ? "page" : undefined} onClick={() => navigateMobile("schedule")}>
          <span aria-hidden="true">◷</span>일정
        </button>
        <button className={`mobile-nav-item ${mobileSection === "route" ? "is-active" : ""}`} type="button" aria-current={mobileSection === "route" ? "page" : undefined} onClick={() => navigateMobile("route")}>
          <span aria-hidden="true">✈</span>항공
        </button>
      </nav>
    </>
  );
}
