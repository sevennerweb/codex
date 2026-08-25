import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const LICENSE_URL = "https://github.com/davidmegginson/ourairports-data/blob/main/LICENSE";
const ALLOWED_TYPES = new Set(["large_airport", "medium_airport", "small_airport"]);

const KOREAN_AIRPORTS = {
  ICN: { name: "인천국제공항", city: "서울", aliases: ["인천공항"] },
  GMP: { name: "김포국제공항", city: "서울", aliases: ["김포공항"] },
  PUS: { name: "김해국제공항", city: "부산", aliases: ["김해공항", "부산공항"] },
  CJU: { name: "제주국제공항", city: "제주", aliases: ["제주공항"] },
  NRT: { name: "나리타국제공항", city: "도쿄", aliases: ["나리타공항"] },
  HND: { name: "하네다공항", city: "도쿄", aliases: ["도쿄국제공항"] },
  KIX: { name: "간사이국제공항", city: "오사카", aliases: ["간사이공항", "관서공항"] },
  ITM: { name: "오사카국제공항", city: "오사카", aliases: ["이타미공항"] },
  NGO: { name: "주부국제공항", city: "나고야", aliases: ["센트레아", "나고야공항"] },
  FSZ: { name: "후지산 시즈오카공항", city: "시즈오카", aliases: ["시즈오카공항", "후지산공항"] },
  FUK: { name: "후쿠오카공항", city: "후쿠오카", aliases: [] },
  CTS: { name: "신치토세공항", city: "삿포로", aliases: ["치토세공항", "삿포로공항"] },
  OKA: { name: "나하공항", city: "오키나와", aliases: ["오키나와공항"] },
};

function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  const [headers, ...values] = rows;
  return values.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function compact(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`공항 데이터를 내려받지 못했습니다: ${response.status} ${response.statusText}`);
}

const rows = parseCsv(await response.text());
const airportsByCode = new Map();
const typeRank = { large_airport: 3, medium_airport: 2, small_airport: 1 };

for (const row of rows) {
  const code = row.iata_code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || row.scheduled_service !== "yes" || !ALLOWED_TYPES.has(row.type)) continue;

  const korean = KOREAN_AIRPORTS[code];
  const airport = {
    code,
    name: korean?.name ?? row.name.trim(),
    city: korean?.city ?? row.municipality.trim(),
    country: row.iso_country.trim(),
    aliases: compact([
      ...(korean?.aliases ?? []),
      korean ? row.name : "",
      row.local_code,
      row.gps_code,
      row.ident,
    ]),
    keywords: compact(row.keywords.split(",")),
    type: row.type,
  };

  const current = airportsByCode.get(code);
  if (!current || typeRank[airport.type] > typeRank[current.type]) airportsByCode.set(code, airport);
}

const airports = [...airportsByCode.values()].sort((left, right) => left.code.localeCompare(right.code));
for (const code of Object.keys(KOREAN_AIRPORTS)) {
  if (!airportsByCode.has(code)) throw new Error(`필수 공항 ${code}가 원본 데이터에 없습니다.`);
}

const lastModified = response.headers.get("last-modified");
const output = {
  meta: {
    source: SOURCE_URL,
    license: "Public Domain (OurAirports)",
    licenseUrl: LICENSE_URL,
    updatedAt: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
    count: airports.length,
  },
  airports,
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../src/data/airports.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(`${airports.length}개 공항을 ${outputPath}에 저장했습니다.`);
