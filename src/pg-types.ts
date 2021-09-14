import pg from "pg"

let initializePromise: Promise<void>

export async function initPgTypes(client: pg.ClientBase): Promise<void> {
  // Register enum arrays to be parsed as string arrays:
  // https://github.com/brianc/node-pg-types/issues/56
  const { rows } = await client.query("select * from pg_type where typoutput = 'enum_out'::regproc")
  for (const row of rows) {
    pg.types.setTypeParser(row.typarray, pg.types.getTypeParser(1015))
  }
}

export async function initPgTypesOnce(client: pg.ClientBase): Promise<void> {
  if (!initializePromise) {
    initializePromise = initPgTypes(client)
  }
  await initializePromise
}
