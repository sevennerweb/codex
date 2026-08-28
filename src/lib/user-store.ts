import "server-only";

import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "@/lib/database-path";

type UserRow = {
  password_hash: string;
  session_version: number;
};

const ACCOUNT_SEEDS = [
  ["admin", "TRAVEL_ADMIN_INITIAL_PASSWORD_HASH"],
  ["guest1", "TRAVEL_GUEST1_INITIAL_PASSWORD_HASH"],
  ["guest2", "TRAVEL_GUEST2_INITIAL_PASSWORD_HASH"],
  ["test", "TRAVEL_TEST_INITIAL_PASSWORD_HASH"],
] as const;

function createDatabase() {
  const database = new DatabaseSync(getDatabasePath());
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
      password_updated_at TEXT NOT NULL
    )
  `);

  const insert = database.prepare(`
    INSERT OR IGNORE INTO users (id, password_hash, session_version, password_updated_at)
    VALUES (?, ?, 1, ?)
  `);
  for (const [accountId, environmentName] of ACCOUNT_SEEDS) {
    const passwordHash = process.env[environmentName]?.trim();
    if (passwordHash) insert.run(accountId, passwordHash, new Date().toISOString());
  }
  return database;
}

const globalDatabase = globalThis as typeof globalThis & { travelPlannerUserDatabase?: DatabaseSync };
let moduleDatabase: DatabaseSync | undefined;

function getDatabase() {
  if (moduleDatabase) return moduleDatabase;
  moduleDatabase = globalDatabase.travelPlannerUserDatabase ?? createDatabase();
  if (process.env.NODE_ENV !== "production") globalDatabase.travelPlannerUserDatabase = moduleDatabase;
  return moduleDatabase;
}

export function getUserCredential(accountId: string) {
  const row = getDatabase().prepare("SELECT password_hash, session_version FROM users WHERE id = ?").get(accountId) as UserRow | undefined;
  return row ? { passwordHash: row.password_hash, sessionVersion: row.session_version } : null;
}

export function updateUserPassword(accountId: string, passwordHash: string) {
  const result = getDatabase().prepare(`
    UPDATE users
    SET password_hash = ?, session_version = session_version + 1, password_updated_at = ?
    WHERE id = ?
  `).run(passwordHash, new Date().toISOString(), accountId);
  return result.changes === 1;
}
