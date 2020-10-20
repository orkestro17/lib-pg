import { expect } from "chai";
import { deepStrictEqual as eq } from "assert";
import { getPgStats, PoolClient } from "../src/client";
import { testPool } from "./config";
import { sql } from "../src/tag";

describe("db.sql.client", () => {
  const logs = [];
  const logger = {
    info(...args) {
      logs.push(replaceRandomValues(args));
    },
    error(...args) {
      logs.push(replaceRandomValues(args));
    },
  };

  const db = new PoolClient(testPool, logger);

  afterEach(() => {
    logs.splice(0);
  });

  describe("run()", () => {
    it("executed query and logs duration", async () => {
      const result = await db.run(sql`select pg_sleep(0.055)`);
      eq(logs[0][0], "Query(select pg_sleep(0.055)): SELECT 1");
      eq(logs[0][1].duration >= 50, true, logs[0][1].duration);
      eq(result, [{ pg_sleep: "" }]);
    });

    it("failed query produces informative stacktrace", async () => {
      try {
        await db.run(sql`syntaxError`).then(() => {
          throw new Error("Query did not throw error");
        });
      } catch (e) {
        const lines = e.stack.split("\n");
        eq(
          lines[0],
          'Error: syntaxError [errcode: 42601] syntax error at or near "syntaxError" '
        );
        eq(
          lines.filter((row) => row.indexOf("client.test.js:24")).length > 0,
          true
        );
      }
    });
  });

  describe("transaction()", () => {
    it("executes multiple queries", async () => {
      const result = await db.transaction("testTransaction", (transaction) =>
        Promise.all([
          transaction.run(sql`select 1 as a`),
          transaction.run(sql`select 2 as b`),
        ])
      );
      eq(result, [[{ a: 1 }], [{ b: 2 }]]);
      eq(
        logs.map((row) => row[0]),
        [
          "[txn:testTransaction:<uuid>] Starting transaction",
          "[txn:testTransaction:<uuid>] Query(select 1 as a): SELECT 1",
          "[txn:testTransaction:<uuid>] Query(select 2 as b): SELECT 1",
          "[txn:testTransaction:<uuid>] Transaction committed",
        ]
      );
    });

    it("releases client on error", async () => {
      const query1 = db
        .transaction("query1", (transaction) =>
          Promise.all([
            transaction.run(sql`fail`),
            transaction.run(sql`select 1`),
          ])
        )
        .catch((e) => e);

      const query2 = db
        .transaction("query2", (transaction) =>
          Promise.all([
            transaction.run(sql`select 1`),
            transaction.run(sql`select 2`),
          ])
        )
        .catch((e) => e);

      await query1;
      await query2;

      eq(
        logs.map((args) => args[0]),
        [
          "[txn:query1:<uuid>] Starting transaction",
          "[txn:query1:<uuid>] Query(fail): failed (42601)",
          "[txn:query1:<uuid>] Transaction failed",
          "[txn:query1:<uuid>] Query(select 1): failed (25P02)",
          "[txn:query2:<uuid>] Starting transaction",
          "[txn:query2:<uuid>] Query(select 1): SELECT 1",
          "[txn:query2:<uuid>] Query(select 2): SELECT 1",
          "[txn:query2:<uuid>] Transaction committed",
        ]
      );
    });
  });

  describe("getPg stats", () => {
    it("return info about Pg", async () => {
      const stats = await getPgStats(db);
      const props = [
        "maxConnections",
        "pgStatActivity",
        "pgStatActivity",
        "pgActiveConnections",
      ];
      props.forEach((p) => {
        return expect(stats).has.property(p).with.lengthOf(1);
      });
    });
  });

  describe("transactions", () => {
    it("returns results and logs query", async () => {
      const result = await db.transaction("test", async (t) => {
        return await t.run({ text: "select $1 as x", values: [1] });
      });

      expect(result).to.deep.eq([{ x: "1" }]);
    });

    it("nested transaction using save-points", async () => {
      const result = await db.transaction("test", async (t) => {
        return t.transaction("test2", (tt) => {
          return tt.run({ text: "select $1 as x", values: [1] });
        });
      });

      expect(result).to.deep.eq([{ x: "1" }]);
    });
  });
});

function replaceRandomValues(args: unknown[]) {
  // replace uuids for easier assertions
  return args.map((value) =>
    typeof value === "string"
      ? value.replace(/[0-9a-f-]{36}/g, "<uuid>")
      : value
  );
}
