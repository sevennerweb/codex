"use client";

import { FormEvent, useEffect, useState } from "react";
import type { TripDraft } from "@/components/trip-planner";
import { buildNavitimeSearchUrl, navitimeStationName, SHINKANSEN_STATIONS } from "@/lib/navitime-links";

type SavedVideo = { id: string; videoId: string; title: string; url: string };
type PlaceResult = { id: number; name: string; region: string; latitude: number; longitude: number };
type WeatherPayload = { daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] } };
type SavedWeather = { place: PlaceResult; weather: WeatherPayload; fetchedAt: string };
type TrainPlan = { id: string; date: string; origin: string; destination: string; time: string; searchUrl?: string; train?: string; seat?: string };

function key(kind: string, trip: TripDraft) {
  return `travel-planner:${kind}:${trip.name}:${trip.startDate}:${trip.endDate}`;
}

function load<T>(storageKey: string, fallback: T): T {
  try {
    const value = localStorage.getItem(storageKey);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function youtubeId(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
    if (host === "youtube.com" || host === "m.youtube.com") {
      id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|live|shorts)\/([^/?]+)/)?.[1] ?? "";
    }
    return /^[\w-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const WEATHER: Record<number, { icon: string; label: string }> = {
  0: { icon: "☀", label: "맑음" }, 1: { icon: "◐", label: "대체로 맑음" }, 2: { icon: "◒", label: "구름 조금" }, 3: { icon: "☁", label: "흐림" },
  45: { icon: "≋", label: "안개" }, 48: { icon: "≋", label: "서리 안개" }, 51: { icon: "⌁", label: "약한 이슬비" }, 53: { icon: "⌁", label: "이슬비" },
  55: { icon: "⌁", label: "강한 이슬비" }, 61: { icon: "☂", label: "약한 비" }, 63: { icon: "☂", label: "비" }, 65: { icon: "☂", label: "강한 비" },
  71: { icon: "❄", label: "약한 눈" }, 73: { icon: "❄", label: "눈" }, 75: { icon: "❄", label: "강한 눈" }, 80: { icon: "☂", label: "소나기" }, 95: { icon: "ϟ", label: "뇌우" },
};

export function LocalInfoTools({ trip }: { trip: TripDraft }) {
  const videoKey = key("videos", trip);
  const weatherKey = key("weather", trip);
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [videoFormOpen, setVideoFormOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoError, setVideoError] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [weatherFetchedAt, setWeatherFetchedAt] = useState("");
  const [weatherSaved, setWeatherSaved] = useState(false);
  const [weatherNotice, setWeatherNotice] = useState("");
  const [weatherState, setWeatherState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setVideos(load(videoKey, []));
      const saved = load<SavedWeather | null>(weatherKey, null);
      if (saved?.place && saved.weather && saved.fetchedAt) {
        setSelectedPlace(saved.place);
        setCityQuery(saved.place.name);
        setWeather(saved.weather);
        setWeatherFetchedAt(saved.fetchedAt);
        setWeatherSaved(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [videoKey, weatherKey]);

  function saveVideos(next: SavedVideo[]) {
    setVideos(next);
    localStorage.setItem(videoKey, JSON.stringify(next));
  }

  function toggleVideoForm() {
    setVideoFormOpen((current) => !current);
    setVideoError("");
  }

  function addVideo(event: FormEvent) {
    event.preventDefault();
    const id = youtubeId(videoUrl);
    if (!id) {
      setVideoError("올바른 YouTube 영상 또는 라이브 URL을 입력해 주세요.");
      return;
    }
    if (videos.some((video) => video.videoId === id)) {
      setVideoError("이미 추가한 영상입니다.");
      return;
    }
    saveVideos([...videos, { id: crypto.randomUUID(), videoId: id, title: videoTitle.trim() || "여행지 라이브", url: videoUrl }]);
    setVideoUrl("");
    setVideoTitle("");
    setVideoError("");
    setVideoFormOpen(false);
  }

  async function searchCity(event: FormEvent) {
    event.preventDefault();
    setWeatherState("loading");
    setPlaces([]);
    setSelectedPlace(null);
    setWeather(null);
    setWeatherSaved(false);
    setWeatherNotice("");
    try {
      const response = await fetch(`/api/places?q=${encodeURIComponent(cityQuery)}`);
      const data = await response.json() as { results?: PlaceResult[] };
      if (!response.ok || !data.results) throw new Error();
      setPlaces(data.results);
      setWeatherState("idle");
    } catch {
      setWeatherState("error");
    }
  }

  async function requestWeather(place: PlaceResult, persist: boolean) {
    setSelectedPlace(place);
    setWeatherState("loading");
    setWeatherNotice("");
    try {
      const response = await fetch(`/api/weather?lat=${place.latitude}&lon=${place.longitude}`);
      const data = await response.json() as WeatherPayload;
      if (!response.ok || !data.daily) throw new Error();
      const fetchedAt = new Date().toISOString();
      setWeather(data);
      setWeatherFetchedAt(fetchedAt);
      setWeatherState("idle");
      setPlaces([]);
      if (persist) {
        localStorage.setItem(weatherKey, JSON.stringify({ place, weather: data, fetchedAt } satisfies SavedWeather));
        setWeatherSaved(true);
        setWeatherNotice("저장된 날씨를 최신 예보로 업데이트했습니다.");
      } else {
        setWeatherSaved(false);
        setWeatherNotice("최신 예보를 불러왔습니다. 필요하면 여행에 저장해 주세요.");
      }
    } catch {
      setWeatherState("error");
    }
  }

  function saveWeather() {
    if (!selectedPlace || !weather || !weatherFetchedAt) return;
    localStorage.setItem(weatherKey, JSON.stringify({ place: selectedPlace, weather, fetchedAt: weatherFetchedAt } satisfies SavedWeather));
    setWeatherSaved(true);
    setWeatherNotice("날씨 정보를 이 여행에 저장했습니다.");
  }

  const forecast = weather?.daily?.time.map((date, index) => ({
    date,
    code: weather.daily!.weather_code[index],
    max: weather.daily!.temperature_2m_max[index],
    min: weather.daily!.temperature_2m_min[index],
    rain: weather.daily!.precipitation_probability_max[index],
  })).filter((day) => day.date >= trip.startDate && day.date <= trip.endDate) ?? [];

  return (
    <div className="tools-grid">
      <section className="tool-section">
        <div className="tool-heading tool-heading-with-action">
          <div><span className="step-label">LIVE VIEW</span><h4>YouTube 현지 영상</h4></div>
          <button className="secondary-button compact" type="button" aria-expanded={videoFormOpen} aria-controls="video-add-form" onClick={toggleVideoForm}>
            {videoFormOpen ? "취소" : "영상 추가"}<span aria-hidden="true">{videoFormOpen ? "×" : "＋"}</span>
          </button>
        </div>
        {videoFormOpen ? (
          <form className="tool-form" id="video-add-form" onSubmit={addVideo}>
            <div className="field-group"><label htmlFor="video-title">영상 이름</label><input id="video-title" value={videoTitle} onChange={(event) => setVideoTitle(event.target.value)} placeholder="예: 교토역 라이브" /></div>
            <div className="field-group"><label htmlFor="video-url">YouTube URL</label><input id="video-url" inputMode="url" value={videoUrl} onChange={(event) => { setVideoUrl(event.target.value); setVideoError(""); }} placeholder="https://youtube.com/watch?v=..." /></div>
            {videoError ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{videoError}</p> : null}
            <button className="primary-button compact" type="submit">저장 <span aria-hidden="true">＋</span></button>
          </form>
        ) : null}
        <div className="video-list">
          {videos.length ? videos.map((video) => (
            <article className="video-card" key={video.id}>
              <div className="video-frame"><iframe src={`https://www.youtube.com/embed/${video.videoId}`} title={video.title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
              <div><strong>{video.title}</strong><button type="button" className="text-button" onClick={() => saveVideos(videos.filter((item) => item.id !== video.id))}>삭제</button></div>
            </article>
          )) : <p className="tool-empty">여행지의 현재 모습을 볼 영상을 추가해 보세요.</p>}
        </div>
      </section>

      <section className="tool-section">
        <div className="tool-heading"><span className="step-label">FORECAST</span><h4>여행지 날씨</h4></div>
        <form className="city-search" onSubmit={searchCity}>
          <label className="sr-only" htmlFor="city-query">도시 검색</label>
          <input id="city-query" value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="예: 교토, 오사카" minLength={2} required />
          <button type="submit">검색</button>
        </form>
        {weatherState === "loading" ? <p className="tool-empty" aria-live="polite">정보를 불러오는 중입니다…</p> : null}
        {weatherState === "error" ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>날씨 정보를 불러오지 못했습니다.</p> : null}
        {places.length ? <><div className="place-results">{places.map((place) => <button type="button" key={place.id} onClick={() => void requestWeather(place, false)}><strong>{place.name}</strong><span>{place.region}</span></button>)}</div><a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></> : null}
        {selectedPlace && weather ? (
          <div className="weather-result">
            <div className="weather-result-heading">
              <p><strong>{selectedPlace.name}</strong>의 여행 기간 예보<small>{weatherFetchedAt ? `${formatUpdatedAt(weatherFetchedAt)} 확인` : ""}</small></p>
              <div className="weather-actions">
                <button className="secondary-button compact" type="button" onClick={saveWeather} disabled={weatherSaved}>{weatherSaved ? "저장됨" : "날씨 저장"}</button>
                <button className="secondary-button compact" type="button" onClick={() => void requestWeather(selectedPlace, weatherSaved)} disabled={weatherState === "loading"}>새로고침</button>
              </div>
            </div>
            {weatherNotice ? <p className="weather-notice" role="status">{weatherNotice}</p> : null}
            {forecast.length ? <div className="weather-days">{forecast.map((day) => { const state = WEATHER[day.code] ?? { icon: "·", label: "변화 가능" }; return <article key={day.date}><time>{day.date.slice(5).replace("-", ".")}</time><span className="weather-icon" title={state.label}>{state.icon}</span><strong>{Math.round(day.max)}° / {Math.round(day.min)}°</strong><small>강수 {day.rain ?? 0}%</small></article>; })}</div> : <p className="tool-empty">아직 여행 날짜의 예보가 제공되지 않습니다. 출발이 가까워지면 다시 확인해 주세요.</p>}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function ShinkansenTools({ trip }: { trip: TripDraft }) {
  const trainKey = key("trains", trip);
  const [plans, setPlans] = useState<TrainPlan[]>([]);
  const [date, setDate] = useState(trip.startDate);
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const searchUrl = buildNavitimeSearchUrl(originId, destinationId, date, time);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setPlans(load(trainKey, [])));
    return () => cancelAnimationFrame(frame);
  }, [trainKey]);

  function save(next: TrainPlan[]) {
    setPlans(next);
    localStorage.setItem(trainKey, JSON.stringify(next));
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const origin = navitimeStationName(originId);
    const destination = navitimeStationName(destinationId);
    if (!origin || !destination || originId === destinationId || !searchUrl) {
      setError("서로 다른 출발역과 도착역, 탑승일과 시간을 모두 선택해 주세요.");
      return;
    }
    save([...plans, { id: crypto.randomUUID(), date, origin, destination, time, searchUrl }]);
    setError("");
  }

  return (
    <div className="train-layout">
      <section className="tool-section">
        <div className="tool-heading"><span className="step-label">SHINKANSEN</span><h4>신칸센 좌석 계획</h4></div>
        <p className="tool-description">역과 탑승 시간을 선택하면 NAVITIME에서 해당 조건의 열차·시간표·요금을 바로 검색할 수 있습니다.</p>
        <form className="train-form" onSubmit={add}>
          <div className="field-group"><label htmlFor="train-date">탑승일</label><input id="train-date" type="date" min={trip.startDate} max={trip.endDate} value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <div className="field-group"><label htmlFor="train-time">시간</label><input id="train-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div>
          <div className="field-group train-station-field"><label htmlFor="train-origin">출발역</label><select id="train-origin" value={originId} onChange={(event) => { setOriginId(event.target.value); setError(""); }}><option value="">출발역 선택</option>{SHINKANSEN_STATIONS.map((station) => <option value={station.id} key={station.id}>{station.name} · {station.region}</option>)}</select></div>
          <div className="field-group train-station-field"><label htmlFor="train-destination">도착역</label><select id="train-destination" value={destinationId} onChange={(event) => { setDestinationId(event.target.value); setError(""); }}><option value="">도착역 선택</option>{SHINKANSEN_STATIONS.map((station) => <option value={station.id} key={station.id}>{station.name} · {station.region}</option>)}</select></div>
          {error ? <p className="form-error" role="alert"><span aria-hidden="true">!</span>{error}</p> : null}
          <p className="train-provider-note">계획을 저장하면 동일한 조건의 NAVITIME 검색 링크도 함께 저장됩니다.</p>
          <div className="train-actions">{searchUrl ? <a className="secondary-link" href={searchUrl} target="_blank" rel="noreferrer">NAVITIME에서 검색 ↗</a> : <span className="secondary-link is-disabled" aria-disabled="true">역·날짜·시간을 선택하세요</span>}<button className="primary-button compact" type="submit">계획 저장 <span aria-hidden="true">＋</span></button></div>
        </form>
      </section>
      <section className="train-plans">
        {plans.length ? plans.map((plan) => <article className="train-card" key={plan.id}><div><time>{plan.date} {plan.time}</time><strong>{plan.origin} <span>→</span> {plan.destination}</strong><p>{[plan.train, plan.seat].filter(Boolean).join(" · ") || "NAVITIME 검색 조건 저장됨"}</p></div><div className="train-card-actions">{plan.searchUrl ? <a className="train-result-link" href={plan.searchUrl} target="_blank" rel="noreferrer">다시 검색</a> : null}<button className="icon-button" type="button" aria-label={`${plan.origin}에서 ${plan.destination} 계획 삭제`} onClick={() => save(plans.filter((item) => item.id !== plan.id))}>×</button></div></article>) : <p className="tool-empty">저장된 신칸센 계획이 없습니다.</p>}
      </section>
    </div>
  );
}
