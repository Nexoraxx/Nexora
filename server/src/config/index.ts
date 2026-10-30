import { mkdirSync } from 'node:fs'
import { join } from 'node:path'


process.umask(0o077)

const dataDir = process.env.DATA_DIR ?? './data'

mkdirSync(dataDir, {recursive: true})

export const config = {
    port: Number(process.env.PORT ?? 0),
    token: process.env.APP_TOKEN ?? crypto.randomUUID(),
    dataDir,
  dbPath: process.env.DB_PATH ?? join(dataDir, 'nexora.db'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
}