import { writeFileSync } from "fs";
import { groupBy, keys, fromPairs, sortBy } from "lodash";
import * as Pg from "pg";

export async function generateSchemaTypeDeclarations(
  outputFileName: string,
  pgConfig: Pg.ClientConfig
): Promise<void> {
  const db = new Pg.Client(pgConfig);
  await db.connect();
  try {
    const schemaOutput = await getDbSchemaDeclarations(db, "public");
    writeFileSync(
      outputFileName,
      header +
        "\n" +
        "declare " +
        formatNamespace("SqlSchema", schemaOutput) +
        "\n"
    );
  } finally {
    await db.end();
  }
}

const header = `/**
 * Generated by scripts/db-tools/generate-types-from-pg.js
**/`;

function formatNamespace(name: string, content: string) {
  content = content.split("\n").join("\n  ").trim();
  return `namespace ${name} {\n  ${content}\n}`;
}
function formatInterface(name: string, keyValues: Record<string, string>) {
  let output = `export interface ${name} {\n`;
  for (const key of keys(keyValues)) {
    output += `  ${key}: ${keyValues[key]}\n`;
  }
  output += "}\n";
  return output;
}
function formatEnum(name: string, values: string[]) {
  let output = `export type ${name} = \n`;
  for (const value of values.sort()) {
    output += `  | ${JSON.stringify(value)}\n`;
  }
  return output;
}

async function getDbSchemaDeclarations(db: Pg.ClientBase, schema: string) {
  const enums = await getEnums(db, schema);
  const tables = await getTables(db, schema);
  const declaredTypes = enums.map((row) => row.name);

  const output: string[] = [];

  // declare enums
  for (const { name, values } of enums) {
    output.push(formatEnum(name, values));
  }

  // declare tables:
  for (const table of tables) {
    output.push(formatTable(table, declaredTypes));
  }

  output.push(
    formatInterface(
      "Schema",
      fromPairs(
        tables.map((table) => {
          return [table.tableName, table.tableName];
        })
      )
    )
  );

  return output.join("\n");
}

interface Enum {
  name: string;
  values: string[];
}

async function getEnums(
  client: Pg.ClientBase,
  schema: string
): Promise<Enum[]> {
  type Row = { typname: string; enumlabel: string };

  const result = await client.query<Row>(
    `
    select 
      pg_type.typname, 
      pg_enum.enumlabel
    from pg_type
      join pg_enum on 
        pg_type.oid = pg_enum.enumtypid
      join pg_catalog.pg_namespace ON 
      pg_namespace.oid = pg_type.typnamespace
    where
      pg_namespace.nspname = $1
    order by 
      pg_type.typname asc
  `,
    [schema]
  );

  const grouped = groupBy(result.rows, (row: Row) => row.typname);

  return keys(grouped).map((key: string) => ({
    name: key,
    values: grouped[key].map((row: Row) => row.enumlabel),
  }));
}

function formatTable(
  { tableName, columns }: TableInfo,
  declaredTypes: string[]
) {
  const output = [];

  for (const col of columns) {
    if (col.typeName === "json" || col.typeName === "jsonb") {
      output.push("// to be extended in application:");
      output.push(formatInterface(`${tableName}__${col.columnName}`, {}));
    }
  }

  // declare table interface:
  output.push(
    formatInterface(
      tableName,
      fromPairs(
        columns.map((col) => {
          const isEnum = declaredTypes.includes(col.typeName);
          return [col.columnName, formatJsType(tableName, col, isEnum)];
        })
      )
    )
  );

  return output.join("\n");
}

interface TableInfo {
  tableName: string;
  columns: ColumnInfo[];
}

interface ColumnInfo {
  columnName: string;
  typeName: string;
  isArray: boolean;
  isNullable: boolean;
}

async function getTables(
  db: Pg.ClientBase,
  schema: string
): Promise<TableInfo[]> {
  type Row = {
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
  };

  const result = await db.query<Row>(
    `select
      table_name,
      column_name,
      data_type,
      udt_name,
      is_nullable
    from information_schema.columns 
    where
      table_schema = $1
  `,
    [schema]
  );

  const groupedByTable = groupBy(result.rows, (row: Row) => row.table_name);

  return keys(groupedByTable)
    .sort()
    .map((key) => ({
      tableName: key,
      columns: sortBy(groupedByTable[key], (row) => row.column_name).map(
        (row) => ({
          tableName: row.table_name,
          columnName: row.column_name,
          typeName:
            // remove '_' prefix added to arrays:
            row.data_type === "ARRAY"
              ? row.udt_name.replace(/^_/, "")
              : row.udt_name,
          isArray: row.data_type === "ARRAY",
          isNullable: row.is_nullable === "YES",
        })
      ),
    }));
}

function formatJsType(tableName: string, col: ColumnInfo, isEnum: boolean) {
  let name = isEnum ? col.typeName : jsTypes[col.typeName] || "string";
  if (name === "any") {
    name = `${tableName}__${col.columnName}`;
  }
  return `${name}${col.isArray ? "[]" : ""}${col.isNullable ? " | null" : ""}`;
}

const jsTypes: Record<string, string> = {
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "string",
  money: "string",
  oid: "number",
  bool: "boolean",
  json: "any",
  jsonb: "any",
  date: "Date",
  timestamp: "Date",
  timestamptz: "Date",
};

export class X {
  private _events: string[] = [];

  static create(): X {
    const x = new X();
    x.addEvent();

    return x;
  }

  private addEvent(): void {
    this._events.push();
  }
}