import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join as joinPath } from "path";
import { Client } from "pg";
import { splitSqlText } from "./sql-files";
import { sql } from "./tag";
import { DatabaseOptions, Logger } from "./types";

export async function migrateSchema(
  logger: Logger,
  options: DatabaseOptions
): Promise<void> {
  const { folderLocation, tableName } = options.migrations;

  const client = new Client(options);

  client.on("error", (e) => logger.error(e));

  await client.connect();

  try {
    await acquireLock(client);

    const migrationsLog = new MigrationsLog(client, tableName);
    const pastMigrations = await migrationsLog.getPastMigrations();
    const diskMigrations = DiskMigration.readFromFolder(folderLocation);

    validateState(diskMigrations, pastMigrations);

    for (const migration of diskMigrations) {
      const record = pastMigrations.find((row) => row.name === migration.name);

      if (record) {
        logger.info(`Skipping migration ${migration.name} - already migrated`);
      } else {
        await migration.run(client, logger);
        await migrationsLog.insert(migration);
      }
    }
  } finally {
    client.end();
  }
}

async function acquireLock(client: Client) {
  // random number was chosen in range [1..max int]
  // to ensure it does not conflict with any other pg_advisory_lock
  await client.query(`select pg_advisory_lock(961082034)`);
}

export function validateState(
  diskMigrations: MigrationRecord[],
  dbRecords: MigrationRecord[]
): void {
  for (let i = 0; i < Math.max(diskMigrations.length, dbRecords.length); i++) {
    const onDisk = diskMigrations[i];
    const onDb = dbRecords[i];

    if (!onDisk) {
      throw new Error(`Database migration ${onDb.name} is not on disk`);
    }
    if (onDb && onDb.name !== onDisk.name) {
      throw new Error(
        `Found migration ${onDisk.name} on disk, but a different migration ${onDb.name} was found on database`
      );
    }
    if (onDb && onDb.hash !== onDisk.hash) {
      throw new Error(
        `Migration hash don't match (${onDisk.name}) - was file modified?`
      );
    }
    // ensure migration name starts with NNN_
    const expectStartWith = (1000 + i + 1).toFixed().slice(1) + "_";
    if (!onDisk.name.startsWith(expectStartWith)) {
      throw new Error(
        `Found #${i + 1} migration named ${
          onDisk.name
        }, but name should start with ${expectStartWith}`
      );
    }
  }
}

/**
 * Data access object for migration logs
 */
class MigrationsLog {
  constructor(private client: Client, private tableName: string) {}

  private get tableNameSql() {
    return sql.id(this.tableName);
  }

  async initSchema() {
    await this.client.query(sql`
      create table if not exists ${this.tableNameSql} (
        name text primary key,
        hash text,
        created_at timestamp default current_timestamp
      )
  `);
  }

  async getPastMigrations(): Promise<MigrationRecord[]> {
    const { rows } = await this.client.query(
      sql`select name, hash from ${this.tableNameSql} order by name`
    );
    return rows;
  }

  async insert(record: MigrationRecord) {
    await this.client
      .query(sql`insert into ${this.tableNameSql} (name, hash) values (
        ${record.name},
        ${record.hash}
      )`);
  }
}

interface MigrationRecord {
  name: string;
  hash: string;
}

interface PgError extends Error {
  code: string;
}

class DiskMigration implements MigrationRecord {
  constructor(public location: string, public name: string) {}

  static readFromFolder(location: string): DiskMigration[] {
    const files = readdirSync(location).sort();
    const migrations: DiskMigration[] = [];

    for (const fileName of files) {
      if (/\.sql/.test(fileName)) {
        migrations.push(new DiskMigration(location, fileName));
      }
    }

    return migrations;
  }

  get hash() {
    const hash = createHash("md5");
    // remove white spaces
    const cleanContent = this.content
      .split("\n")
      .map((val) => val.trim())
      .filter((row) => row)
      .join();
    hash.update(cleanContent);
    return hash.digest().toString("base64");
  }

  get filePath(): string {
    return joinPath(this.location, this.name);
  }

  get content(): string {
    return readFileSync(this.filePath).toString();
  }

  async run(client: Client, logger: Logger): Promise<void> {
    for (const query of splitSqlText(this.content)) {
      logger.info(`Running migration ${this.name}:${query.lineNo}`);
      logger.info(`>>> ${query.text}`);

      try {
        await client.query(query.text);
      } catch (e) {
        throw new Error(this.formatError(this.filePath, query.lineNo, e));
      }
    }
  }

  private formatError(name: string, lineNo: number, e: PgError) {
    return `Migration ${name}:${lineNo} failed: [code ${e.code}] ${e.message}`;
  }
}
