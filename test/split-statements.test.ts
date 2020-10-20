import { deepStrictEqual as eq } from "assert";
import { splitSqlText } from "../src/sql-files";

const multiQuerySample = `
-- Query 1:
create table one (id int);

--
-- Query 2, multi line:
--

create table two (
  id int
);

-- Ignore error codes:
-- ignore-error: 1, 2, 3

select 'ok'

-- Comment inside query:

create table three (
  -- this is id:
  int id
)

`;

describe("lib/sql/split-statements", () => {
  describe("splitSqlText", () => {
    it("splits and removes comments", () => {
      const result = splitSqlText(multiQuerySample);

      eq(result.length, 4);

      eq(result[0], {
        lineNo: 3,
        text: "create table one (id int);",
        ignoreErrorCodes: [],
      });

      eq(result[1], {
        lineNo: 9,
        text: "create table two (\n  id int\n);",
        ignoreErrorCodes: [],
      });

      eq(result[2], {
        lineNo: 16,
        text: "select 'ok'",
        ignoreErrorCodes: ["1", "2", "3"],
      });

      eq(result[3], {
        lineNo: 20,
        text: "create table three (\n  int id\n)",
        ignoreErrorCodes: [],
      });
    });
  });
});
