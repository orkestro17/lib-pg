const safeMarker = Symbol("Safe sql marker")

/**
 * @param {TemplateStringsArray} strings
 * @args {any[]} args
 * @returns {Pg.QueryConfig}
 */
function sql(strings, ...args) {
  let text = strings[0]
  let values = []

  args.forEach((val, i) => {
    if (val && val[safeMarker]) {
      const offset = values.length
      text += val.text.replace(/\$\d+/g, (match) => {
        const j = parseInt(match.slice(1), 10)
        return "$" + (offset + j)
      })
      values.push(...(val.values || []))
      text += strings[i + 1]
    } else {
      values.push(val)
      text += "$" + values.length + strings[i + 1]
    }
  })
  return safe({ text, values })
}

sql.id =
  /**
   *
   * @param {string} value
   */
  function(value) {
    if (!value.match(/[a-z_-]/)) {
      throw new Error(`Invalid identifier: ${value} (only A-Z and _ allowed)`)
    }
    return safe({ text: `"${value}"`, values: [] })
  }

sql.comma =
  /** @param {any[]} values */
  function(values) {
    return values.reduce((a, b) => sql`${a}, ${b}`)
  }

/**
 * @template T
 * @param {T} val
 * @returns T
 */
function safe(val) {
  val[safeMarker] = true
  return val
}

module.exports = { sql }
