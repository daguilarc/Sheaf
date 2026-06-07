import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { EventsRepo, RealtimeAgentDb, SessionsRepo } from "../../../src/agent/src/index.js";

export interface PersistenceTestContext
{
  databasePath: string;
  database: RealtimeAgentDb;
  sessions: SessionsRepo;
  events: EventsRepo;
}

export function CreatePersistenceTestContext(): PersistenceTestContext
{
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "realtime-agent-test-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const database = RealtimeAgentDb.open({
    path: databasePath,
    ensureDirectory: false,
  });

  return {
    databasePath,
    database,
    sessions: new SessionsRepo(database),
    events: new EventsRepo(database),
  };
}

export function CleanupPersistenceTestContext(context: PersistenceTestContext): void
{
  context.database.close();
  rmSync(path.dirname(context.databasePath), { recursive: true, force: true });
}
