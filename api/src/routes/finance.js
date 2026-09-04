import { pool } from '../db/client.js'
import { plaidClient } from '../services/plaid.js'

// ─── sync helpers ──────────────────────────────────────────────────────────────

async function getInstitutionName(accessToken) {
  try {
    const r = await plaidClient.itemGet({ access_token: accessToken })
    const instId = r.data.item.institution_id
    if (!instId) return null
    const ir = await plaidClient.institutionsGetById({ institution_id: instId, country_codes: ['US'] })
    return ir.data.institution.name
  } catch { return null }
}

async function syncItem(accessToken, itemId) {
  const institution = await getInstitutionName(accessToken)
  if (institution) {
    await pool.query('UPDATE plaid_items SET institution=$1 WHERE item_id=$2', [institution, itemId])
  }

  // Balances
  const balRes = await plaidClient.accountsBalanceGet({ access_token: accessToken })
  for (const a of balRes.data.accounts) {
    await pool.query(`
      INSERT INTO fin_accounts (account_id, item_id, name, official_name, type, subtype, mask, institution, balance, available, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (account_id) DO UPDATE SET
        name=$3, balance=$9, available=$10, synced_at=NOW()
    `, [a.account_id, itemId, a.name, a.official_name, a.type, a.subtype, a.mask,
        institution, a.balances.current ?? 0, a.balances.available])

    // Daily snapshot — upsert so only one row per account per day
    if (a.balances.current != null) {
      await pool.query(`
        INSERT INTO fin_snapshots (account_id, date, balance)
        VALUES ($1, CURRENT_DATE, $2)
        ON CONFLICT (account_id, date) DO UPDATE SET balance=$2
      `, [a.account_id, a.balances.current])
    }
  }

  // Investment holdings (not all institutions/products support this)
  try {
    const hRes = await plaidClient.investmentsHoldingsGet({ access_token: accessToken })
    const secMap = Object.fromEntries(hRes.data.securities.map(s => [s.security_id, s]))
    for (const h of hRes.data.holdings) {
      const sec = secMap[h.security_id] || {}
      await pool.query(`
        INSERT INTO fin_holdings (account_id, security_id, name, ticker, type, quantity, price, value, cost_basis, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT (account_id, security_id) DO UPDATE SET
          name=$3, ticker=$4, quantity=$6, price=$7, value=$8, cost_basis=$9, synced_at=NOW()
      `, [h.account_id, h.security_id, sec.name, sec.ticker_symbol, sec.type,
          h.quantity, h.institution_price, h.institution_value, h.cost_basis])
    }
  } catch (err) {
    // Institution may not have investments product enabled — not an error
  }
}

// ─── routes ───────────────────────────────────────────────────────────────────

export default async function financeRoutes(fastify) {
  // Create Plaid Link token — frontend calls this to open the Link modal
  fastify.post('/api/finance/link/token', async () => {
    const r = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'gacoka' },
      client_name: 'Personal Dashboard',
      products: ['transactions', 'investments'],
      country_codes: ['US'],
      language: 'en',
    })
    return { link_token: r.data.link_token }
  })

  // Exchange public_token for access_token, store item, sync immediately
  fastify.post('/api/finance/link/exchange', async (req, reply) => {
    const { public_token } = req.body
    if (!public_token) return reply.status(400).send({ error: 'public_token required' })
    const ex = await plaidClient.itemPublicTokenExchange({ public_token })
    const { access_token, item_id } = ex.data
    await pool.query(
      `INSERT INTO plaid_items (item_id, access_token) VALUES ($1,$2)
       ON CONFLICT (item_id) DO UPDATE SET access_token=$2`,
      [item_id, access_token]
    )
    await syncItem(access_token, item_id)
    return { ok: true, item_id }
  })

  // List linked institutions
  fastify.get('/api/finance/items', async () => {
    const { rows } = await pool.query(
      'SELECT id, item_id, institution, created_at FROM plaid_items ORDER BY created_at'
    )
    return rows
  })

  // Unlink an institution
  fastify.delete('/api/finance/items/:itemId', async (req, reply) => {
    const { itemId } = req.params
    const { rows } = await pool.query('SELECT access_token FROM plaid_items WHERE item_id=$1', [itemId])
    if (!rows.length) return reply.status(404).send({ error: 'Not found' })
    try { await plaidClient.itemRemove({ access_token: rows[0].access_token }) } catch {}
    await pool.query('DELETE FROM plaid_items WHERE item_id=$1', [itemId])
    return reply.status(204).send()
  })

  // All accounts with current balances
  fastify.get('/api/finance/accounts', async () => {
    const { rows } = await pool.query(`
      SELECT a.*, p.institution AS linked_institution
      FROM fin_accounts a
      LEFT JOIN plaid_items p ON p.item_id = a.item_id
      ORDER BY a.institution, a.type, a.name
    `)
    return rows
  })

  // Net worth total + 30-day history + per-category breakdown
  fastify.get('/api/finance/net-worth', async (req) => {
    const days = parseInt(req.query.days || '30')

    const { rows: accounts } = await pool.query(`
      SELECT account_id, name, type, subtype, institution, balance
      FROM fin_accounts ORDER BY institution, type
    `)

    // Categorize accounts
    const liquid   = accounts.filter(a => a.type === 'depository')
    const invested = accounts.filter(a => a.type === 'investment' && !['401k','ira','roth','403b','pension','457b'].includes(a.subtype))
    const retire   = accounts.filter(a => ['401k','ira','roth','403b','pension','457b'].includes(a.subtype))
    const sum      = arr => arr.reduce((s,a) => s + parseFloat(a.balance||0), 0)

    const total      = sum(accounts)
    const byType = { liquid: sum(liquid), invested: sum(invested), retirement: sum(retire) }

    // 30-day daily snapshot totals
    const { rows: history } = await pool.query(`
      SELECT date::text, SUM(balance)::numeric AS total
      FROM fin_snapshots
      WHERE date >= CURRENT_DATE - $1::int
      GROUP BY date ORDER BY date
    `, [days])

    // Prior total for delta calculation
    const prev = history.length > 1 ? parseFloat(history[0].total) : total

    return { total, prev, delta: total - prev, byType, accounts, history }
  })

  // All investment holdings consolidated
  fastify.get('/api/finance/holdings', async () => {
    const { rows } = await pool.query(`
      SELECT h.*, a.institution, a.name AS account_name
      FROM fin_holdings h
      JOIN fin_accounts a ON a.account_id = h.account_id
      ORDER BY h.value DESC NULLS LAST
    `)
    return rows
  })

  // Force re-sync all linked items
  fastify.post('/api/finance/sync', async () => {
    const { rows } = await pool.query('SELECT item_id, access_token FROM plaid_items')
    await Promise.allSettled(rows.map(r => syncItem(r.access_token, r.item_id)))
    return { ok: true, synced: rows.length }
  })
}
