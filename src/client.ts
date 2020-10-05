import Glob from "fast-glob";
import pg from "pg";
import { v1 as uuid } from "uuid";
import { readFileSync } from "fs";
import { splitSqlText } from "./split-statements";
import { sql } from "./tag";
import * as pgTypes from "./pg-types";

// This can be used to inspect or report number of queries/transactions that are queued up. Number getting high will indicate issue.
let queuedQueries = 0;
let activeTransactions = 0;

async function runSql<T>(
  queryConfig: string | Pg.QueryConfig,
  pgClient: pg.ClientBase | pg.Pool,
  logger: Logger
): Promise<T[]> {
  const { stack: initialStack } = new Error("Query failed");

  await pgTypes.initPgTypesOnce(pgClient);

  const startTime = Date.now();

  queuedQueries++;

  const [error, result] = await pgClient
    .query(queryConfig)
    .then((result) => [null, result])
    .catch((error) => [error, null]);

  queuedQueries--;

  const { command, rowCount } = result || {};
  const duration = Date.now() - startTime;
  const { text, name = null } =
    typeof queryConfig === "string" ? { text: queryConfig } : queryConfig;
  const label = name || text.slice(0, 100) + (text.length > 100 ? "..." : "");
  const logMessage =
    `Query(${label}): ` +
    (error ? `failed (${error.code})` : `${command} ${rowCount}`);

  logger.info(logMessage, { duration, queuedQueries });

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

async function getPgStats(client: Lib.Sql.Client) {
  const maxConnections = await client.run(
    "SELECT * FROM pg_settings WHERE name = 'max_connections'"
  );
  const pgStatActivity = await client.run(
    `SELECT * FROM pg_stat_activity where datname = current_database()`
  );
  const pgStatDatabase = await client.run(
    `SELECT * FROM pg_stat_database where datname = current_database()`
  );
  const pgActiveConnections = await client.run(
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
    activeTransactions,
    queuedQueries,
  };
}

interface Logger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

class PoolClient implements Lib.Sql.Client {
  constructor(private pool: pg.Pool, private logger: Logger) {}

  run<T = unknown>(query: string | Pg.QueryConfig): Promise<T[]> {
    return runSql(query, this.pool, this.logger);
  }

  async checkoutClient<T = unknown>(
    f: (client: Client) => Promise<T>
  ): Promise<T> {
    const pgClient = await this.pool.connect();
    const client = new Client(pgClient, this.logger);

    try {
      return await f(client);
    } finally {
      pgClient.release();
    }
  }

  async transaction<T>(
    transactionName: string,
    f: (db: Lib.Sql.Client) => Promise<T>
  ): Promise<T> {
    return this.checkoutClient((client) =>
      client.transaction(transactionName, f)
    );
  }
}

class Client implements Lib.Sql.Client {
  constructor(
    private pgClient: pg.ClientBase | pg.PoolClient,
    private logger: Logger
  ) {}

  run<T = unknown>(query: string | Pg.QueryConfig): Promise<T[]> {
    return runSql(query, this.pgClient, this.logger);
  }

  async transaction<T>(
    transactionName: string,
    f: (db: Lib.Sql.Client) => Promise<T>
  ): Promise<T> {
    const { pgClient } = this;
    const txnId = uuid();
    const transactionFail = new Error(`Transaction ${transactionName} failed`);
    const start = Date.now();
    activeTransactions++;
    const transactionClient = new TransactionClient(
      pgClient,
      this.logger,
      txnId
    );

    this.logger.info(
      `[txn: ${txnId}] Starting transaction ${transactionName}`,
      {
        activeTransactions,
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
      activeTransactions--;
    }
  }

  async runFile(fileName: string) {
    const content = readFileSync(fileName).toString();
    for (const row of splitSqlText(content)) {
      await this.run({
        text: row.queryText,
        ignoreErrorCodes: row.ignoreErrorCodes,
      });
    }
  }

  async runFilesIn(...directories: string[]) {
    for (const arg of directories) {
      for (const f of await Glob(arg)) {
        await this.runFile(f);
      }
    }
  }
}

class TransactionClient implements Lib.Sql.Client {
  constructor(
    private pgClient: pg.ClientBase,
    private logger: Logger,
    private txnId: string
  ) {}

  run<T = unknown>(query: string | Pg.QueryConfig): Promise<T[]> {
    return runSql(query, this.pgClient, this.logger);
  }

  async transaction<T>(
    transactionName: string,
    f: (client: Lib.Sql.Client) => T | Promise<T>
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

module.exports = {
  connectionString: "",
  getPgStats,
  PoolClient,
  Client,
  TransactionClient,
};
