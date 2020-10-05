declare namespace Pg {
  export type QueryConfig = import("pg").QueryConfig & {
    ignoreErrorCodes?: string[];
  };
  export type QueryResult = import("pg").QueryResult;
  export type Pool = import("pg").Pool;
  export type Client = import("pg").ClientBase;
}

declare namespace SqlSchema {
  // placeholder for schema interfaces

  // placeholder for all tables
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface Schema {}
}
