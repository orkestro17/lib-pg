import { mkdir } from "fs";
import {
  migrateSchema,
  generateSchemaTypeDeclarations,
  getPgConfig,
} from "@orkestro17/lib-pg";

const dbConfig = getPgConfig(process.env, {
  database: "pg_lib_example",
});

mkdir("types", null, () => {
  migrateSchema(console, dbConfig).then(() => {
    generateSchemaTypeDeclarations("types/sql-schema.d.ts", dbConfig);
  });
});
