export const SHINKANSEN_STATIONS = [
  { id: "00006668", name: "도쿄", region: "도쿄" },
  { id: "00007825", name: "시나가와", region: "도쿄" },
  { id: "00004179", name: "신요코하마", region: "가나가와" },
  { id: "00004995", name: "시즈오카", region: "시즈오카" },
  { id: "00008576", name: "나고야", region: "아이치" },
  { id: "00001756", name: "교토", region: "교토" },
  { id: "00004305", name: "신오사카", region: "오사카" },
  { id: "00004306", name: "신코베", region: "효고" },
  { id: "00002397", name: "히로시마", region: "히로시마" },
  { id: "00007420", name: "하카타", region: "후쿠오카" },
] as const;

export function navitimeStationName(id: string) {
  return SHINKANSEN_STATIONS.find((station) => station.id === id)?.name ?? "";
}

export function buildNavitimeSearchUrl(departure: string, arrival: string, date: string, time: string) {
  if (!/^\d{8}$/.test(departure) || !/^\d{8}$/.test(arrival) || departure === arrival) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return "";

  const url = new URL("https://japantravel.navitime.com/ko/booking/jr/search/");
  url.searchParams.set("departure", departure);
  url.searchParams.set("arrival", arrival);
  url.searchParams.set("date", date.replaceAll("-", ""));
  url.searchParams.set("time", time.slice(0, 2));
  url.searchParams.set("cid", "japantravel.web.deparrtimelist");
  return url.toString();
}
