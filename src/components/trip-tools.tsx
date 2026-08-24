"use client";

import { FormEvent, useEffect, useState } from "react";
import type { TripDraft } from "@/components/trip-planner";

type SavedVideo = { id: string; videoId: string; title: string; url: string };
type PlaceResult = { id: number; name: string; region: string; latitude: number; longitude: number };
type WeatherPayload = { daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] } };
type TrainPlan = { id: string; date: string; origin: string; destination: string; train: string; time: string; seat: string };

function key(kind: string, trip: TripDraft) {
  return `travel-planner:${kind}:${trip.name}:${trip.startDate}:${trip.endDate}`;
}

function load<T>(storageKey: string, fallback: T): T {
  try { const value = localStorage.getItem(storageKey); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
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
  } catch { return ""; }
}

const WEATHER: Record<number, { icon: string; label: string }> = {
  0: { icon: "☀", label: "맑음" }, 1: { icon: "◐", label: "대체로 맑음" }, 2: { icon: "◒", label: "구름 조금" }, 3: { icon: "☁", label: "흐림" },
  45: { icon: "≋", label: "안개" }, 48: { icon: "≋", label: "서리 안개" }, 51: { icon: "⌁", label: "약한 이슬비" }, 53: { icon: "⌁", label: "이슬비" },
  55: { icon: "⌁", label: "강한 이슬비" }, 61: { icon: "☂", label: "약한 비" }, 63: { icon: "☂", label: "비" }, 65: { icon: "☂", label: "강한 비" },
  71: { icon: "❄", label: "약한 눈" }, 73: { icon: "❄", label: "눈" }, 75: { icon: "❄", label: "강한 눈" }, 80: { icon: "☂", label: "소나기" }, 95: { icon: "ϟ", label: "뇌우" },
};

export function LocalInfoTools({ trip }: { trip: TripDraft }) {
  const videoKey = key("videos", trip);
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoError, setVideoError] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [weatherState, setWeatherState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => { const frame = requestAnimationFrame(() => setVideos(load(videoKey, []))); return () => cancelAnimationFrame(frame); }, [videoKey]);

  function saveVideos(next: SavedVideo[]) { setVideos(next); localStorage.setItem(videoKey, JSON.stringify(next)); }
  function addVideo(event: FormEvent) {
    event.preventDefault(); const id = youtubeId(videoUrl);
    if (!id) { setVideoError("올바른 YouTube 영상 또는 라이브 URL을 입력해 주세요."); return; }
    if (videos.some((video) => video.videoId === id)) { setVideoError("이미 추가한 영상입니다."); return; }
    saveVideos([...videos, { id: crypto.randomUUID(), videoId: id, title: videoTitle.trim() || "여행지 라이브", url: videoUrl }]);
    setVideoUrl(""); setVideoTitle(""); setVideoError("");
  }

  async function searchCity(event: FormEvent) {
    event.preventDefault(); setWeatherState("loading"); setPlaces([]); setWeather(null);
    try { const response = await fetch(`/api/places?q=${encodeURIComponent(cityQuery)}`); const data = await response.json(); if (!response.ok) throw new Error(); setPlaces(data.results); setWeatherState("idle"); }
    catch { setWeatherState("error"); }
  }

  async function choosePlace(place: PlaceResult) {
    setSelectedPlace(place); setWeatherState("loading");
    try { const response = await fetch(`/api/weather?lat=${place.latitude}&lon=${place.longitude}`); const data = await response.json(); if (!response.ok) throw new Error(); setWeather(data); setWeatherState("idle"); }
    catch { setWeatherState("error"); }
  }

  const forecast = weather?.daily?.time.map((date, index) => ({ date, code: weather.daily!.weather_code[index], max: weather.daily!.temperature_2m_max[index], min: weather.daily!.temperature_2m_min[index], rain: weather.daily!.precipitation_probability_max[index] })).filter((day) => day.date >= trip.startDate && day.date <= trip.endDate) ?? [];

  return <div className="tools-grid">
    <section className="tool-section"><div className="tool-heading"><span className="step-label">LIVE VIEW</span><h4>YouTube 현지 영상</h4></div>
      <form className="tool-form" onSubmit={addVideo}><div className="field-group"><label htmlFor="video-title">영상 이름</label><input id="video-title" value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} placeholder="예: 교토역 라이브" /></div><div className="field-group"><label htmlFor="video-url">YouTube URL</label><input id="video-url" inputMode="url" value={videoUrl} onChange={(e) => { setVideoUrl(e.target.value); setVideoError(""); }} placeholder="https://youtube.com/watch?v=..." /></div>{videoError ? <p className="form-error" role="alert"><span>!</span>{videoError}</p> : null}<button className="primary-button compact" type="submit">영상 추가 <span>＋</span></button></form>
      <div className="video-list">{videos.length ? videos.map((video) => <article className="video-card" key={video.id}><div className="video-frame"><iframe src={`https://www.youtube.com/embed/${video.videoId}`} title={video.title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div><div><strong>{video.title}</strong><button type="button" className="text-button" onClick={() => saveVideos(videos.filter((item) => item.id !== video.id))}>삭제</button></div></article>) : <p className="tool-empty">여행지의 현재 모습을 볼 영상을 추가해 보세요.</p>}</div>
    </section>
    <section className="tool-section"><div className="tool-heading"><span className="step-label">FORECAST</span><h4>여행지 날씨</h4></div>
      <form className="city-search" onSubmit={searchCity}><label className="sr-only" htmlFor="city-query">도시 검색</label><input id="city-query" value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} placeholder="예: 교토, 오사카" minLength={2} required /><button type="submit">검색</button></form>
      {weatherState === "loading" ? <p className="tool-empty">정보를 불러오는 중입니다…</p> : null}{weatherState === "error" ? <p className="form-error" role="alert"><span>!</span>날씨 정보를 불러오지 못했습니다.</p> : null}
      {places.length ? <><div className="place-results">{places.map((place) => <button type="button" key={place.id} onClick={() => choosePlace(place)}><strong>{place.name}</strong><span>{place.region}</span></button>)}</div><a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></> : null}
      {selectedPlace && weather ? <div className="weather-result"><p><strong>{selectedPlace.name}</strong>의 여행 기간 예보</p>{forecast.length ? <div className="weather-days">{forecast.map((day) => { const state = WEATHER[day.code] ?? { icon: "·", label: "변화 가능" }; return <article key={day.date}><time>{day.date.slice(5).replace("-", ".")}</time><span className="weather-icon" title={state.label}>{state.icon}</span><strong>{Math.round(day.max)}° / {Math.round(day.min)}°</strong><small>강수 {day.rain ?? 0}%</small></article>; })}</div> : <p className="tool-empty">아직 여행 날짜의 예보가 제공되지 않습니다. 출발이 가까워지면 다시 확인해 주세요.</p>}</div> : null}
    </section>
  </div>;
}

export function ShinkansenTools({ trip }: { trip: TripDraft }) {
  const trainKey = key("trains", trip); const [plans, setPlans] = useState<TrainPlan[]>([]);
  const [date, setDate] = useState(trip.startDate); const [origin, setOrigin] = useState(""); const [destination, setDestination] = useState(""); const [train, setTrain] = useState(""); const [time, setTime] = useState(""); const [seat, setSeat] = useState(""); const [error, setError] = useState("");
  useEffect(() => { const frame = requestAnimationFrame(() => setPlans(load(trainKey, []))); return () => cancelAnimationFrame(frame); }, [trainKey]);
  function save(next: TrainPlan[]) { setPlans(next); localStorage.setItem(trainKey, JSON.stringify(next)); }
  function add(event: FormEvent) { event.preventDefault(); if (!origin.trim() || !destination.trim()) { setError("출발역과 도착역을 입력해 주세요."); return; } save([...plans, { id: crypto.randomUUID(), date, origin: origin.trim(), destination: destination.trim(), train: train.trim(), time, seat: seat.trim() }]); setTrain(""); setSeat(""); setError(""); }
  return <div className="train-layout"><section className="tool-section"><div className="tool-heading"><span className="step-label">SHINKANSEN</span><h4>신칸센 좌석 계획</h4></div><p className="tool-description">검색 조건을 저장한 뒤 SmartEX 공식 사이트에서 좌석 현황을 확인하세요.</p><form className="train-form" onSubmit={add}><div className="field-group"><label htmlFor="train-date">탑승일</label><input id="train-date" type="date" min={trip.startDate} max={trip.endDate} value={date} onChange={(e) => setDate(e.target.value)} /></div><div className="field-group"><label htmlFor="train-time">시간</label><input id="train-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div><div className="field-group"><label htmlFor="train-origin">출발역</label><input id="train-origin" value={origin} onChange={(e) => { setOrigin(e.target.value); setError(""); }} placeholder="예: 도쿄" /></div><div className="field-group"><label htmlFor="train-destination">도착역</label><input id="train-destination" value={destination} onChange={(e) => { setDestination(e.target.value); setError(""); }} placeholder="예: 교토" /></div><div className="field-group"><label htmlFor="train-name">열차명·번호</label><input id="train-name" value={train} onChange={(e) => setTrain(e.target.value)} placeholder="예: 노조미 215호" /></div><div className="field-group"><label htmlFor="train-seat">차량·좌석</label><input id="train-seat" value={seat} onChange={(e) => setSeat(e.target.value)} placeholder="예: 8호차 12A" /></div>{error ? <p className="form-error" role="alert"><span>!</span>{error}</p> : null}<div className="train-actions"><a className="secondary-link" href="https://smart-ex.jp/en/index.php" target="_blank" rel="noreferrer">SmartEX에서 좌석 확인 ↗</a><button className="primary-button compact" type="submit">계획 저장 <span>＋</span></button></div></form></section>
    <section className="train-plans">{plans.length ? plans.map((plan) => <article className="train-card" key={plan.id}><div><time>{plan.date} {plan.time}</time><strong>{plan.origin} <span>→</span> {plan.destination}</strong><p>{[plan.train, plan.seat].filter(Boolean).join(" · ") || "열차와 좌석 미정"}</p></div><button className="icon-button" type="button" aria-label={`${plan.origin}에서 ${plan.destination} 계획 삭제`} onClick={() => save(plans.filter((item) => item.id !== plan.id))}>×</button></article>) : <p className="tool-empty">저장된 신칸센 계획이 없습니다.</p>}</section></div>;
}
