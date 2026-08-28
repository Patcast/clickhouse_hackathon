import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPostgresPool } from "../src/postgres.js";

const connectionString =
  process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_DIRECT_URL or DATABASE_URL before migrating");
}

const pool = createPostgresPool(connectionString);
try {
  const directory = resolve("db/postgres");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8");
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}
