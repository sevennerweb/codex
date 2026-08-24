import { NextRequest, NextResponse } from "next/server";

type NominatimPlace = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

let lastNominatimRequest = 0;

const KOREAN_CITY_ALIASES: Record<string, string> = {
  교토: "京都市",
  교토시: "京都市",
  오사카: "大阪市",
  오사카시: "大阪市",
  도쿄: "東京都",
  후쿠오카: "福岡市",
  나고야: "名古屋市",
  삿포로: "札幌市",
  오키나와: "沖縄県",
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) {
    return NextResponse.json({ error: "검색어는 2자 이상 80자 이하로 입력해 주세요." }, { status: 400 });
  }

  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("q", KOREAN_CITY_ALIASES[query.replaceAll(" ", "")] ?? query);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("accept-language", "ko");
  endpoint.searchParams.set("layer", "address");

  try {
    const wait = Math.max(0, 1_050 - (Date.now() - lastNominatimRequest));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatimRequest = Date.now();
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "webapp-travel-schedule/0.1 (personal local travel planner)" },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
    const payload = (await response.json()) as NominatimPlace[];
    return NextResponse.json({
      results: payload.map((place) => {
        const [name, ...region] = place.display_name.split(",").map((part) => part.trim());
        return { id: place.place_id, name, region: region.slice(0, 3).join(", "), latitude: Number(place.lat), longitude: Number(place.lon) };
      }),
    });
  } catch {
    return NextResponse.json({ error: "도시 검색 서비스에 연결할 수 없습니다." }, { status: 502 });
  }
}
