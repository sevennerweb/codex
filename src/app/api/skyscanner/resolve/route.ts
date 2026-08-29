import { NextRequest, NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth-server";

const SHARED_LINK_HOST = "skyscanner.app.link";
const LANDING_HOST = "appipv4.link";
const SKYSCANNER_HOSTS = ["skyscanner.co.kr", "skyscanner.net", "skyscanner.com"];
const MAX_LANDING_PAGE_BYTES = 1_000_000;

function isSkyscannerHost(hostname: string) {
  const host = hostname.toLowerCase();
  return SKYSCANNER_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function decodeHtmlUrl(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replace(/&#x26;/giu, "&")
    .replaceAll("&#61;", "=")
    .replace(/&#x3d;/giu, "=");
}

function extractFlightUrl(html: string) {
  const matches = html.matchAll(/https:\/\/(?:[a-z\d-]+\.)*skyscanner\.(?:co\.kr|net|com)\/transport\/flights\/[^"'<>\s]+/giu);
  for (const match of matches) {
    try {
      const candidate = new URL(decodeHtmlUrl(match[0]));
      if (isSkyscannerHost(candidate.hostname) && candidate.pathname.toLowerCase().startsWith("/transport/flights/")) {
        return candidate;
      }
    } catch {
      // Ignore malformed metadata and continue looking for another Skyscanner URL.
    }
  }
  throw new Error("Flight URL not found");
}

async function readLandingPage(response: Response) {
  if (!response.ok) throw new Error(`Landing page returned ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_LANDING_PAGE_BYTES) throw new Error("Landing page too large");
  const html = await response.text();
  if (html.length > MAX_LANDING_PAGE_BYTES) throw new Error("Landing page too large");
  return html;
}

export async function POST(request: NextRequest) {
  if (!await isAuthenticatedRequest(request)) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
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
    let resultUrl: URL;
    if (!location) {
      // Branch now commonly returns a 200 deep-view page whose og:url contains the result URL.
      resultUrl = extractFlightUrl(await readLandingPage(initialResponse));
    } else {
      const landingUrl = new URL(location, sharedUrl);
      if (landingUrl.protocol !== "https:") throw new Error("Unexpected redirect");
      if (isSkyscannerHost(landingUrl.hostname)) {
        resultUrl = landingUrl;
      } else {
        if (landingUrl.hostname.toLowerCase() !== LANDING_HOST) throw new Error("Unexpected redirect");
        const landingResponse = await fetch(landingUrl, {
          redirect: "error",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; webapp-travel/0.1)" },
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        });
        resultUrl = extractFlightUrl(await readLandingPage(landingResponse));
      }
    }

    if (!isSkyscannerHost(resultUrl.hostname) || !resultUrl.pathname.toLowerCase().startsWith("/transport/flights/")) {
      throw new Error("Unexpected result URL");
    }

    return NextResponse.json({ url: resultUrl.toString() });
  } catch {
    return NextResponse.json({ error: "공유 링크에서 항공편 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
