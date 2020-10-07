import { expect } from "chai";
import * as migration from "../src/migration";
import { getConfigFromEnv } from "../src/config";
import { Client } from "pg";
import { DatabaseOptions } from "../src/types";
import { sql } from "../src/tag";

describe("migration", () => {
  describe("end-to-end", () => {
    const config: DatabaseOptions = {
      ...getConfigFromEnv(process.env),
      migrations: {
        folderLocation: "test/migrations",
        tableName: "test_schema_migrations",
      },
    };
    const client = new Client(config);

    before(async () => {
      await client.connect();
    });

    afterEach(async () => {
      await client.query(sql`drop table if exists test_schema_migrations`);
      await client.query(sql`drop table if exists test_table`);
    });

    after(() => {
      client.end();
    });

    it("successfully runs migrations", async () => {
      await migration.migrateSchema(console, config);

      const { rows: testTableData } = await client.query(
        sql`select * from test_table order by name`
      );

      const { rows: migrationsData } = await client.query(
        sql`select name from test_schema_migrations order by name`
      );

      expect(testTableData).to.eql([{ id: 1, name: "Test" }]);

      expect(migrationsData).to.eql([
        {
          name: "001_create_table.sql",
        },
        {
          name: "002_insert_record.sql",
        },
      ]);
    });

    it("successfully runs migration, when executed in parallel", async () => {
      await Promise.all([
        migration.migrateSchema(console, config),
        migration.migrateSchema(console, config),
        migration.migrateSchema(console, config),
        migration.migrateSchema(console, config),
      ]);

      const { rows: testTableData } = await client.query(
        sql`select * from test_table order by name`
      );

      expect(testTableData).to.eql([{ id: 1, name: "Test" }]);
    });
  });

  describe("validation", () => {
    it("error when name does not follow expected order", () => {
      const act = () =>
        migration.validateState(
          [
            { name: "001_one.sql", hash: "1" },
            { name: "003_two.sql", hash: "2" },
          ],
          []
        );

      expect(act).throws(
        "Found #2 migration named 003_two.sql, but name should start with 002_"
      );
    });

    it("error when record exists on database but not on disk", () => {
      const act = () =>
        migration.validateState([], [{ name: "001_one.sql", hash: "1" }]);

      expect(act).throws("Database migration 001_one.sql is not on disk");
    });

    it("error when there are differently named migrations on disk and database", () => {
      const act = () =>
        migration.validateState(
          [{ name: "001_disk.sql", hash: "1" }],
          [{ name: "001_db.sql", hash: "1" }]
        );

      expect(act).throws(
        "Found migration 001_disk.sql on disk, but a different migration 001_db.sql was found on database"
      );
    });

    it("error when hash of migration on database does not match", () => {
      const act = () =>
        migration.validateState(
          [{ name: "001_one.sql", hash: "1" }],
          [{ name: "001_one.sql", hash: "2" }]
        );

      expect(act).throws(
        "Migration hash don't match (001_one.sql) - was file modified?"
      );
    });

    it("no error when everything is good", () => {
      migration.validateState([{ name: "001_one.sql", hash: "1" }], []);
      migration.validateState(
        [{ name: "001_one.sql", hash: "1" }],
        [{ name: "001_one.sql", hash: "1" }]
      );
    });
  });
});
