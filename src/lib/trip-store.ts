import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const CURRENT_TRIP_ID = "current";

function createDatabase() {
  const configuredPath = process.env.TRAVEL_DB_PATH?.trim();
  const databasePath = configuredPath ? path.resolve(configuredPath) : path.join(process.cwd(), "data", "travel-planner.sqlite");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
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

export function getCurrentTrip() {
  const row = getDatabase().prepare("SELECT name, start_date, end_date, confirmed, version, updated_at FROM trips WHERE id = ?").get(CURRENT_TRIP_ID) as TripRow | undefined;
  return row ? toStoredTrip(row) : null;
}

export function saveCurrentTrip(input: TripInput): { status: "saved"; trip: StoredTrip } | { status: "conflict"; trip: StoredTrip } {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = getCurrentTrip();
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
    `).run(CURRENT_TRIP_ID, input.name, input.startDate, input.endDate, input.confirmed ? 1 : 0, nextVersion, updatedAt);
    database.exec("COMMIT");
    return { status: "saved", trip: { ...input, version: nextVersion, updatedAt } };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
