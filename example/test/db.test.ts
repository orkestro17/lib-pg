import { sql } from "@orkestro/lib-pg";
import { TestClient } from "@orkestro/lib-pg/test";
import { expect } from "chai";

describe("test example", () => {
  const db = new TestClient();

  beforeEach(async () => {
    await db.run(sql`insert into test_record (name) values (${"beforeEach"})`);
  });

  it("Test 1", async () => {
    await db.run(sql`insert into test_record (name) values (${"Test 1"})`);

    const result = await db.run<{ name: string }>(
      sql`select name from test_record order by name`
    );

    expect(result).to.eql([{ name: "beforeEach" }, { name: "Test 1" }]);
  });

  it("Test 2", async () => {
    await db.run(sql`insert into test_record (name) values (${"Test 2"})`);

    const result = await db.run<{ name: string }>(
      sql`select name from test_record`
    );

    expect(result).to.eql([{ name: "beforeEach" }, { name: "Test 2" }]);
  });
});
