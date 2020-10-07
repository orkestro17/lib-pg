import { PoolClient, createPoolFromEnv, sql } from "@orkestro/lib-pg";
import { runMigrations } from "@orkestro/lib-pg/src/migration";

async function main() {
  const pool = createPoolFromEnv();
  try {
    const client = new PoolClient(pool, console);

    // run migrations
    await runMigrations(client, "migrations", console);

    // regular query
    const results = await client.run(sql`select ${"Sample query"}`);
    console.log("Query results: ", results);

    // transaction
    await client.transaction("example", async (client) => {
      await client.run(sql`select ${"Sample query in transaction"}`);
      await client.transaction("nestedExample", async (client) => {
        await client.run(sql`select ${"Sample query in nested transaction"}`);
      });
    });
  } finally {
    pool.end();
  }
}

if (require.main === module) {
  main();
}
