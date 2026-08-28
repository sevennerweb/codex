import { normalizeSavedFlightSearches, type SavedFlightSearch } from "@/lib/skyscanner-links";
import {
  normalizeLocalInfoData,
  normalizeRoutePlan,
  normalizeScheduleItems,
  normalizeSelectedFlights,
  normalizeTrainPlans,
  type LocalInfoData,
  type RoutePlan,
  type ScheduleItem,
  type SelectedFlight,
  type TrainPlan,
} from "@/lib/trip-sections";

export const TRIP_BACKUP_FORMAT = "webapp-travel-backup";
export const TRIP_BACKUP_SCHEMA_VERSION = 1;

export type BackupTrip = {
  name: string;
  startDate: string;
  endDate: string;
  confirmed: boolean;
};

export type TripBackupSections = {
  route: RoutePlan | null;
  flightSearch: SavedFlightSearch[] | null;
  selectedFlights: SelectedFlight[] | null;
  schedule: ScheduleItem[] | null;
  localInfo: LocalInfoData | null;
  train: TrainPlan[] | null;
};

export type TripBackup = {
  format: typeof TRIP_BACKUP_FORMAT;
  schemaVersion: typeof TRIP_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  trip: BackupTrip;
  sections: TripBackupSections;
};

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeTrip(value: unknown): BackupTrip | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80 || !isCalendarDate(input.startDate) || !isCalendarDate(input.endDate) || input.endDate < input.startDate) return null;
  if (typeof input.confirmed !== "boolean") return null;
  return { name, startDate: input.startDate, endDate: input.endDate, confirmed: input.confirmed };
}

function nullableSection<T>(value: unknown, normalize: (input: unknown) => T | null): T | null | undefined {
  if (value === null || value === undefined) return null;
  return normalize(value) ?? undefined;
}

export function normalizeTripBackup(value: unknown): TripBackup | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.format !== TRIP_BACKUP_FORMAT || input.schemaVersion !== TRIP_BACKUP_SCHEMA_VERSION) return null;
  const exportedAt = typeof input.exportedAt === "string" ? input.exportedAt : "";
  const trip = normalizeTrip(input.trip);
  if (!trip || !exportedAt || Number.isNaN(Date.parse(exportedAt)) || !input.sections || typeof input.sections !== "object") return null;
  const sections = input.sections as Record<string, unknown>;
  const route = nullableSection(sections.route, normalizeRoutePlan);
  const flightSearch = nullableSection(sections.flightSearch, normalizeSavedFlightSearches);
  const selectedFlights = nullableSection(sections.selectedFlights, normalizeSelectedFlights);
  const schedule = nullableSection(sections.schedule, normalizeScheduleItems);
  const localInfo = nullableSection(sections.localInfo, normalizeLocalInfoData);
  const train = nullableSection(sections.train, normalizeTrainPlans);
  if ([route, flightSearch, selectedFlights, schedule, localInfo, train].some((section) => section === undefined)) return null;
  if (schedule?.some((item) => item.date < trip.startDate || item.date > trip.endDate)) return null;
  if (train?.some((plan) => plan.date < trip.startDate || plan.date > trip.endDate)) return null;

  return {
    format: TRIP_BACKUP_FORMAT,
    schemaVersion: TRIP_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    trip,
    sections: {
      route: route ?? null,
      flightSearch: flightSearch ?? null,
      selectedFlights: selectedFlights ?? null,
      schedule: schedule ?? null,
      localInfo: localInfo ?? null,
      train: train ?? null,
    },
  };
}
