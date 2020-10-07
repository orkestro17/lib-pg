import { expect } from "chai";
import * as migration from "../src/migration";

describe("migration", () => {
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
