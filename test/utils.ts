import log from "../log";
import Pg from "pg";
import {
  runSql,
  pool,
  runSqlFiles,
  dbName,
  TransactionClient,
  PoolClient,
} from "./client";
import pgTypes from "./pg-types";
import pgConnConfig from "config/pg";

let pgSetupPromise;

const maintenanceConfig = { ...pgConnConfig, database: "postgres" };

async function pgSetup() {
  await ensureDatabaseExists();
  await runSqlFiles("schema/*.sql");
  await pgTypes.initPgTypes(pool);
}

if (typeof after !== "undefined") {
  after(async function () {
    this.timeout(10000);
    if (pgSetupPromise) {
      await pgSetupPromise;
      await pool.end();
    }
  });
}

async function ensureDatabaseExists() {
  if (pool.idleCount > 0) {
    throw new Error(
      "There are idle connections, cannot run db setup scripts, did you forgot to add usingPg() in some of tests?"
    );
  }
  if (!dbName.endsWith("test")) {
    throw new Error(`Tests should run against test database (got: ${dbName})`);
  }
  if (process.env.RESET_DB) {
    await dropDatabase(dbName);
  }
  try {
    const client = new Pg.Client(pgConnConfig);
    await client.connect();
    await client.query("select current_database()");
    await client.end();
  } catch (e) {
    if (e.code === "3D000") {
      // db-does-not-exist
      const client = new Pg.Client({ ...pgConnConfig, database: "postgres" });
      await client.connect();
      await client.query(`create database "${dbName}"`);
      await client.end();
    } else {
      throw e;
    }
  }
}

async function dropDatabase(dbName) {
  const client = new Pg.Client(maintenanceConfig);
  await client.connect();
  try {
    await client.query(
      `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1;`,
      [dbName]
    ); // disconnects any connected clients
    await client.query(`drop database "${dbName}"`);
  } catch (e) {
    if (e.code === "3D000") {
      // db-does-not-exist
    } else {
      throw e;
    }
  }
  await client.end();
}
/**
 * @param {{
 * isolation?: 'transaction' | 'cleanup' | 'none'
 * }} param0
 * @returns {{now: Date, db: Lib.Sql.Client}}
 */
export function usingPg({ isolation = "transaction" } = {}) {
  /** @type {{now: Date, db: Lib.Sql.Client}} */
  const context = {
    now: new Date(),
    db: null,
  };

  before(async function () {
    // increase timeout slightly for database setup phase
    this.timeout(6000);
    await (pgSetupPromise = pgSetupPromise || pgSetup());
  });

  if (isolation == "transaction") {
    before(async function () {
      await pgSetupPromise;
      // const poolClient = await pool.connect()
      const db = new TransactionClient(pool, log);
      context.db = db;
      // context.poolClient = poolClient
      await db.run("begin transaction");
      const [row] = await db.run("select now() as now");
      context.now = row.now;
    });
    after(async function () {
      try {
        await pgSetupPromise;
        await context.db.run("rollback transaction");
      } catch (error) {
        console.log(error);
      }
    });
    beforeEach(async function () {
      await pgSetupPromise;
      await context.db.run("savepoint before_each");
    });
    afterEach(async function () {
      await pgSetupPromise;
      await context.db.run("rollback to savepoint before_each");
    });
  }

  if (isolation == "cleanup") {
    before(async function () {
      const db = new PoolClient(pool, log);
      context.db = db;
      await db.run("begin transaction");
      const [row] = await db.run("select now() as now");
      context.now = row.now;
    });
    afterEach(async () => {
      await Promise.all([
        runSql("truncate table organization cascade"),
        runSql("truncate table driver_locations cascade"),
        runSql("truncate table task_locations cascade"),
        runSql("truncate table drivers cascade"),
        runSql("truncate table merchant cascade"),
        runSql("truncate table fleet cascade"),
        runSql('truncate table "user" cascade'),
        runSql("truncate table token cascade"),
      ]);
    });
  }

  return context;
}
