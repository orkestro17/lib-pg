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
  const diskMigrations = DiskMigration.readFromFolder(folderLocation);
  const client = new Client(options);
  const repository = new MigrationsDb(client, tableName);

  client.on("error", (e) => logger.error(e));

  await client.connect();

  try {
    await repository.acquireLock();
    await repository.init();

    const records = await repository.all();

    for (const migration of diskMigrations) {
      const record = records.find((row) => row.name === migration.name);

      if (record) {
        if (record.hash !== migration.hash) {
          throw new Error(
            `Migration ${record.name} hash does not match, was migration file modified?`
          );
        } else {
          logger.info(
            `Skipping migration ${migration.name} - already migrated`
          );
        }
      } else {
        await migration.run(client, logger);
        await repository.insert({ name: migration.name, hash: migration.hash });
      }
    }
  } finally {
    client.end();
  }
}

class MigrationsDb {
  constructor(private client: Client, private tableName: string) {}

  async acquireLock() {
    // random number was chosen in range [1..max int]
    // to ensure it does not conflict with any other pg_advisory_lock
    await this.client.query(`select pg_advisory_lock(961082034)`);
  }

  private get tableIdentifier() {
    return sql.id(this.tableName);
  }

  async init() {
    await this.client.query(sql`
      create table if not exists ${this.tableIdentifier} (
        name text primary key,
        hash text,
        created_at timestamp default current_timestamp
      )
  `);
  }

  async all(): Promise<MigrationRecord[]> {
    const { rows } = await this.client.query(
      sql`select * from ${this.tableIdentifier}`
    );
    return rows;
  }

  async insert(record: Omit<MigrationRecord, "created_at">) {
    await this.client
      .query(sql`insert into ${this.tableIdentifier} (name, hash) values (
        ${record.name},
        ${record.hash}
      )`);
  }
}

interface MigrationRecord {
  name: string;
  hash: string;
  created_at: Date;
}

class DiskMigration {
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
        logger.error(
          `Migration ${this.name}:${query.lineNo} failed: ${e.message}`
        );
      }
    }
  }
}
