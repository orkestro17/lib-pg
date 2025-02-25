import Pg from "pg"
import { Client, ActiveTransactionClient, ActiveClient } from "./client"
import { getPgConfig } from "./config"
import { migrateSchema } from "./migration"
import * as pgTypes from "./pg-types"
import { Logger } from "./types"
import { beforeAll, afterAll, afterEach } from "@jest/globals"

let pgSetupPromise: Promise<unknown>

class NullLogger implements Logger {
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  debug(message: string, ...args: unknown[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  info(message: string, ...args: unknown[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  warn(message: string, ...args: unknown[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  error(message: string, ...args: unknown[]): void {}
}

const config = {
  pgDefault: getPgConfig(process.env, { database: "test" }),
  pgMaintenance: { ...getPgConfig(process.env), database: "postgres" },
}

async function pgSetup(logger = new NullLogger()) {
  await createDatabase()
  await migrateSchema(logger, config.pgDefault)
  const conn = new Pg.Client(config.pgDefault)
  await conn.connect()
  await pgTypes.initPgTypes(conn)
  await conn.end()
}

async function createDatabase() {
  const { database: dbName } = config.pgDefault
  if (!dbName || !dbName.endsWith("test")) {
    throw new Error(`Tests should run against test database (got: ${config.pgDefault.database})`)
  }
  const client = new Pg.Client(config.pgMaintenance)
  await client.connect()

  try {
    if (process.env.RESET_DB) {
      await client.query(`drop database if exists "${dbName}"`)
    }

    const { rowCount: dbExists } = await client.query("select 1 from pg_database where datname = $1", [dbName])

    if (!dbExists) {
      await client.query(`create database "${dbName}"`)
    }
  } finally {
    await client.end()
  }
}

export class TestClient implements Client {
  protected pgClient: Pg.Client | null = null
  protected db: Client | null = null

  constructor({ testInTransaction = true, logger = new NullLogger() } = {}) {
    before(function () {
      // increase timeout slightly for database setup phase
      // eslint-disable-next-line no-invalid-this
      this.timeout(6000)
    })

    before(async () => {
      await (pgSetupPromise = pgSetupPromise || pgSetup())
      this.pgClient = new Pg.Client()
      await this.pgClient.connect()
      this.db = new ActiveClient(this.pgClient, logger)
    })

    if (testInTransaction) {
      before(async () => {
        if (this.pgClient) {
          await this.pgClient.query("begin transaction")
          await this.pgClient.query("savepoint clean_state")
          this.db = new ActiveTransactionClient(this.pgClient, logger)
        }
      })

      afterEach(async () => {
        if (this.pgClient) {
          await this.pgClient.query("rollback to savepoint clean_state")
        }
      })

      after(async () => {
        if (this.db) {
          await this.db.run("rollback transaction")
        }
      })
    }

    after(async () => {
      if (this.pgClient) {
        this.pgClient.removeAllListeners()
        await this.pgClient.end()
        this.pgClient = null
        this.db = null
      }
    })
  }

  run<T>(query: Pg.QueryConfig | string): Promise<T[]> {
    if (!this.db)
      throw new Error(
        "TestClient.run() can only be used from within before(), beforeEach(), it(), afterEach(), after()"
      )
    return this.db.run<T>(query)
  }

  transaction<T>(name: string, cb: (client: Client) => Promise<T>): Promise<T> {
    if (!this.db)
      throw new Error(
        "TestClient.transaction() can only be used from within before(), beforeEach(), it(), afterEach(), after()"
      )
    return this.db.transaction(name, cb)
  }
}

export class JestTestClient extends TestClient {
  constructor({ testInTransaction = true, logger = new NullLogger() } = {}) {
    super({ testInTransaction: false, logger }) // Desactivamos la lógica de transacción del padre

    // Configuración inicial
    beforeAll(async () => {
      await (pgSetupPromise = pgSetupPromise || pgSetup())
      this.pgClient = new Pg.Client()
      await this.pgClient.connect()
      this.db = new ActiveClient(this.pgClient, logger)
    })

    if (testInTransaction) {
      beforeAll(async () => {
        if (this.pgClient) {
          await this.pgClient.query("begin transaction")
          await this.pgClient.query("savepoint clean_state")
          this.db = new ActiveTransactionClient(this.pgClient, logger)
        }
      })

      afterEach(async () => {
        if (this.pgClient) {
          await this.pgClient.query("rollback to savepoint clean_state")
        }
      })

      afterAll(async () => {
        if (this.db) {
          await this.db.run("rollback transaction")
        }
      })
    }

    // Limpieza final
    afterAll(async () => {
      if (this.pgClient) {
        this.pgClient.removeAllListeners()
        await this.pgClient.end()
        this.pgClient = null
        this.db = null
      }
    })
  }
}
