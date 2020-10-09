import * as pg from "pg";

export interface QueryConfig extends pg.QueryConfig {
  // instructs driver not to throw error on these error codes
  ignoreErrorCodes?: string[];
}

export interface Logger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface DatabaseOptions extends pg.PoolConfig {
  migrations: {
    folderLocation: string;
    tableName: string;
  };
}
