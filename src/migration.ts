import { createHash } from "crypto"
import { readdirSync, readFileSync } from "fs"
import { join as joinPath } from "path"
import { Client, ClientConfig } from "pg"
import { splitSqlText } from "./sql-files"
import { sql } from "./tag"
import { Logger } from "./types"

export interface MigrationsOptions {
  tableName?: string
  folderLocation?: string
}

export async function migrateSchema(
  logger: Logger,
  clientConfig: ClientConfig,
  migrationsOptions: MigrationsOptions = {}
): Promise<void> {
  const { folderLocation = "migrations", tableName = "schema_migrations" } = migrationsOptions

  const client = new Client(clientConfig)

  client.on("error", (e) => logger.error("Error in migrations", e))

  await client.connect()

  try {
    await acquireLock(client)

    const migrationsLog = new MigrationsLog(client, tableName)
    await migrationsLog.initSchema()

    const pastMigrations = await migrationsLog.getPastMigrations()
    const diskMigrations = DiskMigration.readFromFolder(folderLocation)

    validateState(diskMigrations, pastMigrations)

    for (const migration of diskMigrations) {
      const record = pastMigrations.find((row) => row.name === migration.name)

      if (record) {
        logger.info(`Skipping migration ${migration.name} - already migrated`)
      } else {
        await migration.run(client, logger)
        await migrationsLog.insert(migration)
      }
    }
  } finally {
    await client.end()
  }
}

async function acquireLock(client: Client) {
  // random number was chosen in range [1..max int]
  // to ensure it does not conflict with any other pg_advisory_lock
  await client.query(`select pg_advisory_lock(961082034)`)
}

export function validateState(diskMigrations: MigrationRecord[], dbRecords: MigrationRecord[]): void {
  let seqNum = 0

  for (const { name, hash } of diskMigrations) {
    const onDb = dbRecords.find((row) => row.name.slice(0, 3) === name.slice(0, 3))

    // ensure migration name starts with NNN_
    seqNum++
    const expectedPrefix = addPadding(seqNum) + "_"
    if (!name.startsWith(expectedPrefix)) {
      throw new Error(`migration ${name}: prefix should match sequence number of migration (${expectedPrefix})`)
    }
    if (onDb && onDb.name !== name) {
      throw new Error(`migration ${name}: name did not matched previously logged migration (${onDb.name})`)
    }
    if (onDb && onDb.hash !== hash) {
      throw new Error(`migration ${name}: content of migration did not match previously logged migration`)
    }
  }
}

function addPadding(seqNum: number) {
  return (1000 + seqNum).toFixed().slice(1)
}

/**
 * Data access object for migration logs
 */
class MigrationsLog {
  constructor(private client: Client, private tableName: string) {}

  private get tableNameSql() {
    return sql.id(this.tableName)
  }

  async initSchema() {
    await this.client.query(sql`
      create table if not exists ${this.tableNameSql} (
        name text primary key,
        hash text,
        created_at timestamp default current_timestamp
      )
  `)
  }

  async getPastMigrations(): Promise<MigrationRecord[]> {
    const { rows } = await this.client.query(sql`select name, hash from ${this.tableNameSql} order by name`)
    return rows
  }

  async insert(record: MigrationRecord) {
    await this.client.query(sql`insert into ${this.tableNameSql} (name, hash) values (
        ${record.name},
        ${record.hash}
      )`)
  }
}

interface MigrationRecord {
  name: string
  hash: string
}

interface PgError extends Error {
  code: string
}

function isPgError(error: unknown): error is PgError {
  return error instanceof Error && "code" in error
}

class DiskMigration implements MigrationRecord {
  constructor(public location: string, public name: string) {}

  static readFromFolder(location: string): DiskMigration[] {
    const files = readdirSync(location).sort()
    const migrations: DiskMigration[] = []

    for (const fileName of files) {
      if (/\.sql/.test(fileName)) {
        migrations.push(new DiskMigration(location, fileName))
      }
    }

    return migrations
  }

  get hash() {
    const hash = createHash("md5")
    // remove white spaces
    const cleanContent = this.content
      .split("\n")
      .map((val) => val.trim())
      .filter((row) => row)
      .join()
    hash.update(cleanContent)
    return hash.digest().toString("base64")
  }

  get filePath(): string {
    return joinPath(this.location, this.name)
  }

  get content(): string {
    return readFileSync(this.filePath).toString()
  }

  async run(client: Client, logger: Logger): Promise<void> {
    for (const query of splitSqlText(this.content)) {
      logger.info(`Running migration ${this.name}:${query.lineNo}`)
      logger.info(`>>> ${query.text}`)

      try {
        await client.query(query.text)
      } catch (e) {
        if (!isPgError(e)) {
          throw e
        }
        throw new Error(this.formatError(this.filePath, query.lineNo, e))
      }
    }
  }

  private formatError(name: string, lineNo: number, e: PgError) {
    return `Migration ${name}:${lineNo} failed: [code ${e.code}] ${e.message}`
  }
}
