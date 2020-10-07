import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join as joinPath } from "path";
import { Client } from "./client";
import { splitSqlText } from "./sql-files";
import { sql } from "./tag";

export async function runMigrations(
  client: Client,
  location: string,
  logger: Logger
): Promise<void> {
  await createMigrationTable(client);
  const diskMigrations = readMigrationsSync(location);

  await client.transaction("schema_migrations", async (lockClient) => {
    // We use different client/transaction to lock than the one that
    // actually run migrations. This is because migration might
    // include queries that can't run inside a transaction
    await lockClient.run(sql`select pg_advisory_lock(0) from migrations`);

    const records = await lockClient.run<MigrationRecord>(
      "select * from migrations"
    );

    for (const diskMigration of diskMigrations) {
      const record = records.find((row) => row.name === diskMigration.name);

      if (record) {
        if (record.hash !== diskMigration.hash) {
          throw new Error(
            `Migration ${diskMigration.name} hash does not much. Was migration modified?`
          );
        } else {
          logger.info(`Skipping migration ${record.name} - already migrated`);
        }
      } else {
        await diskMigration.run(client, logger);
        await client.run(
          sql`insert into migrations (name, hash) values (${diskMigration.name}, ${diskMigration.hash})`
        );
      }
    }
  });
}

interface Logger {
  info(...args: unknown[]): void;
}

interface MigrationRecord {
  name: string;
  hash: string;
  created_at: Date;
}

async function createMigrationTable(client: Client) {
  await client.run(sql`
    create table if not exists migrations (
      name text,
      hash text,
      created_at timestamp default current_timestamp
    )
  `);
}

function readMigrationsSync(location: string) {
  const files = readdirSync(location).sort();
  const migrations: DiskMigration[] = [];

  for (const fileName of files) {
    if (/\.sql/.test(fileName)) {
      migrations.push(new DiskMigration(location, fileName));
    }
  }

  return migrations;
}

class DiskMigration {
  constructor(public location: string, public name: string) {}

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

      await client.run(query.text);
    }
  }
}
