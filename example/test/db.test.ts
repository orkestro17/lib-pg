import { sql } from "@orkestro/lib-pg";
import { TestClient, insert } from "@orkestro/lib-pg";
import { expect } from "chai";

describe("test example", () => {
  const db = new TestClient();

  beforeEach(async () => {
    await db.run(insert("test_record", [{ name: "Before Each" }]));
  });

  it("Test 1", async () => {
    await db.run(insert("test_record", [{ name: "Test 1" }]));

    const result = await db.run<{ name: string }>(
      sql`select name from test_record order by name`
    );

    expect(result).to.eql([{ name: "Before Each" }, { name: "Test 1" }]);
  });

  it("Test 2", async () => {
    await db.run(insert("test_record", [{ name: "Test 2" }]));

    const result = await db.run<{ name: string }>(
      sql`select name from test_record`
    );

    expect(result).to.eql([{ name: "Before Each" }, { name: "Test 2" }]);
  });
});
