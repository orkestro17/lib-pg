import { readFileSync } from "fs";
import { Pool, PoolConfig } from "pg";

export function createPoolFromEnv(extraOptions: PoolConfig = {}): Pool {
  const ca = process.env.PGSSLROOTCERT;
  const key = process.env.PGSSLKEY;
  const cert = process.env.PGSSLCERT;

  return new Pool({
    host: process.env.PGHOST || "127.0.0.1",
    port: parseInt(process.env.PGPORT || "5432", 10),
    user: process.env.PGUSER || "postgres",
    database: process.env.PGDATABASE || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    max: parseInt(process.env.PG_MAX_POOL_SIZE || "10", 10),
    min: parseInt(process.env.PG_MIN_POOL_SIZE || "2", 10),
    ssl: ca
      ? {
          ca: readFileSync(ca).toString(),
          key: key && readFileSync(key).toString(),
          cert: cert && readFileSync(cert).toString(),
        }
      : undefined,
    ...extraOptions,
  });
}
