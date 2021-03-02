import Pg from "pg";
import { Client, ActiveTransactionClient, ActiveClient } from "./client";
import { getPgConfig } from "./config";
import { migrateSchema } from "./migration";
import * as pgTypes from "./pg-types";
import { Logger } from "./types";

let pgSetupPromise: Promise<unknown>;

class NullLogger implements Logger {
  info(message: string, ...args: unknown[]): void {}
  warn(message: string, ...args: unknown[]): void {}
  error(message: string, ...args: unknown[]): void {}
}

const config = {
  pgDefault: getPgConfig(process.env, { database: "test" }),
  pgMaintenance: { ...getPgConfig(process.env), database: "postgres" },
};

async function pgSetup(logger = new NullLogger()) {
  await createDatabase();
  await migrateSchema(logger, config.pgDefault);
  const conn = new Pg.Client(config.pgDefault);
  await conn.connect();
  await pgTypes.initPgTypes(conn);
  await conn.end();
}

async function createDatabase() {
  const { database: dbName } = config.pgDefault;
  if (!dbName || !dbName.endsWith("test")) {
    throw new Error(
      `Tests should run against test database (got: ${config.pgDefault.database})`
    );
  }
  const client = new Pg.Client(config.pgMaintenance);
  await client.connect();

  try {
    if (process.env.RESET_DB) {
      await client.query(`drop database if exists "${dbName}"`);
    }

    const {
      rowCount: dbExists,
    } = await client.query("select 1 from pg_database where datname = $1", [
      dbName,
    ]);

    if (!dbExists) {
      await client.query(`create database "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}

export class TestClient implements Client {
  private pgClient: Pg.Client | null = null;
  private db: Client | null = null;

  constructor({ testInTransaction = true, logger = new NullLogger() } = {}) {
    before(function () {
      // increase timeout slightly for database setup phase
      this.timeout(6000);
    });

    before(async () => {
      await (pgSetupPromise = pgSetupPromise || pgSetup());
      this.pgClient = new Pg.Client();
      await this.pgClient.connect();
      this.db = new ActiveClient(this.pgClient, logger);
    });

    if (testInTransaction) {
      before(async () => {
        if (this.pgClient) {
          await this.pgClient.query("begin transaction");
          await this.pgClient.query("savepoint clean_state");
          this.db = new ActiveTransactionClient(this.pgClient, logger);
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
    if (!this.db)
      throw new Error(
        "TestClient.run() can only be used from within before(), beforeEach(), it(), afterEach(), after()"
      );
    return this.db.run<T>(query);
  }

  transaction<T>(name: string, cb: (client: Client) => Promise<T>): Promise<T> {
    if (!this.db)
      throw new Error(
        "TestClient.transaction() can only be used from within before(), beforeEach(), it(), afterEach(), after()"
      );
    return this.db.transaction(name, cb);
  }
}
