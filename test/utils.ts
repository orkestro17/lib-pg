import Pg from "pg";
import { Client, ActiveTransactionClient, ActiveClient } from "../src/client";
import { getPgConfig } from "../src/config";
import { migrateSchema } from "../src/migration";
import * as pgTypes from "../src/pg-types";

let pgSetupPromise: Promise<unknown>;

const pgMaintenanceConfig = getPgConfig({ database: "postgres" });
const dbName = process.env.PGDATABASE || "test";
const pgDefaultConfig = getPgConfig({ database: dbName });

// pg error codes
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const INVALID_CATALOG_NAME = "3D000";

async function pgSetup() {
  await ensureDatabaseExists();
  await migrateSchema(console, pgDefaultConfig);
  const conn = new Pg.Client(pgDefaultConfig);
  await conn.connect();
  await pgTypes.initPgTypes(conn);
  await conn.end();
}

async function ensureDatabaseExists() {
  if (!dbName.endsWith("test")) {
    throw new Error(`Tests should run against test database (got: ${dbName})`);
  }
  if (process.env.RESET_DB) {
    await dropDatabase(dbName);
  }
  try {
    const client = new Pg.Client(pgDefaultConfig);
    await client.connect();
    await client.query("select current_database()");
    await client.end();
  } catch (e) {
    if (e.code === INVALID_CATALOG_NAME) {
      const client = new Pg.Client(pgMaintenanceConfig);
      await client.connect();
      await client.query(`create database "${dbName}"`);
      await client.end();
    } else {
      throw e;
    }
  }
}

async function dropDatabase(dbName: string) {
  const client = new Pg.Client(pgMaintenanceConfig);
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

export class TestClient implements Client {
  private pgClient: Pg.Client | null = null;
  private db: Client | null = null;

  constructor({ testInTransaction = true } = {}) {
    before(function () {
      // increase timeout slightly for database setup phase
      this.timeout(6000);
    });

    before(async () => {
      await (pgSetupPromise = pgSetupPromise || pgSetup());
      this.pgClient = new Pg.Client();
      await this.pgClient.connect();
      this.db = new ActiveClient(this.pgClient, console);
    });

    if (testInTransaction) {
      before(async () => {
        if (this.pgClient) {
          await this.pgClient.query("begin transaction");
          await this.pgClient.query("savepoint clean_state");
          this.db = new ActiveTransactionClient(
            this.pgClient,
            console,
            Date.now().toString()
          );
        }
      });

      afterEach(async () => {
        if (this.pgClient) {
          await this.pgClient.query("rollback to savepoint clean_state");
        }
      });

      after(async () => {
        if (this.db) {
          await this.db.run("rollback transaction");
        }
      });
    }

    after(() => {
      if (this.pgClient) {
        this.pgClient.removeAllListeners();
        this.pgClient.end();
        this.pgClient = null;
        this.db = null;
      }
    });
  }

  run<T>(query: Pg.QueryConfig | string): Promise<T[]> {
    if (!this.db) throw new Error("Not connected to database");
    return this.db.run<T>(query);
  }

  transaction<T>(name: string, cb: (client: Client) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error("Not connected to database");
    return this.db.transaction(name, cb);
  }
}
