const fs = require("fs")
const { runSqlFile } = require("lib/sql")

module.exports = {
  async main() {
    for (const f of fs.readdirSync("schema")) {
      if (f.endsWith(".sql")) {
        await runSqlFile("schema/" + f)
      }
    }
  }
}

require("lib/run-main")(module)
