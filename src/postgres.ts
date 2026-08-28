import { readFileSync } from "node:fs";
import { Pool } from "pg";

export function createPostgresPool(connectionString: string): Pool {
  const caPath = process.env.POSTGRES_CA_CERT_PATH;
  const inlineCa = process.env.POSTGRES_CA_CERT?.replaceAll("\\n", "\n");
  const ca = inlineCa ?? (caPath ? readFileSync(caPath, "utf8") : undefined);
  const runningOnVercel = Boolean(process.env.VERCEL);
  return new Pool({
    connectionString,
    ...(ca
      ? {
          ssl: {
            ca,
            rejectUnauthorized: true,
          },
        }
      : {}),
    max: Number.parseInt(
      process.env.POSTGRES_POOL_SIZE ?? (runningOnVercel ? "3" : "10"),
      10,
    ),
    ...(runningOnVercel
      ? { idleTimeoutMillis: 5_000, allowExitOnIdle: true }
      : {}),
  });
}
