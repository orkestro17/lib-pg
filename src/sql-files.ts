import * as glob from "glob";
import { readFileSync } from "fs";
import { QueryConfig } from "pg";

interface QueryInFile {
  text: string;
  lineNo: number;
  ignoreErrorCodes: string[];
}

/**
 * Split slq content containing multiple queries.
 * Comment's must be present separating multiple queries.
 */
export function splitSqlText(queryText: string): QueryInFile[] {
  const lines = queryText.split(/\n\r?/gm);

  const queries: QueryInFile[] = [];

  const ignoreErrorCodes: string[] = [];

  let wasInTopLevelComment = true;

  lines.forEach((line, i) => {
    const isEmpty = line.trim() === "";
    const isTopLevelComment = /^--/.test(line);
    const isComment = /^\s*--/.test(line);

    if (line.startsWith("-- ignore-error:")) {
      ignoreErrorCodes.push(
        ...line
          .replace("-- ignore-error:", "")
          .trim()
          .split(",")
          .map((val) => val.trim())
      );
    }

    if (isEmpty) {
      // ignore
    } else if (isTopLevelComment) {
      wasInTopLevelComment = true;
    } else {
      if (!isComment) {
        if (wasInTopLevelComment) {
          queries.push({
            lineNo: i + 1,
            text: line,
            ignoreErrorCodes: ignoreErrorCodes.splice(0),
          });
        } else {
          queries[queries.length - 1].text += "\n" + line;
        }
      }

      wasInTopLevelComment = false;
    }
  });

  return queries.filter((query) => query.text.trim());
}

export function readSqlFileSync(fileName: string): QueryConfig[] {
  const content = readFileSync(fileName).toString();
  return splitSqlText(content);
}

export function readSqlFilesInDirSync(...directories: string[]): QueryConfig[] {
  const queries: QueryConfig[] = [];
  for (const arg of directories) {
    for (const f of glob.sync(arg)) {
      queries.push(...readSqlFileSync(f));
    }
  }
  return queries;
}
