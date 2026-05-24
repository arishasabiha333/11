// Vercel Serverless Function — Football API Proxy
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY; 
const BASE = 'https://api.football-data.org/v4';

// Basic in-memory cache (Vercel Serverless e protibar kaj na-o korte pare, but free tier er jonno fine)
const cache = new Map();
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > 5 * 60 * 1000) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) { cache.set(key, { data, time: Date.now() }); }

async function fetchFootball(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'X-Auth-Token': FOOTBALL_API_KEY }
  });
  return res.json();
}

function mapStatus(s) {
  return { SCHEDULED:'upcoming', TIMED:'upcoming', IN_PLAY:'live',
           PAUSED:'live', FINISHED:'past', SUSPENDED:'past' }[s] || 'upcoming';
}

export default async function handler(req, res) {
  // CORS 
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type } = req.query;

  try {
    if (type === 'matches') {
      const cached = getCache('matches');
      if (cached) return res.json(cached);

      const data = await fetchFootball('/competitions/WC/matches', {
        status: 'SCHEDULED,LIVE,FINISHED', limit: '64'
      });

      const matches = (data.matches || []).map(m => ({
        id:         String(m.id),
        team1:      m.homeTeam?.shortName || m.homeTeam?.name || 'TBD',
        team2:      m.awayTeam?.shortName || m.awayTeam?.name || 'TBD',
        team1_flag: m.homeTeam?.crest || '',
        team2_flag: m.awayTeam?.crest || '',
        status:     mapStatus(m.status),
        time:       m.utcDate || '',
        score1:     m.score?.fullTime?.home ?? null,
        score2:     m.score?.fullTime?.away ?? null,
        group:      m.group || m.stage || '',
        stage:      m.stage || '',
      }));

      setCache('matches', matches);
      return res.json(matches);
    }

    if (type === 'standings') {
      const cached = getCache('standings');
      if (cached) return res.json(cached);

      const data = await fetchFootball('/competitions/WC/standings');
      const groups = (data.standings || [])
        .filter(s => s.type === 'TOTAL')
        .map(g => ({
          group: g.group || g.stage,
          table: (g.table || []).map(r => ({
            pos:    r.position,
            team:   r.team?.shortName || r.team?.name || '',
            flag:   r.team?.crest || '',
            played: r.playedGames,
            won:    r.won,
            draw:   r.draw,
            lost:   r.lost,
            gf:     r.goalsFor,
            ga:     r.goalsAgainst,
            gd:     r.goalDifference,
            pts:    r.points,
          }))
        }));

      setCache('standings', groups);
      return res.json(groups);
    }

    if (type === 'bracket') {
      const cached = getCache('bracket');
      if (cached) return res.json(cached);

      const data = await fetchFootball('/competitions/WC/matches');
      const knockoutStages = [
        'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'
      ];

      const bracket = {};
      for (const stage of knockoutStages) {
        const stagMatches = (data.matches || [])
          .filter(m => m.stage === stage)
          .map(m => ({
            id:     String(m.id),
            team1:  m.homeTeam?.shortName || m.homeTeam?.name || 'TBD',
            team2:  m.awayTeam?.shortName || m.awayTeam?.name || 'TBD',
            flag1:  m.homeTeam?.crest || '',
            flag2:  m.awayTeam?.crest || '',
            score1: m.score?.fullTime?.home ?? null,
            score2: m.score?.fullTime?.away ?? null,
            status: mapStatus(m.status),
            time:   m.utcDate || '',
          }));
        if (stagMatches.length > 0) {
          bracket[stage] = stagMatches;
        }
      }

      setCache('bracket', bracket);
      return res.json(bracket);
    }

    return res.json({ ok: true, endpoints: ['matches', 'standings', 'bracket'] });

  } catch (err) {
    return res.status(502).json({ error: 'Football data ana jayni', detail: err.message });
  }
}