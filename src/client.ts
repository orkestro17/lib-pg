import pg from "pg";
import { v1 as uuid } from "uuid";
import { readFileSync } from "fs";
import { sql } from "./tag";
import * as pgTypes from "./pg-types";
import { QueryConfig } from "./types";

// This can be used to inspect or report number of queries/transactions that are queued up. Number getting high will indicate issue.
let queuedProcessQueries = 0;
let activeProcessTransactions = 0;

async function run<T>(
  queryConfig: string | Pg.QueryConfig,
  pgClient: pg.ClientBase,
  logger: Logger
): Promise<T[]> {
  const { stack: initialStack } = new Error("Query failed");

  await pgTypes.initPgTypesOnce(pgClient);

  const startTime = Date.now();

  queuedProcessQueries++;

  const [error, result] = await pgClient
    .query(queryConfig)
    .then((result) => [null, result])
    .catch((error) => [error, null]);

  queuedProcessQueries--;

  const { command, rowCount } = result || {};
  const duration = Date.now() - startTime;
  const { text, name = null } =
    typeof queryConfig === "string" ? { text: queryConfig } : queryConfig;
  const label = name || text.slice(0, 100) + (text.length > 100 ? "..." : "");
  const logMessage =
    `Query(${label}): ` +
    (error ? `failed (${error.code})` : `${command} ${rowCount}`);

  logger.info(logMessage, { duration, queuedQueries: queuedProcessQueries });

  if (result) {
    return result.rows;
  } else {
    if (
      typeof queryConfig === "object" &&
      queryConfig.ignoreErrorCodes &&
      queryConfig.ignoreErrorCodes.includes(String(error.code))
    ) {
      return [];
    } else {
      // reformat original error to provide additional contextual
      // information that is helpful for debugging
      const values =
        typeof queryConfig === "string" ? [] : queryConfig.values || [];
      const valuesText = values
        .map((val, i) => `  $${i + 1}= ${JSON.stringify(val)}`)
        .join("\n");
      const errorMessage = `${label} [errcode: ${error.code}] ${error.message} \nQuery: ${text} \nValues:\n${valuesText}\n${initialStack}`;

      throw new SqlError(error.code, errorMessage);
    }
  }
}

class SqlError extends Error {
  constructor(public code: string, errMessage: string) {
    super(errMessage);
  }
}

interface Stats {
  maxConnections: unknown;
  pgStatActivity: unknown;
  pgStatDatabase: unknown;
  pgConnectionsStatus: unknown;
  pgActiveConnections: number;
  activeProcessTransactions: number;
  queuedProcessQueries: number;
}

export async function getPgStats(client: Client): Promise<Stats> {
  const maxConnections = await client.run(
    "SELECT * FROM pg_settings WHERE name = 'max_connections'"
  );
  const pgStatActivity = await client.run(
    `SELECT * FROM pg_stat_activity where datname = current_database()`
  );
  const pgStatDatabase = await client.run(
    `SELECT * FROM pg_stat_database where datname = current_database()`
  );
  const [{ sum: pgActiveConnections }] = await client.run<{ sum: number }>(
    "SELECT sum(numbackends) FROM pg_stat_database"
  );
  const pgConnectionsStatus = await client.run(`
  select
    max_conn,
    used,
    res_for_super,
    (max_conn-used - res_for_super) as res_for_normal
  from
    (select count(*) used from pg_stat_activity) t1,
    (select setting::int res_for_super from pg_settings where name=$$superuser_reserved_connections$$) t2,
    (select setting:: int max_conn from pg_settings where name = $$max_connections$$) t3
  `);

  return {
    maxConnections,
    pgStatActivity,
    pgStatDatabase,
    pgConnectionsStatus,
    pgActiveConnections,
    activeProcessTransactions,
    queuedProcessQueries,
  };
}

interface Logger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Gets config for pg.Client/pg.Pool from env Postgresql default env configuration variables (compatable with psql command)
 */
function getEnvConfig() {
  const ca = process.env.PGSSLROOTCERT;
  const key = process.env.PGSSLKEY;
  const cert = process.env.PGSSLCERT;

  return {
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
  };
}

let defaultPool: pg.Pool;

export abstract class Client {
  abstract run<T = unknown>(query: string | Pg.QueryConfig): Promise<T[]>;
  abstract transaction<T>(
    name: string,
    f: (db: Client) => Promise<T>
  ): Promise<T>;
}

export class PoolClient extends Client {
  constructor(private pool: pg.Pool, private logger: Logger) {
    super();
  }

  static default(logger: Logger = console): PoolClient {
    defaultPool = defaultPool || new pg.Pool(getEnvConfig());
    return new PoolClient(defaultPool, logger);
  }

  run<T = unknown>(query: QueryConfig): Promise<T[]> {
    return this.checkoutClient((client) => client.run<T>(query));
  }

  private async checkoutClient<T = unknown>(
    f: (client: Client) => Promise<T>
  ): Promise<T> {
    const pgClient = await this.pool.connect();
    const client = new ActiveClient(pgClient, this.logger);

    try {
      return await f(client);
    } finally {
      pgClient.release();
    }
  }

  async transaction<T>(
    transactionName: string,
    f: (db: Client) => Promise<T>
  ): Promise<T> {
    return this.checkoutClient((client) =>
      client.transaction(transactionName, f)
    );
  }
}

/**
 * A client that was checked out from pool of clients.
 */
class ActiveClient extends Client {
  constructor(private pgClient: pg.ClientBase, private logger: Logger) {
    super();
  }

  run<T = unknown>(query: string | Pg.QueryConfig): Promise<T[]> {
    return run(query, this.pgClient, this.logger);
  }

  async transaction<T>(
    transactionName: string,
    f: (db: Client) => Promise<T>
  ): Promise<T> {
    const { pgClient } = this;
    const txnId = uuid();
    const transactionFail = new Error(`Transaction ${transactionName} failed`);
    const start = Date.now();
    activeProcessTransactions++;
    const transactionClient = new ActiveTransactionClient(
      pgClient,
      this.logger,
      txnId
    );

    this.logger.info(
      `[txn: ${txnId}] Starting transaction ${transactionName}`,
      {
        activeTransactions: activeProcessTransactions,
      }
    );

    try {
      await pgClient.query("begin");

      return await f(transactionClient)
        .then(async (result) => {
          await pgClient.query("commit");
          this.logger.info(
            `[txn: ${txnId}] Transaction ${transactionName} committed`,
            {
              duration: Date.now() - start,
            }
          );
          return result;
        })
        .catch(async (error) => {
          this.logger.info(transactionFail);

          try {
            await pgClient.query("rollback");
          } catch (error) {
            this.logger.info(
              `[txn: ${txnId}] Failed to rollback transaction: `,
              error
            );
          }

          throw error;
        });
    } finally {
      activeProcessTransactions--;
    }
  }
}

/**
 * Client that is used when transaction is opened.
 *
 * Adds logging information about transaction,
 * implements transaction() as savepoint
 */
class ActiveTransactionClient extends Client {
  constructor(
    private pgClient: pg.ClientBase,
    private logger: Logger,
    private txnId: string
  ) {
    super();
  }

  run<T = unknown>(query: string | Pg.QueryConfig): Promise<T[]> {
    return run(query, this.pgClient, this.logger);
  }

  async transaction<T>(
    transactionName: string,
    f: (client: Client) => T | Promise<T>
  ): Promise<T> {
    // support for nested transactions with save points
    const { txnId } = this;

    const savepoint = sql.id(transactionName.toLowerCase());

    this.logger.info(`[txn: ${txnId}] Creating savepoint ${transactionName}`);
    await this.pgClient.query(sql`savepoint ${savepoint}`);

    try {
      const result = await f(this);

      this.logger.info(
        `[txn: ${txnId}] Releasing savepoint ${transactionName}`
      );
      await this.pgClient.query(sql`release savepoint ${savepoint}`);

      return result;
    } catch (error) {
      this.logger.info(
        `[txn: ${txnId}] Savepoint failed, rolling back ${savepoint}`,
        error
      );

      try {
        await this.pgClient.query(sql`rollback to savepoint ${savepoint}`);
      } catch (error) {
        this.logger.info(`[txn: ${txnId}] Failed to rollback savepoint`, error);
      }

      throw error;
    }
  }
}
