import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

export function getDatabasePath() {
  const configuredPath = process.env.TRAVEL_DB_PATH?.trim();
  const databasePath = configuredPath ? path.resolve(configuredPath) : path.join(process.cwd(), "data", "travel-planner.sqlite");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  return databasePath;
}
