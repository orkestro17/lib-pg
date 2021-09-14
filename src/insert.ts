/// <reference path="../globals.d.ts" />
import { sql } from "./tag"
import { QueryConfig } from "./types"

/** @type {(
 *    table: T,
 *    data: Partial<SqlSchema.Schema[T]>[]
 *  ) => any} */
export function insert<T extends keyof SqlSchema.Schema>(table: T, data: Partial<SqlSchema.Schema[T]>[]): QueryConfig {
  if (data.length === 0) {
    return sql`select null`
  }

  const keys = Object.keys(data[0])

  const sqlTable = sql.id(table)
  const sqlCols = sql.comma(keys.map(sql.id))

  const jsonData = JSON.stringify(data)

  return sql`insert into 
        ${sql.id(table)} (
          ${sqlCols}
        )
        select 
          ${sqlCols}
        from json_populate_recordset(null::${sqlTable}, ${jsonData}::json)
        returning *`
}
