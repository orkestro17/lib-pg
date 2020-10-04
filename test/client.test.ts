import { expect } from "chai";
import { deepStrictEqual as eq } from "assert";
import { pool, runSql, transaction, getPgStats, PoolClient } from "lib/sql";
import { usingPg } from "../src/testing";
import LogMock from "lib/log.mock";

describe("db.sql.client", () => {
  usingPg({ isolation: "none" });
  const logs = [];
  const log = (...args) => logs.push(args);

  afterEach(() => {
    logs.splice(0);
  });

  describe("query()", () => {
    it("executed query and logs duration", async () => {
      const result = await runSql("select pg_sleep(0.055)", { log });
      eq(logs[0][0], "Query(select pg_sleep(0.055)): SELECT 1");
      eq(logs[0][1].duration >= 50, true, logs[0][1].duration);
      eq(result, [{ pg_sleep: "" }]);
    });

    it("failed query produces informative stacktrace", async () => {
      try {
        await runSql("syntaxError", { log }).then((r) => {
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
      const result = await transaction(
        "testTransaction",
        { log, pgTxnId: "test-txn" },
        (ctx) =>
          Promise.all([
            runSql("select 1 as a", ctx),
            runSql("select 2 as b", ctx),
          ])
      );
      eq(result, [[{ a: 1 }], [{ b: 2 }]]);
      eq(
        logs.map((row) => row.slice(0, 2)),
        [
          [{ pgTxnId: "test-txn" }, "Query(begin): BEGIN null"],
          [{ pgTxnId: "test-txn" }, "Query(select 1 as a): SELECT 1"],
          [{ pgTxnId: "test-txn" }, "Query(select 2 as b): SELECT 1"],
          [{ pgTxnId: "test-txn" }, "Query(commit): COMMIT null"],
          [
            { pgTxnId: "test-txn" },
            "Query transaction testTransaction success",
          ],
        ]
      );
    });

    it("executes multiple queries", async () => {
      const result = await transaction(
        "testTransaction",
        { log, pgTxnId: "test-txn" },
        (ctx) =>
          Promise.all([
            runSql("select 1 as a", ctx),
            runSql("select 2 as b", ctx),
          ])
      );
      eq(result, [[{ a: 1 }], [{ b: 2 }]]);
      eq(
        logs.map((row) => row.slice(0, 2)),
        [
          [{ pgTxnId: "test-txn" }, "Query(begin): BEGIN null"],
          [{ pgTxnId: "test-txn" }, "Query(select 1 as a): SELECT 1"],
          [{ pgTxnId: "test-txn" }, "Query(select 2 as b): SELECT 1"],
          [{ pgTxnId: "test-txn" }, "Query(commit): COMMIT null"],
          [
            { pgTxnId: "test-txn" },
            "Query transaction testTransaction success",
          ],
        ]
      );
    });

    it("releases client on error", async () => {
      const query1 = transaction(
        "query1",
        {
          log,
          pgTxnId: "query1",
        },
        (ctx) => Promise.all([runSql("fail", ctx), runSql("select 1", ctx)])
      ).catch((e) => e);

      const query2 = transaction("query2", { log, pgTxnId: "query2" }, (ctx) =>
        Promise.all([runSql("select 1", ctx), runSql("select 2", ctx)])
      ).catch((e) => e);

      await query1;
      await query2;

      eq(
        logs.map((row) => row.slice(0, 2)),
        [
          [{ pgTxnId: "query1" }, "Query(begin): BEGIN null"],
          [{ pgTxnId: "query1" }, "Query(fail): failed (42601)"],
          [{ pgTxnId: "query1" }, "Query transaction query1 failed: "],
          [{ pgTxnId: "query1" }, "Query(select 1): failed (25P02)"],
          [{ pgTxnId: "query2" }, "Query(begin): BEGIN null"],
          [{ pgTxnId: "query2" }, "Query(select 1): SELECT 1"],
          [{ pgTxnId: "query2" }, "Query(select 2): SELECT 1"],
          [{ pgTxnId: "query2" }, "Query(commit): COMMIT null"],
          [{ pgTxnId: "query2" }, "Query transaction query2 success"],
        ]
      );
    });
  });

  describe("getPg stats", () => {
    it("return info about Pg", async () => {
      const stats = await getPgStats();
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

  describe("PoolClient", () => {
    const { log, logs } = LogMock();

    const conn = new PoolClient(pool, log);

    describe("run", () => {
      it("returns results and logs query", async () => {
        const result = await conn.run({ text: "select $1 as x", values: [1] });

        expect(result).to.deep.eq([{ x: "1" }]);
        expect(logs).to.deep.eq(["Query(select $1 as x): SELECT 1"]);
      });
    });

    describe("transaction", () => {
      it("returns results and logs query", async () => {
        const result = await conn.transaction("test", async (t) => {
          return await t.run({ text: "select $1 as x", values: [1] });
        });

        expect(result).to.deep.eq([{ x: "1" }]);
      });

      it("nested transaction using save-points", async () => {
        const result = await conn.transaction("test", async (t) => {
          return t.transaction("test2", (tt) => {
            return tt.run({ text: "select $1 as x", values: [1] });
          });
        });

        expect(result).to.deep.eq([{ x: "1" }]);
      });
    });
  });
});
