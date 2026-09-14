// GET /api/chess/stats — Chess.com public API proxy with 1-hour in-memory cache
const USERNAME = 'gacoka'
const UA = 'personal-dashboard/1.0 (markgacoka@gmail.com)'
const CACHE_TTL = 60 * 60 * 1000

let _cache = null
let _cacheAt = 0

async function chessGet(path) {
  const res = await fetch(`https://api.chess.com/pub${path}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`chess.com ${path} → ${res.status}`)
  return res.json()
}

const LOSS_RESULTS = new Set(['checkmated', 'resigned', 'timeout', 'abandoned', 'lose'])

function summarizeMonth(games) {
  const rapid = (games || []).filter(g => g.time_class === 'rapid').sort((a, b) => a.end_time - b.end_time)
  if (!rapid.length) return { count: 0, win: 0, loss: 0, draw: 0, ratingStart: null, ratingEnd: null }
  let win = 0, loss = 0, draw = 0, ratingStart = null, ratingEnd = null
  for (const g of rapid) {
    const mine = g.white.username.toLowerCase() === USERNAME ? g.white : g.black
    if (ratingStart === null) ratingStart = mine.rating
    ratingEnd = mine.rating
    if (mine.result === 'win') win++
    else if (LOSS_RESULTS.has(mine.result)) loss++
    else draw++
  }
  return { count: rapid.length, win, loss, draw, ratingStart, ratingEnd }
}

export default async function chessRoutes(fastify) {
  fastify.get('/api/chess/stats', async (req, reply) => {
    if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache

    try {
      const [profile, stats] = await Promise.all([
        chessGet(`/player/${USERNAME}`),
        chessGet(`/player/${USERNAME}/stats`),
      ])

      const now = new Date()
      const cy = now.getFullYear()
      const cm = String(now.getMonth() + 1).padStart(2, '0')
      const ly = now.getMonth() === 0 ? cy - 1 : cy
      const lm = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0')

      const [thisData, lastData] = await Promise.all([
        chessGet(`/player/${USERNAME}/games/${cy}/${cm}`).catch(() => ({ games: [] })),
        chessGet(`/player/${USERNAME}/games/${ly}/${lm}`).catch(() => ({ games: [] })),
      ])

      const recentRapid = (thisData.games || [])
        .filter(g => g.time_class === 'rapid')
        .sort((a, b) => a.end_time - b.end_time)
        .slice(-15)
        .map(g => {
          const isW = g.white.username.toLowerCase() === USERNAME
          const mine = isW ? g.white : g.black
          const opp  = isW ? g.black : g.white
          return {
            ts: g.end_time,
            rating: mine.rating,
            result: mine.result === 'win' ? 'W' : LOSS_RESULTS.has(mine.result) ? 'L' : 'D',
            color: isW ? 'w' : 'b',
            opponent: opp.username,
            oppRating: opp.rating,
            url: g.url,
          }
        })

      _cache = {
        username: profile.username,
        league: profile.league,
        lastOnline: profile.last_online,
        rapid: {
          current: stats.chess_rapid?.last?.rating ?? null,
          best:    stats.chess_rapid?.best?.rating ?? null,
          record:  stats.chess_rapid?.record ?? { win: 0, loss: 0, draw: 0 },
        },
        blitz: {
          current: stats.chess_blitz?.last?.rating ?? null,
          best:    stats.chess_blitz?.best?.rating ?? null,
          record:  stats.chess_blitz?.record ?? { win: 0, loss: 0, draw: 0 },
        },
        tactics:    { highest: stats.tactics?.highest?.rating ?? null },
        puzzleRush: { best: stats.puzzle_rush?.best?.score ?? null },
        thisMonth:  summarizeMonth(thisData.games),
        lastMonth:  summarizeMonth(lastData.games),
        recentGames: recentRapid,
        fetchedAt: Date.now(),
      }
      _cacheAt = Date.now()
      return _cache
    } catch (err) {
      fastify.log.warn({ err }, 'chess.com fetch failed')
      return reply.status(502).send({ error: 'chess.com unavailable' })
    }
  })
}
