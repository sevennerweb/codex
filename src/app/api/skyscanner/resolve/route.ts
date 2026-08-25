import { NextRequest, NextResponse } from "next/server";

const SHARED_LINK_HOST = "skyscanner.app.link";
const LANDING_HOST = "appipv4.link";
const SKYSCANNER_HOSTS = ["skyscanner.co.kr", "skyscanner.net", "skyscanner.com"];

function isSkyscannerHost(hostname: string) {
  const host = hostname.toLowerCase();
  return SKYSCANNER_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export async function POST(request: NextRequest) {
  let sharedUrl: URL;
  try {
    const payload = (await request.json()) as { url?: unknown };
    if (typeof payload.url !== "string" || payload.url.length > 2_048) throw new Error("Invalid URL");
    sharedUrl = new URL(payload.url.trim());
    if (sharedUrl.protocol !== "https:" || sharedUrl.hostname.toLowerCase() !== SHARED_LINK_HOST) throw new Error("Invalid host");
  } catch {
    return NextResponse.json({ error: "올바른 Skyscanner 앱 공유 링크를 입력해 주세요." }, { status: 400 });
  }

  try {
    const initialResponse = await fetch(sharedUrl, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; webapp-travel/0.1)" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const location = initialResponse.headers.get("location");
    if (!location) throw new Error("Missing redirect");

    const landingUrl = new URL(location, sharedUrl);
    if (landingUrl.protocol !== "https:" || landingUrl.hostname.toLowerCase() !== LANDING_HOST) throw new Error("Unexpected redirect");

    const landingResponse = await fetch(landingUrl, {
      redirect: "error",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; webapp-travel/0.1)" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!landingResponse.ok) throw new Error(`Landing page returned ${landingResponse.status}`);

    const contentLength = Number(landingResponse.headers.get("content-length") ?? 0);
    if (contentLength > 1_000_000) throw new Error("Landing page too large");
    const html = await landingResponse.text();
    const match = html.match(/href="(https:\/\/(?:[^/]+\.)?skyscanner\.(?:co\.kr|net|com)\/transport\/flights\/[^"<]+)"/i);
    if (!match?.[1]) throw new Error("Flight URL not found");

    const resultUrl = new URL(match[1].replaceAll("&amp;", "&"));
    if (!isSkyscannerHost(resultUrl.hostname) || !resultUrl.pathname.toLowerCase().startsWith("/transport/flights/")) {
      throw new Error("Unexpected result URL");
    }

    return NextResponse.json({ url: resultUrl.toString() });
  } catch {
    return NextResponse.json({ error: "공유 링크에서 항공편 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
