import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { hash } from "./util";

type DbGlobal = typeof globalThis & { aiOsDb?: Promise<PrismaClient>; aiOsLite?: PGlite };
const shared = globalThis as DbGlobal;

export async function migrateLite(lite: PGlite) {
  await lite.exec('CREATE TABLE IF NOT EXISTS "_os_migrations" ("name" TEXT PRIMARY KEY, "hash" TEXT NOT NULL)');
  const migrationDir = path.join(process.cwd(), "prisma/migrations");
  for (const name of (await readdir(migrationDir)).filter(n => /^\d/.test(n)).sort()) {
    const sql = await readFile(path.join(migrationDir, name, "migration.sql"), "utf8");
    const existing = await lite.query<{hash: string}>('SELECT "hash" FROM "_os_migrations" WHERE "name" = $1', [name]);
    if (existing.rows.length) { if (existing.rows[0].hash !== hash(sql)) throw new Error("Applied local migration changed."); continue; }
    await lite.transaction(async tx => { await tx.exec(sql); await tx.query('INSERT INTO "_os_migrations" VALUES ($1, $2)', [name, hash(sql)]); });
  }
}

export async function createTestDb() {
  const lite = await PGlite.create();
  await migrateLite(lite);
  const client = new PrismaClient({ adapter: new PrismaPGlite(lite) });
  return { client, close: async () => { await client.$disconnect(); await lite.close(); } };
}

export async function db(): Promise<PrismaClient> {
  if (!shared.aiOsDb) shared.aiOsDb = (async () => {
    if (process.env.DATABASE_URL) return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 }) });
    if (!config().demo) throw new Error("A dedicated PostgreSQL DATABASE_URL is required.");
    await mkdir(config().dataDir, { recursive: true });
    const lite = await PGlite.create(path.join(config().dataDir, "postgres-demo"));
    shared.aiOsLite = lite;
    await migrateLite(lite);
    return new PrismaClient({ adapter: new PrismaPGlite(lite) });
  })();
  return shared.aiOsDb;
}

export async function audit(client: PrismaClient, kind: string, actor: string, entityId: string | null, detail: unknown = {}) {
  return client.audit.create({ data: { kind, actor, entityId, detail: JSON.parse(JSON.stringify(detail)) } });
}
