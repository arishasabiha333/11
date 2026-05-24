// api/sync_firebase.js
// Ei file ta Cron-job theke call hobe ar Football API theke data niye Firebase e update korbe.

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '88f882f3c9134e8f88fe603200df6fcb';
// নিচে 'তোমার_কপি_করা_সিক্রেট_কোডটি_এখানে_বসাও' লেখাটি মুছে তোমার আসল কোডটি বসিয়ে দেবে
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || 'rtdb	V44VdlWZAJZfHXr09DTTL8oRn1lBrgypiWmRWk0C';
const FIREBASE_URL = 'https://ultrakick-a0e0b-default-rtdb.asia-southeast1.firebasedatabase.app'; 
const BASE = 'https://api.football-data.org/v4';

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
  // Security key check
  const cronKey = req.query.key;
  if (cronKey !== 'UK_CRON_2026_SECRET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Fetch Matches
    const matchesData = await fetchFootball('/competitions/WC/matches', {
      status: 'SCHEDULED,LIVE,FINISHED', limit: '64'
    });
    
    const matches = (matchesData.matches || []).map((m, index) => ({
        id:         String(m.id),
        order:      index, // Sorting er jonno
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

    // 2. Fetch Standings
    const standingsData = await fetchFootball('/competitions/WC/standings');
    const groups = (standingsData.standings || [])
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

    // 3. Process Bracket
    const knockoutStages = [
        'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'
    ];
    const bracket = {};
    for (const stage of knockoutStages) {
        const stagMatches = matches.filter(m => m.stage === stage);
        if (stagMatches.length > 0) {
            bracket[stage] = stagMatches;
        }
    }

    // 4. Update Firebase (with auth secret bypass)
    const firebasePayload = {
      matches: matches,
      standings: groups,
      bracket: bracket,
      last_updated: new Date().toISOString()
    };

    const firebaseRes = await fetch(`${FIREBASE_URL}/football_data.json?auth=${FIREBASE_SECRET}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(firebasePayload)
    });

    if (!firebaseRes.ok) {
        const errText = await firebaseRes.text();
        throw new Error(`Failed to update Firebase: ${errText}`);
    }

    return res.json({ success: true, message: 'Firebase updated successfully!' });

  } catch (err) {
    return res.status(500).json({ error: 'Update failed', detail: err.message });
  }
}