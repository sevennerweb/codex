import "server-only";

import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "@/lib/database-path";
import type { TripBackup } from "@/lib/trip-backup-schema";
import type { StoredTripSection, TripSectionName } from "@/lib/trip-sections";

export type StoredTrip = {
  name: string;
  startDate: string;
  endDate: string;
  confirmed: boolean;
  version: number;
  updatedAt: string;
};

export type TripInput = Omit<StoredTrip, "updatedAt">;

type TripRow = {
  name: string;
  start_date: string;
  end_date: string;
  confirmed: number;
  version: number;
  updated_at: string;
};

type TripSectionRow = {
  data_json: string;
  version: number;
  updated_at: string;
};

const LEGACY_CURRENT_TRIP_ID = "current";

function currentTripId(accountId: string) {
  return `${accountId}:current`;
}

function createDatabase() {
  const database = new DatabaseSync(getDatabasePath());
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
      version INTEGER NOT NULL CHECK (version >= 1),
      updated_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS trip_sections (
      trip_id TEXT NOT NULL,
      section TEXT NOT NULL,
      data_json TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, section),
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    )
  `);
  database.prepare(`
    INSERT OR IGNORE INTO trips (id, name, start_date, end_date, confirmed, version, updated_at)
    SELECT ?, name, start_date, end_date, confirmed, version, updated_at
    FROM trips
    WHERE id = ?
  `).run(currentTripId("admin"), LEGACY_CURRENT_TRIP_ID);
  database.prepare(`
    INSERT OR IGNORE INTO trips (id, name, start_date, end_date, confirmed, version, updated_at)
    SELECT ?, name, start_date, end_date, confirmed, version, updated_at
    FROM trips
    WHERE id = ?
  `).run(currentTripId("guest1"), LEGACY_CURRENT_TRIP_ID);
  database.prepare("DELETE FROM trips WHERE id = ?").run(LEGACY_CURRENT_TRIP_ID);
  return database;
}

const globalDatabase = globalThis as typeof globalThis & { travelPlannerDatabase?: DatabaseSync };
let moduleDatabase: DatabaseSync | undefined;

function getDatabase() {
  if (moduleDatabase) return moduleDatabase;
  moduleDatabase = globalDatabase.travelPlannerDatabase ?? createDatabase();
  if (process.env.NODE_ENV !== "production") globalDatabase.travelPlannerDatabase = moduleDatabase;
  return moduleDatabase;
}

function toStoredTrip(row: TripRow): StoredTrip {
  return {
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    confirmed: row.confirmed === 1,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function getCurrentTrip(accountId: string) {
  const row = getDatabase().prepare("SELECT name, start_date, end_date, confirmed, version, updated_at FROM trips WHERE id = ?").get(currentTripId(accountId)) as TripRow | undefined;
  return row ? toStoredTrip(row) : null;
}

export function saveCurrentTrip(accountId: string, input: TripInput): { status: "saved"; trip: StoredTrip } | { status: "conflict"; trip: StoredTrip } {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = getCurrentTrip(accountId);
    if (current && current.version !== input.version) {
      database.exec("ROLLBACK");
      return { status: "conflict", trip: current };
    }

    const nextVersion = current ? current.version + 1 : 1;
    const updatedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO trips (id, name, start_date, end_date, confirmed, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        confirmed = excluded.confirmed,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(currentTripId(accountId), input.name, input.startDate, input.endDate, input.confirmed ? 1 : 0, nextVersion, updatedAt);
    database.exec("COMMIT");
    return { status: "saved", trip: { ...input, version: nextVersion, updatedAt } };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function toStoredSection<T>(row: TripSectionRow): StoredTripSection<T> {
  return {
    data: JSON.parse(row.data_json) as T,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function getTripSection<T>(accountId: string, section: TripSectionName) {
  const row = getDatabase().prepare(`
    SELECT data_json, version, updated_at
    FROM trip_sections
    WHERE trip_id = ? AND section = ?
  `).get(currentTripId(accountId), section) as TripSectionRow | undefined;
  return row ? toStoredSection<T>(row) : null;
}

export function saveTripSection<T>(
  accountId: string,
  section: TripSectionName,
  data: T,
  version: number,
):
  | { status: "saved"; section: StoredTripSection<T> }
  | { status: "conflict"; section: StoredTripSection<T> }
  | { status: "missing-trip" } {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (!getCurrentTrip(accountId)) {
      database.exec("ROLLBACK");
      return { status: "missing-trip" };
    }

    const current = getTripSection<T>(accountId, section);
    if (current && current.version !== version) {
      database.exec("ROLLBACK");
      return { status: "conflict", section: current };
    }

    const nextVersion = current ? current.version + 1 : 1;
    const updatedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO trip_sections (trip_id, section, data_json, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(trip_id, section) DO UPDATE SET
        data_json = excluded.data_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(currentTripId(accountId), section, JSON.stringify(data), nextVersion, updatedAt);
    database.exec("COMMIT");
    return { status: "saved", section: { data, version: nextVersion, updatedAt } };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function restoreTripBackup(
  accountId: string,
  backup: TripBackup,
  expectedVersion: number,
): { status: "saved"; trip: StoredTrip } | { status: "conflict"; trip: StoredTrip | null } {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = getCurrentTrip(accountId);
    if ((current?.version ?? 0) !== expectedVersion) {
      database.exec("ROLLBACK");
      return { status: "conflict", trip: current };
    }

    const nextVersion = (current?.version ?? 0) + 1;
    const updatedAt = new Date().toISOString();
    const tripId = currentTripId(accountId);
    database.prepare(`
      INSERT INTO trips (id, name, start_date, end_date, confirmed, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        confirmed = excluded.confirmed,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(tripId, backup.trip.name, backup.trip.startDate, backup.trip.endDate, backup.trip.confirmed ? 1 : 0, nextVersion, updatedAt);

    database.prepare("DELETE FROM trip_sections WHERE trip_id = ?").run(tripId);
    const insertSection = database.prepare(`
      INSERT INTO trip_sections (trip_id, section, data_json, version, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `);
    const sections: Array<[TripSectionName, unknown]> = [
      ["route", backup.sections.route],
      ["flightSearch", backup.sections.flightSearch],
      ["selectedFlights", backup.sections.selectedFlights],
      ["schedule", backup.sections.schedule],
      ["localInfo", backup.sections.localInfo],
      ["train", backup.sections.train],
    ];
    for (const [section, data] of sections) {
      if (data !== null) insertSection.run(tripId, section, JSON.stringify(data), updatedAt);
    }

    database.exec("COMMIT");
    return {
      status: "saved",
      trip: { ...backup.trip, version: nextVersion, updatedAt },
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
