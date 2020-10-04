import Glob from "fast-glob";
import Pg from "pg";
import Uuid from "uuid/v1";
import { pg as config } from "config";
import _log from "lib/log";
import { readFileSync } from "fs";
import { splitSqlText } from "./split-statements";
import { sql } from "./tag";
import PgTypes from "./pg-types";

const [dbName] = /[a-z_]+$/.exec(config.database);

_log("Using postgresql database", dbName, "on host", config.host);

const pool = new Pg.Pool(config);

// This can be used to inspect or report number of queries/transactions that are queued up. Number getting high will indicate issue.
let queuedQueries = 0;
let queuedTransactions = 0;

/**
 *
 * Don't USE IT!!!! use PoolClient
 *
 * @template T
 * @param {Pg.QueryConfig | string} queryConfig
 * @param {Ork.Context} ctx
 * @returns {Promise<T[]>}
 */
async function runSql(queryConfig, ctx = {}) {
  const { log = _log, pgClient = pool } = ctx;
  const { stack: initialStack } = new Error("Query failed");

  await PgTypes.initPgTypesOnce(pgClient);

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

  log(logMessage, { duration, queuedQueries });

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
  constructor(code, errMessage) {
    super(errMessage);
    this.code = code;
  }
}

/**
 *
 * @param {string} name
 * @param {Pg.QueryConfig[]} queries
 * @param {Ork.Context} ctx
 * @returns {Promise<any[][]>}
 */
function runMultiSql(name, queries, ctx = {}) {
  return transaction(name, ctx, (ctx) => {
    return Promise.all(queries.map((query) => runSql(query, ctx)));
  });
}

/**
 *
 * @template T
 * @param {string} name
 * @param {Ork.Context & {pgTxnId?: string}} ctx
 * @param {(ctx: Ork.Context) => Promise<T>} f
 * @returns {Promise<T>}
 */
async function transaction(name, ctx = {}, f) {
  const start = Date.now();
  let { pgPool = pool, log = _log, pgTxnId = Uuid() } = ctx;
  const transactionError = new Error(
    `Query transaction ${name}[${pgTxnId}] failed`
  );
  log = log.bind(null, { pgTxnId });

  queuedTransactions++;

  let result;
  const client = await pgPool.connect();

  try {
    /** @type {Ork.Context} */
    const newContext = { ...ctx, pgClient: client, log };
    await runSql("begin", newContext);
    result = await f(newContext);
    await runSql("commit", newContext);
    log(`Query transaction ${name} success`, {
      duration: Date.now() - start,
      queuedTransactions,
    });
    return result;
  } catch (e) {
    log(`Query transaction ${name} failed: `, e.message, {
      duration: Date.now() - start,
      queuedTransactions,
    });
    try {
      await client.query("rollback");
    } catch (e) {
      log(
        new Error(
          `Additional error occoured while rolling back a transaction: ${e.stack}\n${transactionError.stack}`
        )
      );
    }
    throw e;
  } finally {
    queuedTransactions--;
    client.release();
  }
}

/**
 *
 * @param {string} fileName
 * @param {Ork.Context} ctx
 */
async function runSqlFile(fileName, ctx = {}) {
  const content = readFileSync(fileName).toString();
  for (const row of splitSqlText(content)) {
    await runSql(
      { text: row.queryText, ignoreErrorCodes: row.ignoreErrorCodes },
      ctx
    );
  }
}

async function runSqlFiles(...args) {
  for (const arg of args) {
    for (const f of await Glob(arg)) {
      await runSqlFile(f);
    }
  }
}

async function getPgStats() {
  const maxConnections = await runSql(
    "SELECT * FROM pg_settings WHERE name = 'max_connections'"
  );
  const pgStatActivity = await runSql(
    `SELECT * FROM pg_stat_activity where datname = '${config.database}'`
  );
  const pgStatDatabase = await runSql(
    `SELECT * FROM pg_stat_database where datname = '${config.database}'`
  );
  const pgActiveConnections = await runSql(
    "SELECT sum(numbackends) FROM pg_stat_database"
  );
  const pgConnectionsStatus = await runSql(`
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
  };
}

/** @implements {Lib.Sql.Client} */
class PoolClient {
  /**
   * @param {Pg.Pool} _pool
   * @param {Function} log
   */
  constructor(_pool, log) {
    this._log = log;
    this._pool = _pool;
    this._activeTransactions = 0;
  }

  run(query) {
    return runSql(query, { log: this._log, pgPool: this._pool });
  }

  async transaction(transactionName, f) {
    const client = await this._pool.connect();
    const transactionId = Uuid();
    const log = this._log.bind(`[txnId:${transactionId}]`);
    const transactionFail = new Error(`Transaction ${transactionName} failed`);
    const start = Date.now();
    this._activeTransactions++;
    const transactionClient = new TransactionClient(client, log);

    log(`Starting transaction ${transactionName}`, {
      activeTransactions: this._activeTransactions,
    });

    try {
      await client.query("begin");

      return await f(transactionClient)
        .then(async (result) => {
          await client.query("commit");
          log(`Transaction ${transactionName} committed`, {
            duration: Date.now() - start,
          });
          return result;
        })
        .catch(async (error) => {
          log(transactionFail);

          try {
            await client.query("rollback");
          } catch (error) {
            log("Failed to rollback transaction: ", error);
          }

          throw error;
        });
    } finally {
      this._activeTransactions--;
      client.release();
    }
  }
}

/**
 *
 * Db client used inside transaction,
 * implements transaction() method using save points to
 * support nested transaction calls.
 *
 * @implements {Lib.Sql.Client} */
class TransactionClient {
  /**
   * @param {any} poolClient The correct type is Pg.Client but for testing reason it's any.
   *                         At the end when runSql will bie fixed (removed) we will come
   *                         back to Pg.Client.
   * @param {Function} log
   */
  constructor(poolClient, log) {
    this._poolClient = poolClient;
    this._log = log;
  }

  /**
   *
   * @param {Pg.QueryConfig | string} query
   */
  run(query) {
    return runSql(query, { log: this._log, pgClient: this._poolClient });
  }

  /**
   * @param {string} transactionName
   * @param {Function} f
   */
  async transaction(transactionName, f) {
    // support for nested transactions with save points

    const savepoint = sql.id(transactionName.toLowerCase());

    this._log(`Creating savepoint ${transactionName}`);
    await this._poolClient.query(sql`savepoint ${savepoint}`);

    try {
      const result = await f(this);

      this._log(`Releasing savepoint ${transactionName}`);
      await this._poolClient.query(sql`release savepoint ${savepoint}`);

      return result;
    } catch (error) {
      this._log(`Savepoint failed, rolling back ${savepoint}`, error);

      try {
        await this._poolClient.query(sql`rollback to savepoint ${savepoint}`);
      } catch (error) {
        this._log("Failed to rollback savepoint", error);
      }

      throw error;
    }
  }
}

module.exports = {
  connectionString: "",
  dbName,
  pool,
  runSql,
  runMultiSql,
  transaction,
  runSqlFile,
  runSqlFiles,
  getPgStats,
  PoolClient,
  TransactionClient,
};
