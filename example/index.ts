import { getPgConfig, migrateSchema, PoolClient, sql } from "@orkestro/lib-pg";
import { Pool } from "pg";

async function main() {
  const clientConfig = getPgConfig(process.env, {
    database: "pg_lib_example",
  });
  const logger = console;

  // run migrations
  await migrateSchema(logger, clientConfig, {
    folderLocation: "migrations",
    tableName: "schema_migrations",
  });

  const pool = new Pool(clientConfig);
  try {
    const client = new PoolClient(pool, logger);

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
