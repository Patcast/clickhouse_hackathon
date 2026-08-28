import type { FastifyInstance } from "fastify";
import { ClickHouseAnalyticsStore } from "./analytics.js";
import { createApp } from "./create-app.js";
import { loadSeedPassage } from "./content.js";
import { MemoryPassageRepository } from "./memory-repository.js";
import { createPostgresPool } from "./postgres.js";
import { PostgresPassageRepository } from "./postgres-repository.js";

export interface AppRuntime {
  app: FastifyInstance;
  close(): Promise<void>;
}

export function createRuntime(instance?: FastifyInstance): AppRuntime {
  const databaseUrl = process.env.DATABASE_URL;
  const repository = databaseUrl
    ? new PostgresPassageRepository(createPostgresPool(databaseUrl))
    : new MemoryPassageRepository([loadSeedPassage()]);

  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const analytics = clickhouseUrl
    ? new ClickHouseAnalyticsStore({
        url: clickhouseUrl,
        username: process.env.CLICKHOUSE_USERNAME ?? "default",
        password: process.env.CLICKHOUSE_PASSWORD ?? "",
        database: process.env.CLICKHOUSE_DATABASE ?? "default",
      })
    : undefined;

  const host = process.env.HOST ?? "127.0.0.1";
  const configuredTeamLab = process.env.ENABLE_TEAM_LAB;
  const serveTeamLab =
    configuredTeamLab === undefined
      ? process.env.NODE_ENV !== "production" &&
        ["127.0.0.1", "localhost", "::1"].includes(host)
      : configuredTeamLab === "true";
  const teamLabAccessToken = process.env.TEAM_LAB_ACCESS_TOKEN;
  if (process.env.NODE_ENV === "production" && !teamLabAccessToken) {
    throw new Error(
      "TEAM_LAB_ACCESS_TOKEN is required for the production API",
    );
  }

  const app = createApp({
    repository,
    repositoryMode: databaseUrl ? "postgres" : "memory",
    ...(analytics ? { analytics } : {}),
    corsOrigins: (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    logger: true,
    serveTeamLab,
    ...(teamLabAccessToken ? { teamLabAccessToken } : {}),
    secureTeamLabCookie: process.env.NODE_ENV === "production",
  }, instance);

  return {
    app,
    async close() {
      await app.close();
      await analytics?.close?.();
      await repository.close?.();
    },
  };
}
