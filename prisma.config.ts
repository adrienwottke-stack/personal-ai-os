import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx scripts/seed.ts" },
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "postgresql://build:build@127.0.0.1:1/ai_os_build" },
});
