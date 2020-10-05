import * as pg from "pg";

export interface QueryConfig extends pg.QueryConfig {
  // instructs driver not to throw error on these error codes
  ignoreErrorCodes?: string[];
}
