import { QueryConfig } from "./types";

const safeMarker = Symbol("Safe sql marker");

export function sql(
  strings: TemplateStringsArray,
  ...args: unknown[]
): QueryConfig {
  let text = strings[0];
  const values: unknown[] = [];

  args.forEach((val, i) => {
    if (val && isSafe(val)) {
      const offset = values.length;
      text += val.text.replace(/\$\d+/g, (match: string) => {
        const j = parseInt(match.slice(1), 10);
        return "$" + (offset + j);
      });
      values.push(...(val.values || []));
      text += strings[i + 1];
    } else {
      values.push(val);
      text += "$" + values.length + strings[i + 1];
    }
  });
  return safe({ text, values });
}

sql.id = function (value: string) {
  if (!value.match(/[a-z_-]/)) {
    throw new Error(`Invalid identifier: ${value} (only A-Z and _ allowed)`);
  }
  return safe({ text: `"${value}"`, values: [] });
};

sql.comma = function (values: unknown[]) {
  return values.reduce((a, b) => sql`${a}, ${b}`);
};

function isSafe(val: unknown): val is QueryConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (val as any)[safeMarker] ? true : false;
}

function safe<T>(val: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (val as any)[safeMarker] = true;
  return val;
}
