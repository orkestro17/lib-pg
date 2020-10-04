/**
 * Split slq content containing multiple queries.
 * Comment's must be present separating multiple queries.
 *
 * @param {string} queryText
 */
function splitSqlText(queryText) {
  const lines = queryText.split(/\n\r?/gm)

  /** @type {{queryText: string, lineNo: number, ignoreErrorCodes: string[]}[]} */
  const queries = []

  /** @type {string[]} */
  let ignoreErrorCodes = []

  let wasInTopLevelComment = true

  lines.forEach((line, i) => {
    const isEmpty = line.trim() === ""
    const isTopLevelComment = /^--/.test(line)
    const isComment = /^\s*--/.test(line)

    if (line.startsWith("-- ignore-error:")) {
      ignoreErrorCodes.push(
        ...line
          .replace("-- ignore-error:", "")
          .trim()
          .split(",")
          .map((val) => val.trim())
      )
    }

    if (isEmpty) {
      // ignore
    } else if (isTopLevelComment) {
      wasInTopLevelComment = true
    } else {
      if (!isComment) {
        if (wasInTopLevelComment) {
          queries.push({
            lineNo: i + 1,
            queryText: line,
            ignoreErrorCodes: ignoreErrorCodes.splice(0)
          })
        } else {
          queries[queries.length - 1].queryText += "\n" + line
        }
      }

      wasInTopLevelComment = false
    }
  })

  return queries.filter((query) => query.queryText.trim())
}

module.exports = { splitSqlText }
