# @orkestro/lib-pg

Wrapper on package `pg` with helpers

## Connecting

Setup env using `psql` compatible settings:

```
PGSSLROOTCERT
PGSSLKEY
PGSSLCERT
PGHOST
PGPORT
PGUSER
PGDATABASE
PGPASSWORD

// additionally custom settings:
PG_MAX_POOL_SIZE (default 10)
PG_MIN_POOL_SIZE (default 2)
```

```js
import { PoolClient, createPoolFromEnv } from "@orkestro/lib-pg";

// will read config from env and create pg.Pool instance
const pool = createPoolFromEnv();

const client = new PoolClient(pool, console);

client.run('select "connected!"');
```

**_Note:_** it's important to reuse `pg.Pool` instance, because it keeps track of open connections. PoolClient can be created any number of times on same pool.

## Doing transactions

```js
client.transaction('transaction name', async client => {
    await client.run(...)
    await client.run(...)

    // can be nested
    client.transaction('sub transaction', async client => {
        await client.run(...)
        await client.run(...)
    })
})
```

## Writing queries

Sql queries can be written using **sql``** tag literal

Sql tag literal returns [QueryConfig accepted by pg.Client](https://node-postgres.com/api/client)

```js
const { sql, runSql } = require("lib/sql");

const userQuery = "Robert';drop table Students;--";
sql`select ${user}`;
//=> {text: "select $1", values: ["Robert';drop table Students;--"]}

const result = await runSql(userQuery);
```

Statements can be nested

```js
const insertA = sql`insert into A values (...)`;
const insertB = sql`insert into B values (...)`;
const insertAB = sql`
  with 
    a as ${insertA},
    b as ${insertB}
  select * FROM a, b
`;
```

## Writing and running migrations

Write migration in sql files in `migrations/` folder.

File names should follow `NNN_name.sql` format where NNN is sequence number, for example

- migrations/001_company.sql
- migrations/002_person.sql

More than one sql command per file is allowed, by separating multiple queries with a comment statements.

```
-- create table:
create table person (
  id serial primary key,
  name text
);


-- create index:
create index person_name on table person (name);
```

BEGIN, COMMIT statements can be used inside the file to wrap statements into a transaction

```
-- start transaction
BEGIN;

-- add new field
alter table person add column phone text;

-- copy phones from organizations
update person set phone = (select phone from organization where ...)

-- introduce not null constraint
alter table person modify phone not null;

-- commit transaction
commit;
```

It's recommended to run migrations during app boot phase

```
import { Pool } from "pg"
import { migrateSchema, getPgConfig, PoolClient } from "@orkestro/lib-pg"

async function startApp() {
  const config = getPgConfig(process.env)
  const logger = console

  await migrateSchema(logger, config, {
    tableName: 'schema_migrations',
    folderLocation: 'migrations'
  })

  const pool = new Pool(options)
  const client = new PoolClient(pool, logger)

  const expressApp = createExpressApp(client)
  expressApp.listen()
}
```

## Writing tests that use postgresql

Use `TestClient()` helper to unit tests that require database. It will create database if not exists run migratoins and wrap each test case in transaction and rollback after test.

By default TestClient will reuse previously created database. It supports environment parameter `RESET_DB=1` - if set it then will recreate database from scratch.

`TestClient` uses common environment variables for connection with (`PGDATABASE`, etc).

It's recommended in tests to use a different database than in development (npm start),
in order to ensure that database is completely empty. This can be done by adding a config file, for example in `test/env.ts`:

```js
process.env.PGDATABASE = "my_service_test";
```

It's important to note that since TestClient isolates tests in uncommitted transaction, data inserted in tests will not be visible in another parallel connection.

Test example:

```js
const { TestClient, insert } = require("@orkestro/lib-pg");

describe("pg sample", () => {
  // note that TestClient instance must always be instantiated inside describe(),
  // and cannot be instantiated inside it() or before(), after()
  const db = new TestClient();

  const objectRepository = new ObjectRepository(db);

  it("gets from object repository", async () => {
    // cleanup logic is not necessary, because each test is wrapped inside transaction
    // block that is rolled back after each test
    await db.run(insert("object", [{ id: "123" }]));

    const object = await objectRepository.getById("123");

    expect(object).to.exists;
  });
});
```
