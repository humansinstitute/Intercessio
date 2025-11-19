import path from "node:path";
import { promises as fs } from "node:fs";
import { Database } from "bun:sqlite";

import { CONFIG_DIR } from "./constants.js";

const DB_PATH = path.join(CONFIG_DIR, "intercessio.db");

let db: Database | null = null;

async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

function bootstrap(database: Database) {
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      key_id TEXT NOT NULL,
      alias TEXT,
      relays TEXT NOT NULL,
      secret TEXT,
      uri TEXT,
      auto_approve INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_client TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      template TEXT NOT NULL DEFAULT 'auto_sign'
    );
  `);
  const columns = database.prepare(`PRAGMA table_info(sessions)`).all();
  const hasTemplateColumn = columns.some((column: any) => column.name === "template");
  if (!hasTemplateColumn) {
    database.exec(`ALTER TABLE sessions ADD COLUMN template TEXT NOT NULL DEFAULT 'auto_sign';`);
  }
}

export async function getDB() {
  if (db) return db;
  await ensureConfigDir();
  db = new Database(DB_PATH);
  bootstrap(db);
  return db;
}

export type SessionRecord = {
  id: string;
  type: "bunker" | "nostr-connect";
  keyId: string;
  alias: string;
  relays: string[];
  secret?: string;
  uri?: string;
  autoApprove: boolean;
  status: "waiting" | "connected";
  lastClient?: string;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  template: string;
};

function rowToRecord(row: any): SessionRecord {
  return {
    id: row.id,
    type: row.type,
    keyId: row.key_id,
    alias: row.alias ?? "",
    relays: JSON.parse(row.relays),
    secret: row.secret ?? undefined,
    uri: row.uri ?? undefined,
    autoApprove: Boolean(row.auto_approve),
    status: row.status,
    lastClient: row.last_client ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: Boolean(row.active),
    template: row.template ?? "auto_sign",
  };
}

export async function upsertSession(record: SessionRecord) {
  const database = await getDB();
  const stmt = database.prepare(`
    INSERT INTO sessions (id, type, key_id, alias, relays, secret, uri, auto_approve, status, last_client, created_at, updated_at, active, template)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      alias = excluded.alias,
      relays = excluded.relays,
      secret = excluded.secret,
      uri = excluded.uri,
      auto_approve = excluded.auto_approve,
      status = excluded.status,
      last_client = excluded.last_client,
      updated_at = excluded.updated_at,
      active = excluded.active,
      template = excluded.template
  `);
  stmt.run(
    record.id,
    record.type,
    record.keyId,
    record.alias,
    JSON.stringify(record.relays),
    record.secret ?? null,
    record.uri ?? null,
    record.autoApprove ? 1 : 0,
    record.status,
    record.lastClient ?? null,
    record.createdAt,
    record.updatedAt,
    record.active ? 1 : 0,
    record.template,
  );
}

export async function listSessions(activeOnly = false): Promise<SessionRecord[]> {
  const database = await getDB();
  const rows = activeOnly
    ? database.prepare(`SELECT * FROM sessions WHERE active = 1`).all()
    : database.prepare(`SELECT * FROM sessions`).all();
  return rows.map(rowToRecord);
}

export async function getSessionById(id: string): Promise<SessionRecord | null> {
  const database = await getDB();
  const row = database.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
  return row ? rowToRecord(row) : null;
}

export async function updateSessionStatus(id: string, status: "waiting" | "connected", lastClient?: string) {
  const database = await getDB();
  database
    .prepare(
      `UPDATE sessions SET status = ?, last_client = ?, updated_at = ?, active = 1 WHERE id = ?`,
    )
    .run(status, lastClient ?? null, Date.now(), id);
}

export async function deactivateSession(id: string) {
  const database = await getDB();
  database.prepare(`UPDATE sessions SET active = 0, updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

export async function deleteSession(id: string) {
  const database = await getDB();
  database.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export async function updateSessionAlias(id: string, alias: string) {
  const database = await getDB();
  database.prepare(`UPDATE sessions SET alias = ?, updated_at = ? WHERE id = ?`).run(alias, Date.now(), id);
}
