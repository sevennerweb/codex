import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get("lat"));
  const longitude = Number(request.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: "올바른 위도와 경도가 필요합니다." }, { status: 400 });
  }

  const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
  endpoint.searchParams.set("latitude", String(latitude));
  endpoint.searchParams.set("longitude", String(longitude));
  endpoint.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  endpoint.searchParams.set("timezone", "auto");
  endpoint.searchParams.set("forecast_days", "16");

  try {
    const response = await fetch(endpoint, { next: { revalidate: 1_800 } });
    if (!response.ok) throw new Error(`Open-Meteo forecast returned ${response.status}`);
    const payload = await response.json();
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "날씨 서비스에 연결할 수 없습니다." }, { status: 502 });
  }
}
