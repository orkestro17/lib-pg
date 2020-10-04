const safeMarker = Symbol("Safe sql marker");

export function sql(strings: TemplateStringsArray, ...args: any[]) {
  let text = strings[0];
  const values = [];

  args.forEach((val, i) => {
    if (val && val[safeMarker]) {
      const offset = values.length;
      text += val.text.replace(/\$\d+/g, (match) => {
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

/**
 * @template T
 * @param {T} val
 * @returns T
 */
function safe(val) {
  val[safeMarker] = true;
  return val;
}
