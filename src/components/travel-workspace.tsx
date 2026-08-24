"use client";

import {
  DndContext,
  DragEndEvent,
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
import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import type { TripDraft } from "@/components/trip-planner";
import { LocalInfoTools, ShinkansenTools } from "@/components/trip-tools";

const AIRPORTS = [
  { code: "ICN", name: "인천국제공항", city: "서울" },
  { code: "GMP", name: "김포국제공항", city: "서울" },
  { code: "PUS", name: "김해국제공항", city: "부산" },
  { code: "CJU", name: "제주국제공항", city: "제주" },
  { code: "NRT", name: "나리타국제공항", city: "도쿄" },
  { code: "HND", name: "하네다공항", city: "도쿄" },
  { code: "KIX", name: "간사이국제공항", city: "오사카" },
  { code: "ITM", name: "오사카국제공항", city: "오사카" },
  { code: "NGO", name: "주부국제공항", city: "나고야" },
  { code: "FSZ", name: "후지산 시즈오카공항", city: "시즈오카" },
  { code: "FUK", name: "후쿠오카공항", city: "후쿠오카" },
  { code: "CTS", name: "신치토세공항", city: "삿포로" },
  { code: "OKA", name: "나하공항", city: "오키나와" },
];

const AIRPORT_OPTIONS = AIRPORTS.map(
  (airport) => `${airport.code} — ${airport.name} (${airport.city})`,
);

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
  const query = value.trim().toLocaleLowerCase("ko-KR");
  const prefixedCode = query.slice(0, 3).toUpperCase();
  if (AIRPORTS.some((airport) => airport.code === prefixedCode)) return prefixedCode;

  const matches = AIRPORTS.filter((airport) =>
    airport.name.toLocaleLowerCase("ko-KR").includes(query) ||
    airport.city.toLocaleLowerCase("ko-KR").includes(query),
  );
  return query && matches.length === 1 ? matches[0].code : "";
}

function airportLabel(code: string) {
  const airport = AIRPORTS.find((candidate) => candidate.code === code);
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
  return (
    <div className="field-group airport-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        list="airport-options"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="공항명 또는 코드"
        autoComplete="off"
      />
    </div>
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
          <button className="primary-button compact" type="button" disabled title="항공 API 연결 후 활성화됩니다">
            최저가 검색 준비 중
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="route-form" onSubmit={confirmRoute} noValidate>
      <datalist id="airport-options">
        {AIRPORT_OPTIONS.map((option) => <option value={option} key={option} />)}
      </datalist>

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
    </form>
  );
}

function SortableScheduleCard({ item, onDelete }: { item: ScheduleItem; onDelete: (id: string) => void }) {
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
      <button className="icon-button" type="button" onClick={() => onDelete(item.id)} aria-label={`${item.title} 삭제`}>×</button>
    </article>
  );
}

function ScheduleDay({
  date,
  index,
  items,
  collapsed,
  onToggle,
  onDelete,
}: {
  date: string;
  index: number;
  items: ScheduleItem[];
  collapsed: boolean;
  onToggle: () => void;
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
            {items.length ? items.map((item) => <SortableScheduleCard item={item} onDelete={onDelete} key={item.id} />) : (
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

  function addSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("일정 이름을 입력해 주세요.");
      return;
    }
    const item: ScheduleItem = {
      id: crypto.randomUUID(),
      date: selectedDate,
      time,
      category,
      title: title.trim(),
      place: place.trim(),
    };
    persist([...items, item]);
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
    persist(items.filter((item) => item.id !== id));
  }

  function orderedItems(dayItems: Record<string, ScheduleItem[]>) {
    return dates.flatMap((date) => dayItems[date] ?? []);
  }

  function handleDragEnd(event: DragEndEvent) {
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

  return (
    <div className="itinerary-layout">
      <form className="schedule-form" onSubmit={addSchedule} noValidate>
        <div className="schedule-form-heading">
          <span className="step-label">NEW PLAN</span>
          <h4>일정 추가</h4>
        </div>
        <div className="schedule-form-grid">
          <div className="field-group"><label htmlFor="schedule-date">날짜</label><select id="schedule-date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{dates.map((date, index) => <option value={date} key={date}>{formatDay(date, index).day} · {formatDay(date, index).label}</option>)}</select></div>
          <div className="field-group"><label htmlFor="schedule-time">시간</label><input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="schedule-category">유형</label><select id="schedule-category" value={category} onChange={(event) => setCategory(event.target.value as ScheduleCategory)}>{Object.keys(CATEGORY_ICON).map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
          <div className="field-group schedule-title-field"><label htmlFor="schedule-title">일정 이름</label><input id="schedule-title" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder="예: 기요미즈데라 산책" /></div>
          <div className="field-group schedule-place-field"><label htmlFor="schedule-place">장소·메모</label><input id="schedule-place" value={place} onChange={(event) => setPlace(event.target.value)} placeholder="주소나 만날 장소" /></div>
        </div>
        {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
        <button className="primary-button compact" type="submit">일정 추가 <span aria-hidden="true">＋</span></button>
      </form>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
              onDelete={deleteSchedule}
              key={date}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

export function TravelWorkspace({ trip }: { trip: TripDraft }) {
  const [tab, setTab] = useState<"route" | "schedule" | "local" | "train">("route");

  return (
    <section className="workspace-card" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">BUILD YOUR TRIP</span><h2 id="workspace-title">여행 채우기</h2></div>
        <span className="workspace-trip-name">{trip.name}</span>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="여행 계획 메뉴">
        <button role="tab" aria-selected={tab === "route"} className={tab === "route" ? "is-active" : ""} onClick={() => setTab("route")}>항공 구간</button>
        <button role="tab" aria-selected={tab === "schedule"} className={tab === "schedule" ? "is-active" : ""} onClick={() => setTab("schedule")}>날짜별 일정</button>
        <button role="tab" aria-selected={tab === "local"} className={tab === "local" ? "is-active" : ""} onClick={() => setTab("local")}>현지 정보</button>
        <button role="tab" aria-selected={tab === "train"} className={tab === "train" ? "is-active" : ""} onClick={() => setTab("train")}>신칸센</button>
      </div>
      <div role="tabpanel">{tab === "route" ? <RoutePlanner trip={trip} /> : tab === "schedule" ? <ItineraryPlanner trip={trip} /> : tab === "local" ? <LocalInfoTools trip={trip} /> : <ShinkansenTools trip={trip} />}</div>
    </section>
  );
}
