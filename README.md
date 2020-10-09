# @orkestro/lib-pg

Wrapper on package `pg` with helpers

## TODO

- fix tests

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

Use `usingPg()` helper. It will wrap each test case in transaction and rollback after test.

```js
const { deepStrictEqual: eq } = require("assert")
const { usingPg } = require("@orkestro/lib-pg/tests/utils")

describe("pg sample", () => {
  const ctx = usingPg()
  const testFixtures = usingFixtures({
    quotes: 5
  })

  it('quotes are in database', () => {
    const result = await ctx.db.run("select 'test'")
  })
})
```
