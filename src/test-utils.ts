import Pg from "pg";
import { Client, ActiveTransactionClient, ActiveClient } from "../src/client";
import { getPgConfig } from "../src/config";
import { migrateSchema } from "../src/migration";
import * as pgTypes from "../src/pg-types";

let pgSetupPromise: Promise<unknown>;

const config = {
  pgDefault: getPgConfig(process.env, { database: "test" }),
  pgMaintenance: { ...getPgConfig(process.env), database: "postgres" },
};

async function pgSetup() {
  await createDatabase();
  await migrateSchema(console, config.pgDefault);
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
          this.db = new ActiveTransactionClient(this.pgClient, console);
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
