import pg from 'pg'
const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// Rows for a best-effort query (caches), or null if the query fails.
export async function queryRowsOrNull(sql, params) {
  try { return (await pool.query(sql, params)).rows } catch { return null }
}
