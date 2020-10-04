const { deepStrictEqual: eq } = require("assert")
const { sql } = require("./tag")

describe("db.sql.utils.tag", () => {
  describe("sql tag", () => {
    it("query without arguments", () => {
      const query = sql`simple query`
      eq(query.text, "simple query")
      eq(query.values, [])
    })

    it("simple argument in query", () => {
      const query = sql`start ${1}, ${2} end`
      eq(query.text, "start $1, $2 end")
      eq(query.values, [1, 2])
    })

    it("nested query as argument", () => {
      const query2 = sql`query1 ${sql`query2 ${1}`}`
      eq(query2.text, "query1 query2 $1")
      eq(query2.values, [1])
    })

    it("combined plain arguments and nested query", () => {
      const query2 = sql`start1 ${1}; ${sql`start2 ${2}, ${3} end2`}; ${4} end1`
      eq(query2.text, "start1 $1; start2 $2, $3 end2; $4 end1")
      eq(query2.values, [1, 2, 3, 4])
    })
  })
})
