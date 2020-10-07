import { readFileSync } from "fs";
import { DatabaseOptions } from "./types";

export function getConfigFromEnv(env: NodeJS.ProcessEnv): DatabaseOptions {
  const ca = env.PGSSLROOTCERT;
  const key = env.PGSSLKEY;
  const cert = env.PGSSLCERT;

  return {
    migrations: {
      tableName: "schema_migrations",
      folderLocation: "migrations",
    },
    host: env.PGHOST || "127.0.0.1",
    port: parseInt(env.PGPORT || "5432", 10),
    user: env.PGUSER || "postgres",
    database: env.PGDATABASE || "postgres",
    password: env.PGPASSWORD || "postgres",
    max: parseInt(env.PG_MAX_POOL_SIZE || "10", 10),
    min: parseInt(env.PG_MIN_POOL_SIZE || "2", 10),
    ssl: ca
      ? {
          ca: readFileSync(ca).toString(),
          key: key && readFileSync(key).toString(),
          cert: cert && readFileSync(cert).toString(),
        }
      : undefined,
  };
}
