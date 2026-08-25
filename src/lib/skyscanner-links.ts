export type FlightSearchRoute = {
  outboundOrigin: string;
  outboundDestination: string;
  returnOrigin: string;
  returnDestination: string;
};

export type FlightSearchDates = {
  startDate: string;
  endDate: string;
};

export type FlightSearchKind = "roundTrip" | "oneWay" | "multiCity";

export type SkyscannerSearchLink = {
  key: "roundTrip" | "outbound" | "return";
  label: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  url: string;
};

export type SavedFlightSearch = {
  url: string;
  provider: "Skyscanner";
  kind: FlightSearchKind;
  outboundOrigin: string;
  outboundDestination: string;
  returnOrigin: string;
  returnDestination: string;
  departureDate: string;
  returnDate: string;
  adults: number;
  nonStopOnly: boolean;
  importedAt: string;
};

function compactDate(value: string) {
  return value.replaceAll("-", "").slice(2);
}

function normalizedDate(value: string | null | undefined) {
  if (!value) return "";
  if (/^\d{6}$/.test(value)) return `20${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return "";
}

function createSearchUrl(origin: string, destination: string, departureDate: string, returnDate: string, adults: number, nonStopOnly: boolean) {
  const dates = returnDate ? `/${compactDate(returnDate)}` : "";
  const path = `/transport/flights/${origin.toLowerCase()}/${destination.toLowerCase()}/${compactDate(departureDate)}${dates}/`;
  const url = new URL(path, "https://www.skyscanner.co.kr");
  url.searchParams.set("adultsv2", String(adults));
  url.searchParams.set("cabinclass", "economy");
  url.searchParams.set("currency", "KRW");
  url.searchParams.set("locale", "ko-KR");
  url.searchParams.set("market", "KR");
  url.searchParams.set("sortby", "cheapest");
  url.searchParams.set("preferdirects", String(nonStopOnly));
  url.searchParams.set("outboundaltsenabled", "false");
  if (returnDate) url.searchParams.set("inboundaltsenabled", "false");
  return url.toString();
}

export function buildSkyscannerSearches(dates: FlightSearchDates, route: FlightSearchRoute, adults: number, nonStopOnly: boolean): SkyscannerSearchLink[] {
  const roundTrip = route.returnOrigin === route.outboundDestination && route.returnDestination === route.outboundOrigin;

  if (roundTrip) {
    return [{
      key: "roundTrip",
      label: "왕복 항공편 검색",
      origin: route.outboundOrigin,
      destination: route.outboundDestination,
      departureDate: dates.startDate,
      returnDate: dates.endDate,
      url: createSearchUrl(route.outboundOrigin, route.outboundDestination, dates.startDate, dates.endDate, adults, nonStopOnly),
    }];
  }

  return [
    {
      key: "outbound",
      label: "가는 편 검색",
      origin: route.outboundOrigin,
      destination: route.outboundDestination,
      departureDate: dates.startDate,
      returnDate: "",
      url: createSearchUrl(route.outboundOrigin, route.outboundDestination, dates.startDate, "", adults, nonStopOnly),
    },
    {
      key: "return",
      label: "오는 편 검색",
      origin: route.returnOrigin,
      destination: route.returnDestination,
      departureDate: dates.endDate,
      returnDate: "",
      url: createSearchUrl(route.returnOrigin, route.returnDestination, dates.endDate, "", adults, nonStopOnly),
    },
  ];
}

export function parseSkyscannerLink(value: string): Omit<SavedFlightSearch, "provider" | "importedAt"> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("http 또는 https로 시작하는 전체 링크를 붙여 넣어 주세요.");
  }

  const host = url.hostname.toLowerCase();
  const allowed = ["skyscanner.co.kr", "skyscanner.net", "skyscanner.com"];
  if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Skyscanner 결과 페이지 링크만 가져올 수 있습니다.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  let kind: FlightSearchKind = "roundTrip";
  let outboundOrigin = "";
  let outboundDestination = "";
  let returnOrigin = "";
  let returnDestination = "";
  let departureDate = "";
  let returnDate = "";

  const transportIndex = parts.indexOf("transport");
  if (transportIndex >= 0 && parts[transportIndex + 1] === "flights") {
    outboundOrigin = parts[transportIndex + 2] ?? "";
    outboundDestination = parts[transportIndex + 3] ?? "";
    departureDate = normalizedDate(parts[transportIndex + 4]);
    returnDate = normalizedDate(parts[transportIndex + 5]);
    kind = returnDate ? "roundTrip" : "oneWay";
    if (returnDate) {
      returnOrigin = outboundDestination;
      returnDestination = outboundOrigin;
    }
  } else if (transportIndex >= 0 && parts[transportIndex + 1] === "d") {
    kind = "multiCity";
    outboundOrigin = parts[transportIndex + 2] ?? "";
    departureDate = normalizedDate(parts[transportIndex + 3]);
    outboundDestination = parts[transportIndex + 4] ?? "";
    returnOrigin = parts[transportIndex + 5] ?? "";
    returnDate = normalizedDate(parts[transportIndex + 6]);
    returnDestination = parts[transportIndex + 7] ?? "";
  } else if (parts.includes("day-view")) {
    outboundOrigin = url.searchParams.get("origin") ?? "";
    outboundDestination = url.searchParams.get("destination") ?? "";
    departureDate = normalizedDate(url.searchParams.get("outboundDate"));
    returnDate = normalizedDate(url.searchParams.get("inboundDate"));
    kind = returnDate ? "roundTrip" : "oneWay";
    if (returnDate) {
      returnOrigin = outboundDestination;
      returnDestination = outboundOrigin;
    }
  } else if (parts.includes("multicity")) {
    kind = "multiCity";
    outboundOrigin = url.searchParams.get("origin0") ?? "";
    outboundDestination = url.searchParams.get("destination0") ?? "";
    returnOrigin = url.searchParams.get("origin1") ?? "";
    returnDestination = url.searchParams.get("destination1") ?? "";
    departureDate = normalizedDate(url.searchParams.get("date0"));
    returnDate = normalizedDate(url.searchParams.get("date1"));
  }

  const codes = [outboundOrigin, outboundDestination, returnOrigin, returnDestination].map((code) => code.toUpperCase());
  const requiredCodes = kind === "oneWay" ? codes.slice(0, 2) : codes;
  const datesValid = Boolean(departureDate) && (kind === "oneWay" || Boolean(returnDate));
  if (requiredCodes.some((code) => !/^[A-Z]{3}$/.test(code)) || !datesValid) {
    throw new Error("검색 조건을 읽을 수 없습니다. 검색 결과가 열린 상태의 주소창 전체 링크를 복사해 주세요.");
  }

  const adults = Number(url.searchParams.get("adultsv2") ?? url.searchParams.get("adults") ?? 1);
  return {
    url: url.toString(),
    kind,
    outboundOrigin: codes[0],
    outboundDestination: codes[1],
    returnOrigin: codes[2],
    returnDestination: codes[3],
    departureDate,
    returnDate,
    adults: Number.isInteger(adults) && adults >= 1 && adults <= 9 ? adults : 1,
    nonStopOnly: url.searchParams.get("preferdirects") === "true",
  };
}
