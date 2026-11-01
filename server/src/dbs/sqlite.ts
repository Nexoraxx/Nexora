import { Database } from 'bun:sqlite'
import schema from './schema.sql' with { type: 'text' }

export { Database }

export const openDatabase = (path: string) => {
  const db = new Database(path, { create: true, strict: true })
  db.run(schema)
  return db
}

const tables = new WeakMap<Database, Map<string, { columns: Set<string>; pk: string[] }>>()

const tableInfo = (db: Database, table: string) => {
  let cache = tables.get(db)
  if (!cache) tables.set(db, (cache = new Map()))
  let info = cache.get(table)
  if (!info) {
    const rows = db.query<{ name: string; pk: number }, []>(`SELECT name, pk FROM pragma_table_info('${table}')`).all()
    info = { columns: new Set(rows.map((r) => r.name)), pk: rows.filter((r) => r.pk).sort((a, b) => a.pk - b.pk).map((r) => r.name) }
    cache.set(table, info)
  }
  return info
}

const toSql = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? Number(v) : v)

// Upsert rows keyed by the table's PK. Only columns present on the row are written, so partial rows
// (an alias, a request flag) never wipe other fields; keys that aren't columns (extra API fields) are dropped.
export const upsert = (db: Database, table: string, rows: Record<string, unknown>[]): void => {
  if (rows.length > 1 && !db.inTransaction) return db.transaction(() => upsert(db, table, rows))()
  const { columns, pk } = tableInfo(db, table)
  for (const row of rows) {
    const keys = Object.keys(row).filter((k) => columns.has(k) && row[k] !== undefined)
    const set = keys.filter((k) => !pk.includes(k)).map((k) => `"${k}" = excluded."${k}"`)
    db.query(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((k) => `$${k}`).join(', ')})
       ON CONFLICT (${pk.join(', ')}) DO ${set.length ? `UPDATE SET ${set.join(', ')}` : 'NOTHING'}`,
    ).run(Object.fromEntries(keys.map((k) => [k, toSql(row[k])])) as Record<string, string>)
  }
}
