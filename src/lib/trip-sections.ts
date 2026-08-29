export type RoutePlan = {
  outboundOrigin: string;
  outboundDestination: string;
  returnOrigin: string;
  returnDestination: string;
  confirmed: boolean;
};

export const SCHEDULE_CATEGORIES = ["관광", "숙소", "식사", "교통", "기타"] as const;

export type ScheduleCategory = (typeof SCHEDULE_CATEGORIES)[number];

export type ScheduleItem = {
  id: string;
  date: string;
  time: string;
  category: ScheduleCategory;
  title: string;
  place: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  mapUrl?: string;
  note?: string;
  checkInTime?: string;
  checkOutTime?: string;
};

export type PlaceSnapshot = {
  id: number;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
};

export type WeatherPayload = {
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
};

export type SavedWeather = { place: PlaceSnapshot; weather: WeatherPayload; fetchedAt: string };
export type SavedVideo = { id: string; videoId: string; title: string; url: string };
export type LocalInfoData = { videos: SavedVideo[]; weather: SavedWeather | null };
export type TrainPlan = { id: string; date: string; origin: string; destination: string; time: string; searchUrl?: string };

export type SelectedFlight = {
  id: string;
  direction: "outbound" | "return";
  carrier: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  priceKrw?: number;
  sourceText?: string;
  confirmedAt: string;
};

export type TripSectionName = "route" | "schedule" | "flightSearch" | "selectedFlights" | "localInfo" | "train";

export type StoredTripSection<T> = {
  data: T;
  version: number;
  updatedAt: string;
};

export function normalizeRoutePlan(value: unknown): RoutePlan | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const codes = {
    outboundOrigin: typeof input.outboundOrigin === "string" ? input.outboundOrigin.trim().toUpperCase() : "",
    outboundDestination: typeof input.outboundDestination === "string" ? input.outboundDestination.trim().toUpperCase() : "",
    returnOrigin: typeof input.returnOrigin === "string" ? input.returnOrigin.trim().toUpperCase() : "",
    returnDestination: typeof input.returnDestination === "string" ? input.returnDestination.trim().toUpperCase() : "",
  };
  if (Object.values(codes).some((code) => !/^[A-Z]{3}$/.test(code))) return null;
  if (codes.outboundOrigin === codes.outboundDestination || codes.returnOrigin === codes.returnDestination) return null;
  if (typeof input.confirmed !== "boolean") return null;
  return { ...codes, confirmed: input.confirmed };
}

export function googleMapsSearchUrl(latitude: number, longitude: number) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${latitude},${longitude}`);
  return url.toString();
}

export function openStreetMapUrl(latitude: number, longitude: number) {
  const url = new URL("https://www.openstreetmap.org/");
  url.searchParams.set("mlat", String(latitude));
  url.searchParams.set("mlon", String(longitude));
  url.hash = `map=16/${latitude}/${longitude}`;
  return url.toString();
}

export function googleMapsDirectionsUrl(points: Array<{ latitude: number; longitude: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return googleMapsSearchUrl(points[0].latitude, points[0].longitude);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${points[0].latitude},${points[0].longitude}`);
  url.searchParams.set("destination", `${points.at(-1)!.latitude},${points.at(-1)!.longitude}`);
  if (points.length > 2) {
    url.searchParams.set("waypoints", points.slice(1, -1).map((point) => `${point.latitude},${point.longitude}`).join("|"));
  }
  return url.toString();
}

export function normalizeGoogleMapsUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const isGoogleMapsHost = hostname === "maps.app.goo.gl"
      || (hostname === "goo.gl" && url.pathname.startsWith("/maps"))
      || (/^(?:maps\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2})$/u.test(hostname) && url.pathname.startsWith("/maps"));
    return url.protocol === "https:" && isGoogleMapsHost && url.toString().length <= 2_048 ? url.toString() : "";
  } catch {
    return "";
  }
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function youtubeVideoId(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
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

function finiteNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function normalizePlaceSnapshot(value: unknown): PlaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = finiteNumber(input.id, 0, Number.MAX_SAFE_INTEGER);
  const name = optionalText(input.name, 200);
  const region = optionalText(input.region, 500);
  const latitude = finiteNumber(input.latitude, -90, 90);
  const longitude = finiteNumber(input.longitude, -180, 180);
  if (id === null || !name || region === null || latitude === null || longitude === null) return null;
  return { id, name, region: region ?? "", latitude, longitude };
}

function normalizeWeatherPayload(value: unknown): WeatherPayload | null {
  if (!value || typeof value !== "object") return null;
  const daily = (value as Record<string, unknown>).daily;
  if (!daily || typeof daily !== "object") return null;
  const input = daily as Record<string, unknown>;
  const time = input.time;
  const weatherCode = input.weather_code;
  const maximum = input.temperature_2m_max;
  const minimum = input.temperature_2m_min;
  const rain = input.precipitation_probability_max;
  if (!Array.isArray(time) || !Array.isArray(weatherCode) || !Array.isArray(maximum) || !Array.isArray(minimum) || !Array.isArray(rain)) return null;
  const length = time.length;
  if (!length || length > 32 || [weatherCode, maximum, minimum, rain].some((values) => values.length !== length)) return null;
  if (!time.every((date) => typeof date === "string" && isCalendarDate(date))) return null;
  if (!weatherCode.every((code) => Number.isInteger(code) && code >= 0 && code <= 99)) return null;
  if (![maximum, minimum].every((values) => values.every((temperature) => finiteNumber(temperature, -100, 100) !== null))) return null;
  if (!rain.every((chance) => finiteNumber(chance, 0, 100) !== null)) return null;
  return {
    daily: {
      time: [...time] as string[],
      weather_code: [...weatherCode] as number[],
      temperature_2m_max: [...maximum] as number[],
      temperature_2m_min: [...minimum] as number[],
      precipitation_probability_max: [...rain] as number[],
    },
  };
}

export function normalizeLocalInfoData(value: unknown): LocalInfoData | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.videos) || input.videos.length > 20) return null;
  const videos: SavedVideo[] = [];
  const videoIds = new Set<string>();
  for (const candidate of input.videos) {
    if (!candidate || typeof candidate !== "object") return null;
    const video = candidate as Record<string, unknown>;
    const id = optionalText(video.id, 100);
    const title = optionalText(video.title, 120);
    const url = optionalText(video.url, 2_048);
    const videoId = url ? youtubeVideoId(url) : "";
    if (!id || !title || !url || !videoId || video.videoId !== videoId || videoIds.has(videoId)) return null;
    videoIds.add(videoId);
    videos.push({ id, videoId, title, url });
  }

  if (input.weather === null || input.weather === undefined) return { videos, weather: null };
  if (typeof input.weather !== "object") return null;
  const weatherInput = input.weather as Record<string, unknown>;
  const place = normalizePlaceSnapshot(weatherInput.place);
  const weather = normalizeWeatherPayload(weatherInput.weather);
  const fetchedAt = typeof weatherInput.fetchedAt === "string" ? weatherInput.fetchedAt : "";
  if (!place || !weather || !fetchedAt || Number.isNaN(Date.parse(fetchedAt))) return null;
  return { videos, weather: { place, weather, fetchedAt: new Date(fetchedAt).toISOString() } };
}

export function normalizeTrainPlans(value: unknown): TrainPlan[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const plans: TrainPlan[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const input = candidate as Record<string, unknown>;
    const id = optionalText(input.id, 100);
    const origin = optionalText(input.origin, 100);
    const destination = optionalText(input.destination, 100);
    const date = typeof input.date === "string" ? input.date : "";
    const time = typeof input.time === "string" ? input.time : "";
    const rawSearchUrl = optionalText(input.searchUrl, 2_048);
    if (!id || ids.has(id) || !origin || !destination || origin === destination || !isCalendarDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || rawSearchUrl === null) return null;
    let searchUrl = "";
    if (rawSearchUrl) {
      try {
        const url = new URL(rawSearchUrl);
        if (url.protocol !== "https:" || url.hostname !== "japantravel.navitime.com" || url.pathname !== "/ko/booking/jr/search/") return null;
        searchUrl = url.toString();
      } catch {
        return null;
      }
    }
    ids.add(id);
    plans.push({ id, date, origin, destination, time, searchUrl: searchUrl || undefined });
  }
  return plans;
}

export function normalizeSelectedFlights(value: unknown): SelectedFlight[] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const flights: SelectedFlight[] = [];
  const directions = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const input = candidate as Record<string, unknown>;
    const id = optionalText(input.id, 100);
    const direction = input.direction === "outbound" || input.direction === "return" ? input.direction : null;
    const carrier = optionalText(input.carrier, 100);
    const flightNumber = typeof input.flightNumber === "string" ? input.flightNumber.trim().toUpperCase().replaceAll(" ", "") : "";
    const origin = typeof input.origin === "string" ? input.origin.trim().toUpperCase() : "";
    const destination = typeof input.destination === "string" ? input.destination.trim().toUpperCase() : "";
    const departureDate = typeof input.departureDate === "string" ? input.departureDate : "";
    const departureTime = typeof input.departureTime === "string" ? input.departureTime : "";
    const arrivalTime = typeof input.arrivalTime === "string" ? input.arrivalTime : "";
    const sourceText = optionalText(input.sourceText, 4_000);
    const confirmedAt = typeof input.confirmedAt === "string" ? input.confirmedAt : "";
    const priceKrw = input.priceKrw === undefined || input.priceKrw === null || input.priceKrw === ""
      ? undefined
      : Number(input.priceKrw);
    if (
      !id || !direction || directions.has(direction) || !carrier
      || !/^[A-Z0-9]{2,3}\d{1,4}$/.test(flightNumber)
      || !/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination
      || !isCalendarDate(departureDate)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(departureTime)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)
      || sourceText === null || !confirmedAt || Number.isNaN(Date.parse(confirmedAt))
      || (priceKrw !== undefined && (!Number.isInteger(priceKrw) || priceKrw < 0 || priceKrw > 100_000_000))
    ) return null;
    directions.add(direction);
    flights.push({
      id,
      direction,
      carrier,
      flightNumber,
      origin,
      destination,
      departureDate,
      departureTime,
      arrivalTime,
      priceKrw,
      sourceText: sourceText || undefined,
      confirmedAt: new Date(confirmedAt).toISOString(),
    });
  }
  return flights;
}

export function normalizeScheduleItems(value: unknown): ScheduleItem[] | null {
  if (!Array.isArray(value) || value.length > 1_000) return null;
  const items: ScheduleItem[] = [];
  const ids = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const input = candidate as Record<string, unknown>;
    const id = typeof input.id === "string" ? input.id.trim() : "";
    const date = typeof input.date === "string" ? input.date : "";
    const time = typeof input.time === "string" ? input.time : "";
    const title = optionalText(input.title, 120);
    const place = optionalText(input.place, 200);
    const address = optionalText(input.address, 500);
    const note = optionalText(input.note, 1_000);
    const checkInTime = optionalText(input.checkInTime, 5);
    const checkOutTime = optionalText(input.checkOutTime, 5);
    const category = SCHEDULE_CATEGORIES.find((item) => item === input.category);
    if (
      !id || id.length > 100 || ids.has(id)
      || !isCalendarDate(date)
      || (time !== "" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
      || !category || !title || place === null || address === null || note === null
      || checkInTime === null || checkOutTime === null
      || (checkInTime !== "" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(checkInTime))
      || (checkOutTime !== "" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(checkOutTime))
      || (category !== "숙소" && Boolean(checkInTime || checkOutTime))
    ) return null;

    const hasLatitude = input.latitude !== undefined;
    const hasLongitude = input.longitude !== undefined;
    if (hasLatitude !== hasLongitude) return null;
    const latitude = hasLatitude ? Number(input.latitude) : undefined;
    const longitude = hasLongitude ? Number(input.longitude) : undefined;
    if (
      (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
    ) return null;

    const rawMapUrl = optionalText(input.mapUrl, 2_048);
    if (rawMapUrl === null) return null;
    const mapUrl = rawMapUrl ? normalizeGoogleMapsUrl(rawMapUrl) : "";
    if (rawMapUrl && !mapUrl) return null;
    ids.add(id);
    items.push({
      id,
      date,
      time,
      category,
      title,
      place: place ?? "",
      address: address || undefined,
      latitude,
      longitude,
      mapUrl: mapUrl || undefined,
      note: note || undefined,
      checkInTime: checkInTime || undefined,
      checkOutTime: checkOutTime || undefined,
    });
  }
  return items;
}
