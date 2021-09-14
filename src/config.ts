import { readFileSync } from "fs"
import { PoolConfig } from "pg"

export function getPgConfig(env: NodeJS.ProcessEnv, defaults: PoolConfig = {}): PoolConfig {
  const ca = env.PGSSLROOTCERT
  const key = env.PGSSLKEY
  const cert = env.PGSSLCERT
  const servername = env.PGSERVERNAME

  return {
    host: env.PGHOST || defaults.host || "127.0.0.1",
    port: parseInt(`${env.PGPORT || defaults.port || "5432"}`, 10),
    user: env.PGUSER || defaults.user || "postgres",
    database: env.PGDATABASE || defaults.database || "postgres",
    password: env.PGPASSWORD || defaults.password || "postgres",
    max: parseInt(`${env.PG_MAX_POOL_SIZE || defaults.max || "10"}`, 10),
    min: parseInt(`${env.PG_MIN_POOL_SIZE || defaults.min || "2"}`, 10),
    ssl:
      ca || key || cert
        ? {
            ca: ca && readFileSync(ca).toString(),
            key: key && readFileSync(key).toString(),
            cert: cert && readFileSync(cert).toString(),
            servername,
          }
        : defaults.ssl,
  }
}
