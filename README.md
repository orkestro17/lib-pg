# @orkestro/lib-pg

Wrapper on package `pg` with helpers

## TODO

- fix tests
- migrations script

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
PG_MAX_POOL_SIZE
PG_MIN_POOL_SIZE
```

```js
import { PoolClient } from "@orkestro/lib-pg";

// will read config from env:
const pool = PoolClient.default();

pool.run('select "connected!"');
```

## Executing queries

```
import {sql} from "@orkestro/lib-pg"

pool.run(sql`select * from x`)
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

## Doing transactions

```js
pool.transaction('transaction name', async client => {
    await client.run(...)
    await client.run(...)

    // can be nested
    client.transaction('sub transaction', async client => {
        await client.run(...)
        await client.run(...)
    })
})
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
