import { Pool } from "pg"
import { getPgConfig } from "../src/config"

export const testConfig = getPgConfig(process.env)
export const testPool = new Pool({ ...testConfig, min: 0, max: 1 })

console.log(">>> ENV ", process.env)
console.log(">>> TestConfig ", testConfig)

testPool.on("error", (e) => {
  console.error("Error happened in test db pool")
  console.error(e)
})

after(() => testPool.end())
