import * as pg from "pg";

// eslint-disable-next-line @typescript-eslint/ban-types
type AnyObject = object;

export type DeepPartial<T> = T extends Date
  ? T
  : T extends Buffer
  ? T
  : T extends AnyObject
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

export interface QueryConfig extends pg.QueryConfig {
  // instructs driver not to throw error on these error codes
  ignoreErrorCodes?: string[];
}

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
