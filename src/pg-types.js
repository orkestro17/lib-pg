const pg = require("pg")

let initializePromise

/**
 *
 * @param {Pg.Client | Pg.Pool} client
 */
async function initPgTypes(client) {
  // Register enum arrays to be parsed as string arrays:
  // https://github.com/brianc/node-pg-types/issues/56
  const { rows } = await client.query("select * from pg_type where typoutput = 'enum_out'::regproc")
  for (const row of rows) {
    pg.types.setTypeParser(row.typarray, pg.types.getTypeParser(1015))
  }
}

/**
 *
 * @param {Pg.Client | Pg.Pool} client
 */
async function initPgTypesOnce(client) {
  if (!initializePromise) {
    initializePromise = initPgTypes(client)
  }
  await initializePromise
}

module.exports = {
  initPgTypesOnce,
  initPgTypes
}
