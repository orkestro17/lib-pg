import { expect } from "chai"
import * as migration from "../src/migration"
import { getPgConfig } from "../src/config"
import { Client } from "pg"
import { sql } from "../src/tag"

describe("migration", () => {
  describe("end-to-end", () => {
    const clientConfig = getPgConfig(process.env)

    const goodMigrations: migration.MigrationsOptions = {
      folderLocation: "test/migrations/success",
      tableName: "test_schema_migrations",
    }
    const failingMigrations: migration.MigrationsOptions = {
      folderLocation: "test/migrations/failure",
      tableName: "test_schema_migrations",
    }

    let client: Client

    beforeEach(async () => {
      client = new Client(clientConfig)
      await client.connect()
      await client.query(sql`drop table if exists test_schema_migrations`)
      await client.query(sql`drop table if exists test_table`)
    })

    afterEach(() => client.end())

    it("successfully runs migrations", async () => {
      await migration.migrateSchema(console, clientConfig, goodMigrations)

      const { rows: testTableData } = await client.query(sql`select * from test_table order by name`)

      const { rows: migrationsData } = await client.query(sql`select name from test_schema_migrations order by name`)

      expect(testTableData).to.eql([
        { id: 1, name: "Test 1" },
        { id: 2, name: "Test 2" },
      ])

      expect(migrationsData).to.eql([
        {
          name: "001_create_table.sql",
        },
        {
          name: "002_insert_record.sql",
        },
      ])
    })

    it("successfully runs migration, when executed in parallel", async () => {
      await Promise.all([
        migration.migrateSchema(console, clientConfig, goodMigrations),
        migration.migrateSchema(console, clientConfig, goodMigrations),
        migration.migrateSchema(console, clientConfig, goodMigrations),
        migration.migrateSchema(console, clientConfig, goodMigrations),
      ])

      const { rows: testTableData } = await client.query(sql`select * from test_table order by name`)

      expect(testTableData).to.eql([
        { id: 1, name: "Test 1" },
        { id: 2, name: "Test 2" },
      ])
    })

    it("stops execution on first error", async () => {
      const migrationResult = await migration.migrateSchema(console, clientConfig, failingMigrations).catch((e) => e)

      expect(migrationResult).to.be.instanceOf(Error)
      expect(migrationResult.message).to.eql(
        'Migration test/migrations/failure/003_error.sql:1 failed: [code 42P01] relation "non_existing_table" does not exist'
      )

      const { rows: migrationsData } = await client.query(sql`select name from test_schema_migrations order by name`)

      expect(migrationsData).to.eql([
        {
          name: "001_create_table.sql",
        },
        {
          name: "002_before_error.sql",
        },
      ])

      const { rows: testTableData } = await client.query(sql`select * from test_table order by name`)
      expect(testTableData).to.eql([{ id: 1, name: "before_error" }])
    })
  })

  describe("validation", () => {
    it("error when name does not follow expected order", () => {
      const act = () =>
        migration.validateState(
          [
            { name: "001_one.sql", hash: "1" },
            { name: "003_two.sql", hash: "2" },
          ],
          []
        )

      expect(act).throws("migration 003_two.sql: prefix should match sequence number of migration (002_)")
    })

    it("error when there are differently named migrations on disk and database", () => {
      const act = () =>
        migration.validateState([{ name: "001_disk.sql", hash: "1" }], [{ name: "001_db.sql", hash: "1" }])

      expect(act).throws("migration 001_disk.sql: name did not matched previously logged migration (001_db.sql)")
    })

    it("error when hash of migration on database does not match", () => {
      const act = () =>
        migration.validateState([{ name: "001_one.sql", hash: "1" }], [{ name: "001_one.sql", hash: "2" }])

      expect(act).throws("migration 001_one.sql: content of migration did not match previously logged migration")
    })

    it("no error when everything is good", () => {
      migration.validateState([{ name: "001_one.sql", hash: "1" }], [])
      migration.validateState([{ name: "001_one.sql", hash: "1" }], [{ name: "001_one.sql", hash: "1" }])
    })
  })
})
