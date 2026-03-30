const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://courtiq-rouge.vercel.app"
  ]
}));

const ESPN_IDS = {
  ATL: 1, BOS: 2, BKN: 17, CHA: 30, CHI: 4, CLE: 5, DAL: 6, DEN: 7,
  DET: 8, GSW: 9, HOU: 10, IND: 11, LAC: 12, LAL: 13, MEM: 29,
  MIA: 14, MIL: 15, MIN: 16, NOP: 3, NYK: 18, OKC: 25, ORL: 19,
  PHI: 20, PHX: 21, POR: 22, SAC: 23, SAS: 24, TOR: 28, UTA: 26,
  WAS: 27,
};

// ESPN scoreboard sometimes returns shortened abbreviations — normalize to standard
const ESPN_ABBREV_MAP = {
  GS:   "GSW",
  NO:   "NOP",
  NY:   "NYK",
  SA:   "SAS",
  UTAH: "UTA",
  WSH:  "WAS",
  BRK:  "BKN",
  PHO:  "PHX",
};

function normalizeAbbrev(abbrev) {
  if (!abbrev) return abbrev;
  const upper = abbrev.toUpperCase();
  return ESPN_ABBREV_MAP[upper] || upper;
}

// DST-aware ET date string via Intl API
function getESTDateString() {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).replace(/(\d+)\/(\d+)\/(\d+)/, (_, m, d, y) => y + m + d);
}

app.get("/games", async (req, res) => {
  try {
    const dateStr = getESTDateString();
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
    const data = await response.json();

    const games = (data.events || []).map((event) => {
      const comp = event.competitions?.[0];
      if (!comp) return null;

      const homeTeamData = comp.competitors?.find(c => c.homeAway === "home");
      const awayTeamData = comp.competitors?.find(c => c.homeAway === "away");
      const homeAbbrev = normalizeAbbrev(homeTeamData?.team?.abbreviation);
      const awayAbbrev = normalizeAbbrev(awayTeamData?.team?.abbreviation);

      const statusType = comp.status?.type?.name;
      let status = "scheduled";
      if (statusType === "STATUS_IN_PROGRESS") status = "inprogress";
      else if (statusType === "STATUS_FINAL") status = "closed";

      const homeScore = parseInt(homeTeamData?.score);
      const awayScore = parseInt(awayTeamData?.score);
      const quarter = comp.status?.period;
      const clock = comp.status?.displayClock;

      const probData = comp.predictor;
      const homeProb = probData?.homeTeam?.gameProjection
        ? parseFloat(probData.homeTeam.gameProjection) : undefined;
      const awayProb = probData?.awayTeam?.gameProjection
        ? parseFloat(probData.awayTeam.gameProjection) : undefined;

      return {
        id: event.id,
        status,
        start_time: event.date,
        home: homeAbbrev,
        away: awayAbbrev,
        teams: {
          [homeAbbrev]: { name: homeTeamData?.team?.displayName, abbreviation: homeAbbrev },
          [awayAbbrev]: { name: awayTeamData?.team?.displayName, abbreviation: awayAbbrev },
        },
        score: (!isNaN(homeScore) && !isNaN(awayScore) && status !== "scheduled")
          ? { [homeAbbrev]: homeScore, [awayAbbrev]: awayScore } : undefined,
        quarter: status === "inprogress" ? quarter : undefined,
        clock: status === "inprogress" ? clock : undefined,
        win_probability: (homeProb && awayProb)
          ? { [homeAbbrev]: homeProb, [awayAbbrev]: awayProb } : undefined,
      };
    }).filter(Boolean);

    res.json({ games });
  } catch (err) {
    console.error("Error fetching games:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/standings", async (req, res) => {
  try {
    const url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/standings";
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
    const data = await response.json();

    const standings = {};
    (data.children || []).forEach(conf => {
      let confRank = 0;
      (conf.standings?.entries || []).forEach(entry => {
        confRank++;
        const abbrev = normalizeAbbrev(entry.team?.abbreviation);
        if (!abbrev) return;
        const getStat = (name) => entry.stats?.find(s => s.name === name)?.value ?? null;
        const getDisplay = (name) => entry.stats?.find(s => s.name === name)?.displayValue ?? "";
        const wins   = getStat("wins")       ?? getStat("totalWins")   ?? 0;
        const losses = getStat("losses")     ?? getStat("totalLosses") ?? 0;
        const pct    = getStat("winPercent") ?? getStat("WinPct")      ?? (wins + losses > 0 ? wins / (wins + losses) : 0.5);
        const homeW  = getStat("homeWins")   ?? 0;
        const homeL  = getStat("homeLosses") ?? 0;
        const awayW  = getStat("roadWins")   ?? getStat("awayWins")    ?? 0;
        const awayL  = getStat("roadLosses") ?? getStat("awayLosses")  ?? 0;
        const streak = getDisplay("streak");
        const last10 = getDisplay("Last Ten Games") || getDisplay("lastTen") || getDisplay("l10");
        console.log(`${abbrev}: ${wins}-${losses} (${(pct*100).toFixed(1)}%) rank #${confRank}`);
        standings[abbrev] = { wins, losses, pct, homeRecord: `${homeW}-${homeL}`, awayRecord: `${awayW}-${awayL}`, streak, last10, confRank };
      });
    });
    console.log(`Standings loaded: ${Object.keys(standings).length} teams`);

    res.json(standings);
  } catch (err) {
    console.error("Error fetching standings:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/roster/:abbrev", async (req, res) => {
  const abbrev = normalizeAbbrev(req.params.abbrev);
  const teamId = ESPN_IDS[abbrev];
  if (!teamId) return res.status(400).json({ error: `Unknown team: ${abbrev}` });

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
    const data = await response.json();

    const players = (data.athletes || []).map((p) => ({
      name: p.fullName,
      position: p.position?.abbreviation || "?",
      jersey: p.jersey || "?",
      status: p.injuries?.[0]?.status
        || (p.status?.type?.name === "suspended" ? "Suspended" : null)
        || "Active",
    }));

    res.json({ team: abbrev, players });
  } catch (err) {
    console.error(`Error fetching roster for ${abbrev}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/teamstats/:abbrev", async (req, res) => {
  const abbrev = normalizeAbbrev(req.params.abbrev);
  const teamId = ESPN_IDS[abbrev];
  if (!teamId) return res.status(400).json({ error: `Unknown team: ${abbrev}` });

  try {
    // sports.core.api.espn.com is the correct domain for team season stats
    // season type 2 = regular season; we try current year then fall back to previous
    const year = new Date().getFullYear();
    const tryUrls = [
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${year}/types/2/teams/${teamId}/statistics`,
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${year - 1}/types/2/teams/${teamId}/statistics`,
    ];

    let data = null;
    for (const url of tryUrls) {
      const r = await fetch(url);
      if (r.ok) { data = await r.json(); break; }
    }
    if (!data) throw new Error("ESPN stats endpoint unavailable for this team");

    // ESPN core API returns categories array at data.splits.categories
    // Each category has a .stats array with { name, value, displayValue }
    const allStats = {};
    const categories = data.splits?.categories || data.results?.splits?.categories || [];
    categories.forEach(cat => {
      (cat.stats || []).forEach(s => { allStats[s.name] = s.value ?? null; });
    });

    // Also check top-level stats array (some endpoints return flat)
    (data.stats || []).forEach(s => { allStats[s.name] = s.value ?? null; });

    const g = (...names) => { for (const n of names) if (allStats[n] != null) return allStats[n]; return null; };

    const fgaPerGame = g("avgFieldGoalAttempts","avgFGA","fieldGoalAttempts");
    const tpaPerGame = g("avgThreePointFieldGoalAttempts","avg3PA","threePointFieldGoalAttempts");
    const fg3Rate    = (fgaPerGame && tpaPerGame && fgaPerGame > 0) ? (tpaPerGame / fgaPerGame) : null;

    res.json({
      team: abbrev,
      offense: {
        ppg:             g("avgPoints","points"),
        fg3Rate,
        fg3Pct:          g("threePointFieldGoalPct","threePointPct","avg3PPct"),
        paintPtsPerGame: g("avgPointsInThePaint","avgPaintPoints","pointsInThePaint"),
        astPg:           g("avgAssists","assists"),
        tovPg:           g("avgTurnovers","turnovers"),
        fgaPerGame, tpaPerGame,
      },
      defense: {
        oppPpg:      g("avgPointsAllowed","opponentAvgPoints","avgPointsAgainst","pointsAllowed"),
        oppFg3Pct:   g("opponentThreePointPct","avgOpponentThreePointPct","oppThreePointPct"),
        oppPaintPts: g("avgOpponentPointsInThePaint","opponentAvgPaintPoints","opponentPointsInThePaint"),
        oppFgPct:    g("opponentFieldGoalPct","avgOpponentFieldGoalPct","oppFieldGoalPct"),
        defRebPg:    g("avgDefensiveRebounds","defensiveRebounds"),
        stealsPg:    g("avgSteals","steals"),
        blocksPg:    g("avgBlocks","blocks"),
      },
      ratings: {
        offRating: g("offensiveRating","offRating","avgPointsPerPossession"),
        defRating: g("defensiveRating","defRating","avgPointsAllowedPerPossession"),
      },
      pace:   g("possessionsPerGame","avgPossessions","pace"),
      clutch: {
        wins:   g("closeWins","clutchWins"),
        losses: g("closeLosses","clutchLosses"),
      },
      _debug: { categoriesFound: categories.map(c => c.name), totalStats: Object.keys(allStats).length },
    });
  } catch (err) {
    console.error(`/teamstats ${abbrev}:`, err.message);
    // Return null stats instead of 500 — frontend gracefully handles nulls
    res.json({
      team: abbrev, _error: err.message,
      offense: {}, defense: {}, ratings: {}, pace: null, clutch: {},
    });
  }
});


// ── /playerstats: real per-player stats via ESPN core API ──────────────────
app.get("/playerstats/:abbrev", async (req, res) => {
  const abbrev = normalizeAbbrev(req.params.abbrev);
  const teamId = ESPN_IDS[abbrev];
  if (!teamId) return res.status(400).json({ error: `Unknown team: ${abbrev}` });
  try {
    const year = new Date().getFullYear();
    const roster = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`
    ).then(r => r.json());
    const rows = await Promise.all(
      (roster.athletes || []).slice(0, 16).map(async (p) => {
        const status = p.injuries?.[0]?.status
          || (p.status?.type?.name === "suspended" ? "Suspended" : null)
          || "Active";
        try {
          const url = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${year}/types/2/athletes/${p.id}/statistics/0`;
          const r = await fetch(url);
          if (!r.ok) return null;
          const sd = await r.json();
          const map = {};
          (sd.splits?.categories || []).forEach(cat =>
            (cat.stats || []).forEach(s => { if (s.value != null) map[s.name] = s.value; })
          );
          const g = (...keys) => { for (const k of keys) if (map[k] != null) return map[k]; return 0; };
          const ppg = g("avgPoints");
          if (ppg === 0) return null;
          return {
            name: p.fullName, position: p.position?.abbreviation || "?", status,
            ppg, rpg: g("avgRebounds"), apg: g("avgAssists"),
            spg: g("avgSteals"), bpg: g("avgBlocks"),
            fg3Pct: g("threePointFieldGoalPct", "threePointPct"),
            mpg: g("avgMinutes"),
          };
        } catch { return null; }
      })
    );
    const players = rows.filter(Boolean).sort((a, b) => b.ppg - a.ppg).slice(0, 10);
    console.log(`[playerstats] ${abbrev}: ${players[0]?.name} leads ${players[0]?.ppg?.toFixed(1)}ppg`);
    res.json({ team: abbrev, players });
  } catch (err) {
    console.error(`/playerstats ${abbrev}:`, err.message);
    res.json({ team: abbrev, players: [] });
  }
});

// ── /schedule: last 5 games, rest days, back-to-back detection ──────────────
app.get("/schedule/:abbrev", async (req, res) => {
  const abbrev = normalizeAbbrev(req.params.abbrev);
  const teamId = ESPN_IDS[abbrev];
  if (!teamId) return res.status(400).json({ error: `Unknown team: ${abbrev}` });
  try {
    const data = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule`
    ).then(r => r.json());
    const now = new Date();
    const recent = (data.events || [])
      .filter(e => new Date(e.date) < now && e.competitions?.[0]?.status?.type?.completed)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
      .map(e => {
        const comp = e.competitions?.[0];
        const mine = comp?.competitors?.find(c => normalizeAbbrev(c.team?.abbreviation) === abbrev);
        return { date: e.date, homeAway: mine?.homeAway || "?", result: mine?.winner ? "W" : "L" };
      });
    const last = recent[0];
    const restDays = last ? Math.floor((now - new Date(last.date)) / 86400000) : null;
    res.json({
      team: abbrev, restDays, isBackToBack: restDays != null && restDays <= 1,
      recentForm: recent.map(g => g.result).join(""),
      recentWins:   recent.filter(g => g.result === "W").length,
      recentLosses: recent.filter(g => g.result === "L").length,
      lastGameDate: last?.date || null,
    });
  } catch (err) {
    console.error(`/schedule ${abbrev}:`, err.message);
    res.json({ team: abbrev, restDays: null, isBackToBack: false, recentForm: "", recentWins: 0, recentLosses: 0 });
  }
});


// ── Player cache: built once on startup from all 30 team rosters ─────────────
let playerCache = []; // { id, name, nameLower, team, position }
let cacheBuilt = false;

async function buildPlayerCache() {
  if (cacheBuilt) return;
  console.log("[playercache] Building player cache from all rosters...");
  const allPlayers = [];
  await Promise.all(Object.entries(ESPN_IDS).map(async ([abbrev, teamId]) => {
    try {
      const roster = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`
      ).then(r => r.json());
      (roster.athletes || []).forEach(a => {
        if (a.id && a.fullName) {
          allPlayers.push({
            id: String(a.id),
            name: a.fullName,
            nameLower: a.fullName.toLowerCase(),
            team: abbrev,
            position: a.position?.abbreviation || "?",
          });
        }
      });
    } catch {}
  }));
  playerCache = allPlayers;
  cacheBuilt = true;
  console.log(`[playercache] Done — ${playerCache.length} players cached`);
}

// Build cache on startup
buildPlayerCache();

// ── /playersearch/:name: search cached player list ────────────────────────────
app.get("/playersearch/:name", async (req, res) => {
  const name = (req.params.name || "").trim();
  if (!name || name.length < 2) return res.json({ players: [] });

  // Wait for cache if still building
  if (!cacheBuilt) await buildPlayerCache();

  const q = name.toLowerCase();
  const results = playerCache
    .filter(p => p.nameLower.includes(q))
    .slice(0, 8);

  console.log(`[playersearch] "${name}" → ${results.length} results`);
  res.json({ players: results });
});

// ── /gamelog/:playerId: game log via ESPN event box scores ───────────────────
// ESPN's /gamelog endpoint requires auth — instead we use the player's
// recent events from the stats API, then fetch each box score individually
app.get("/gamelog/:playerId", async (req, res) => {
  const { playerId } = req.params;
  try {
    const year = new Date().getFullYear();

    // Step 1: Get player's team via athlete profile — try multiple ESPN endpoints
    let teamAbbrev = null;
    let teamId = null;

    // Try the core API first (more reliable)
    try {
      const coreProfile = await fetch(
        `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/${playerId}?lang=en&region=us`
      ).then(r => r.json());
      // Core API returns team as a $ref link — extract team ID from it
      const teamRef = coreProfile.team?.$ref || "";
      const teamIdMatch = teamRef.match(/teams\/([0-9]+)/);
      if (teamIdMatch) {
        const espnTeamId = teamIdMatch[1];
        // Find our abbrev from ESPN_IDS map
        teamAbbrev = Object.entries(ESPN_IDS).find(([, id]) => String(id) === espnTeamId)?.[0];
        teamId = espnTeamId;
      }
    } catch {}

    // Fallback: site API
    if (!teamId) {
      try {
        const profile = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/${playerId}`
        ).then(r => r.json());
        const abbrev = profile.athlete?.team?.abbreviation
          || profile.athlete?.teams?.[0]?.team?.abbreviation;
        if (abbrev) {
          teamAbbrev = normalizeAbbrev(abbrev);
          teamId = ESPN_IDS[teamAbbrev];
        }
      } catch {}
    }

    // Fallback 2: search all team rosters for this player ID
    if (!teamId) {
      console.log(`[gamelog] scanning rosters for player ${playerId}...`);
      for (const [abbrev, tid] of Object.entries(ESPN_IDS)) {
        try {
          const roster = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${tid}/roster`
          ).then(r => r.json());
          const found = (roster.athletes || []).find(a => String(a.id) === String(playerId));
          if (found) {
            teamAbbrev = abbrev;
            teamId = tid;
            console.log(`[gamelog] found player ${playerId} on ${abbrev}`);
            break;
          }
        } catch {}
      }
    }

    if (!teamId) {
      console.error(`[gamelog] No team found for player ${playerId}`);
      return res.json({ games: [], seasonAvg: { pts: 0, reb: 0, ast: 0 } });
    }

    // Step 2: Get team schedule to find recent completed games
    const schedule = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${year}`
    ).then(r => r.json());

    const now = new Date();
    const completedGames = (schedule.events || [])
      .filter(e => {
        const comp = e.competitions?.[0];
        return comp?.status?.type?.completed && new Date(e.date) < now;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    // No slice — fetch full season so W/O filters have enough games to work with

    console.log(`[gamelog] ${playerId} (${teamAbbrev}): ${completedGames.length} completed games found`);
    console.log(`[gamelog] event IDs: ${completedGames.slice(0,5).map(e=>e.id).join(', ')}`);

    // Step 3: For each game fetch box score and find player stats
    const games = [];

    await Promise.all(completedGames.map(async (event) => {
      try {
        const eventId = event.id;
        const summary = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`
        ).then(r => r.json());

        // ── Full game stats from box score ─────────────────────────────────
        let playerStats = null;
        let teammatesOut = []; // {id, name} — confirmed DNP teammates
        let teammatesIn  = []; // {id, name} — teammates who played
        const boxPlayers = summary.boxscore?.players || [];
        for (const team of boxPlayers) {
          const isMyTeam = normalizeAbbrev(team.team?.abbreviation) === normalizeAbbrev(teamAbbrev);
          for (const statGroup of (team.statistics || [])) {
            const labels = (statGroup.labels || []).map(l => l.toLowerCase());
            const ptsIdx = labels.indexOf("pts");
            const rebIdx = labels.indexOf("reb");
            const astIdx = labels.indexOf("ast");
            const minIdx = labels.findIndex(l => l === "min" || l === "minutes");

            for (const athlete of (statGroup.athletes || [])) {
              const athId = String(athlete.athlete?.id);
              const athName = athlete.athlete?.displayName || athId;
              const idMatch = athId === String(playerId);
              const s = athlete.stats || [];
              const dnp = !s.length || athlete.didNotPlay || s[0] === "DNP" || s[0] === "--";

              // Track all teammates (not the player themselves)
              // teammatesIn requires >= 8 min so garbage-time appearances don't count as "played"
              if (isMyTeam && !idMatch) {
                if (dnp) {
                  teammatesOut.push({ id: athId, name: athName });
                } else {
                  const tmMin = minIdx >= 0 ? parseFloat(s[minIdx]) || 0 : 999;
                  if (tmMin >= 8) { teammatesIn.push({ id: athId, name: athName }); }
                  else            { teammatesOut.push({ id: athId, name: athName }); }
                }
              }

              if (!idMatch) continue;
              if (dnp) {
                playerStats = { pts: 0, reb: 0, ast: 0, min: 0, dnp: true };
              } else {
                playerStats = {
                  pts: ptsIdx >= 0 ? parseFloat(s[ptsIdx]) || 0 : 0,
                  reb: rebIdx >= 0 ? parseFloat(s[rebIdx]) || 0 : 0,
                  ast: astIdx >= 0 ? parseFloat(s[astIdx]) || 0 : 0,
                  min: minIdx >= 0 ? parseFloat(s[minIdx]) || 0 : 0,
                  dnp: false,
                };
              }
              break;
            }
            if (playerStats) break;
          }
          if (playerStats) break;
        }

        if (!playerStats) return; // Player not in this box score

        // ── Q1 stats from play-by-play text matching ──────────────────────────
        // Note: summary plays have null participant refs, so we match by player name in text
        const q1plays = (summary.plays || []).filter(p => p.period?.number === 1);

        // Get player's display name from box score for text matching
        let playerDisplayName = null;
        for (const team of (summary.boxscore?.players || [])) {
          for (const sg of (team.statistics || [])) {
            for (const ath of (sg.athletes || [])) {
              if (String(ath.athlete?.id) === String(playerId)) {
                playerDisplayName = ath.athlete?.displayName || ath.athlete?.shortName;
                break;
              }
            }
            if (playerDisplayName) break;
          }
          if (playerDisplayName) break;
        }

        // Also build first/last name variants for matching
        const nameParts = (playerDisplayName || "").split(" ");
        const lastName = nameParts.slice(-1)[0]?.toLowerCase() || "";
        const firstName = nameParts[0]?.toLowerCase() || "";

        const playerInPlay = (text) => {
          if (!text || (!lastName && !firstName)) return false;
          const t = text.toLowerCase();
          // Match "Kawhi Leonard makes..." or "Leonard makes..."
          return (lastName && t.includes(lastName)) || (firstName && t.includes(firstName));
        };

        let q1pts = 0, q1reb = 0, q1ast = 0;

        for (const play of q1plays) {
          const typeText = (play.type?.text || "").toLowerCase();
          const playText = play.text || "";
          const scoreVal = play.scoreValue || 0;

          // Points: scoring play AND player name appears before "makes"
          if (play.scoringPlay && scoreVal > 0) {
            // Check if our player is the scorer (name appears at start of play text)
            const scorerMatch = playText.toLowerCase().match(/^([a-z\s\.\-']+)\s+makes/);
            if (scorerMatch) {
              const scorerName = scorerMatch[1].trim();
              if (scorerName.includes(lastName) || (firstName && scorerName.includes(firstName))) {
                q1pts += scoreVal;
              }
            }
          }

          // Rebounds: type is rebound AND player name in text
          if (typeText.includes("rebound") && !typeText.includes("team") && playerInPlay(playText)) {
            q1reb += 1;
          }

          // Assists: play text has "(PlayerName assists)" pattern
          if (playText.toLowerCase().includes("assists)") || playText.toLowerCase().includes(" assists")) {
            const assistMatch = playText.match(/\(([^)]+)\s+assists\)/i);
            if (assistMatch) {
              const assisterName = assistMatch[1].toLowerCase();
              if (assisterName.includes(lastName) || (firstName && assisterName.includes(firstName))) {
                q1ast += 1;
              }
            }
          }
        }

        playerStats.q1pts = q1pts;
        playerStats.q1reb = q1reb;
        playerStats.q1ast = q1ast;
        console.log(`[q1] ${playerDisplayName || playerId}: ${q1pts}pts ${q1reb}reb ${q1ast}ast in Q1`);

        // Find opponent
        const comp = event.competitions?.[0];
        const myTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) === normalizeAbbrev(teamAbbrev));
        const oppTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) !== normalizeAbbrev(teamAbbrev));
        const homeAway = myTeam?.homeAway || "?";
        const result = myTeam?.winner ? "W" : "L";
        const opponent = oppTeam?.team?.abbreviation || "?";

        games.push({
          date: event.date || "",
          opponent,
          homeAway,
          result,
          teammatesOut,
          teammatesIn,
          ...playerStats,
        });
      } catch (e) {
        console.error(`[gamelog] box score error for event:`, e.message);
      }
    }));

    // Sort by date desc
    games.sort((a, b) => new Date(b.date) - new Date(a.date));
    const played = games.filter(g => !g.dnp);
    const avg = (arr, key) => arr.length ? parseFloat((arr.reduce((s, g) => s + (g[key]||0), 0) / arr.length).toFixed(1)) : 0;
    const seasonAvg = { pts: avg(played, "pts"), reb: avg(played, "reb"), ast: avg(played, "ast") };

    console.log(`[gamelog] done: ${games.length} games, avg ${seasonAvg.pts}pts`);
    res.json({ games, seasonAvg }); // full season — frontend slices to L5/L10/L20/All
  } catch (err) {
    console.error(`/gamelog ${playerId}:`, err.message);
    res.json({ games: [], seasonAvg: { pts: 0, reb: 0, ast: 0 } });
  }
});


// ── /gamelog-debug/:playerId: raw ESPN response for debugging ────────────────
app.get("/gamelog-debug/:playerId", async (req, res) => {
  const { playerId } = req.params;
  const year = new Date().getFullYear();
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/${playerId}/gamelog?season=${year}`;
    const raw = await fetch(url).then(r => r.json());
    res.json({
      topLevelKeys: Object.keys(raw),
      hasEvents: !!raw.events,
      eventsType: typeof raw.events,
      eventCount: typeof raw.events === "object" ? Object.keys(raw.events||{}).length : 0,
      hasCategories: !!raw.categories,
      categoryCount: (raw.categories||[]).length,
      categoryNames: (raw.categories||[]).map(c => c.abbreviation || c.name),
      hasSeasonTypes: !!raw.seasonTypes,
      seasonTypeCount: (raw.seasonTypes||[]).length,
      firstEventSample: typeof raw.events === "object" ? Object.values(raw.events||{})[0] : null,
      seasonTypesSample: raw.seasonTypes?.[0] ? {
        name: raw.seasonTypes[0].name,
        type: raw.seasonTypes[0].type,
        categoryCount: (raw.seasonTypes[0].categories||[]).length,
        eventCount: Object.keys(raw.seasonTypes[0].events||{}).length,
        firstEvent: Object.values(raw.seasonTypes[0].events||{})[0],
      } : null,
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});


// ── /pbp-debug/:eventId/:playerId: debug Q1 play parsing ────────────────────
app.get("/pbp-debug/:eventId/:playerId?", async (req, res) => {
  const { eventId, playerId } = req.params;
  try {
    const summary = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`
    ).then(r => r.json());

    const plays = summary.plays || [];
    const q1plays = plays.filter(p => p.period?.number === 1);

    // If playerId given, find plays involving that player
    let playerPlays = [];
    if (playerId) {
      playerPlays = q1plays.filter(p =>
        (p.participants || []).some(part => {
          const ref = part.athlete?.$ref || "";
          const m = ref.match(/athletes\/([0-9]+)/);
          return m && m[1] === String(playerId);
        })
      );
    }

    // Sample a scoring play to see structure
    const scoringPlays = q1plays.filter(p => p.scoringPlay);

    const results = {
      totalPlays: plays.length,
      q1PlayCount: q1plays.length,
      scoringQ1Count: scoringPlays.length,
      scoringSample: scoringPlays.slice(0, 2).map(p => ({
        text: p.text,
        type: p.type?.text,
        scoreValue: p.scoreValue,
        scoringPlay: p.scoringPlay,
        participantRefs: (p.participants||[]).map(pt => pt.athlete?.$ref),
      })),
      playerQ1PlayCount: playerPlays.length,
      playerPlays: playerPlays.slice(0, 5).map(p => ({
        text: p.text,
        type: p.type?.text,
        scoreValue: p.scoreValue,
        scoringPlay: p.scoringPlay,
      })),
      // Show first few participant refs to check ID format
      firstQ1ParticipantRefs: q1plays.slice(0, 3).map(p =>
        (p.participants||[]).map(pt => pt.athlete?.$ref)
      ),
    };

    // Also try the old multi-endpoint approach
    const results2 = {};

    // 1. Standard summary
    try {
      const d = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`).then(r=>r.json());
      results.summary = { topKeys: Object.keys(d), code: d.code, hasPlays: !!d.plays, playsCount: (d.plays||[]).length, hasBoxscore: !!d.boxscore, boxscoreKeys: Object.keys(d.boxscore||{}) };
    } catch(e) { results.summary = { error: e.message }; }

    // 2. Core API event
    try {
      const d = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${eventId}`).then(r=>r.json());
      results.coreEvent = { topKeys: Object.keys(d), code: d.code };
    } catch(e) { results.coreEvent = { error: e.message }; }

    // 3. Play-by-play specific endpoint
    try {
      const d = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/playbyplay?event=${eventId}`).then(r=>r.json());
      results.playbyplay = { topKeys: Object.keys(d), code: d.code, hasItems: !!d.items, itemCount: (d.items||[]).length, firstItem: d.items?.[0] };
    } catch(e) { results.playbyplay = { error: e.message }; }

    // 4. Core plays
    try {
      const d = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${eventId}/competitions/${eventId}/plays?limit=50&period=1`).then(r=>r.json());
      results.corePlays = { topKeys: Object.keys(d), code: d.code, count: d.count, itemCount: (d.items||[]).length, firstItem: d.items?.[0] };
    } catch(e) { results.corePlays = { error: e.message }; }

    res.json({ ...results, ...results2 });
  } catch (err) {
    res.json({ error: err.message });
  }
});


// ── /gamelogs-batch: fetch L20 gamelogs for multiple players at once ─────────
app.get("/gamelogs-batch/:teamAbbrev", async (req, res) => {
  const abbrev = normalizeAbbrev(req.params.teamAbbrev);
  const teamId = ESPN_IDS[abbrev];
  if (!teamId) return res.json({ players: [] });

  try {
    const year = new Date().getFullYear();

    // Get roster first
    const roster = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`
    ).then(r => r.json());

    // Get team schedule for recent completed games
    const schedule = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${year}`
    ).then(r => r.json());

    const now = new Date();
    const completedGames = (schedule.events || [])
      .filter(e => e.competitions?.[0]?.status?.type?.completed && new Date(e.date) < now)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 15); // last 15 games is enough

    if (completedGames.length === 0) return res.json({ players: [] });

    // Get top players by position from roster (limit to starters/key rotation)
    const topPlayers = (roster.athletes || []).slice(0, 12);

    // Build player ID set for quick lookup
    const playerIds = new Set(topPlayers.map(p => String(p.id)));

    // Fetch all box scores in parallel
    const boxScores = await Promise.all(
      completedGames.map(async event => {
        try {
          const summary = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`
          ).then(r => r.json());

          // Get opponent
          const comp = event.competitions?.[0];
          const myTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) === abbrev);
          const oppTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) !== abbrev);
          const result = myTeam?.winner ? "W" : "L";
          const opponent = oppTeam?.team?.abbreviation || "?";
          const date = event.date;

          // Extract player stats from box score
          const playerStats = {};
          for (const team of (summary.boxscore?.players || [])) {
            for (const sg of (team.statistics || [])) {
              const labels = (sg.labels || []).map(l => l.toLowerCase());
              const ptsIdx = labels.indexOf("pts");
              const rebIdx = labels.indexOf("reb");
              const astIdx = labels.indexOf("ast");
              const minIdx = labels.findIndex(l => l === "min" || l === "minutes");

              for (const ath of (sg.athletes || [])) {
                if (!playerIds.has(String(ath.athlete?.id))) continue;
                const s = ath.stats || [];
                const dnp = ath.didNotPlay || !s.length || s[0] === "DNP" || s[0] === "--";
                playerStats[String(ath.athlete.id)] = {
                  dnp,
                  pts: dnp || ptsIdx < 0 ? 0 : parseFloat(s[ptsIdx]) || 0,
                  reb: dnp || rebIdx < 0 ? 0 : parseFloat(s[rebIdx]) || 0,
                  ast: dnp || astIdx < 0 ? 0 : parseFloat(s[astIdx]) || 0,
                  min: dnp || minIdx < 0 ? 0 : parseFloat(s[minIdx]) || 0,
                };

                // Q1 stats from play-by-play
                if (!dnp) {
                  const playerName = (ath.athlete?.displayName || "").toLowerCase();
                  const nameParts = playerName.split(" ");
                  const lastName = nameParts.slice(-1)[0] || "";
                  let q1pts = 0, q1reb = 0, q1ast = 0;
                  const q1plays = (summary.plays || []).filter(p => p.period?.number === 1);
                  for (const play of q1plays) {
                    const typeText = (play.type?.text || "").toLowerCase();
                    const playText = play.text || "";
                    const scoreVal = play.scoreValue || 0;
                    if (play.scoringPlay && scoreVal > 0) {
                      const scorerMatch = playText.toLowerCase().match(/^([a-z\s.\-']+)\s+makes/);
                      if (scorerMatch && scorerMatch[1].trim().includes(lastName)) q1pts += scoreVal;
                    }
                    if (typeText.includes("rebound") && !typeText.includes("team") && playText.toLowerCase().includes(lastName)) q1reb++;
                    const assistMatch = playText.match(/\(([^)]+)\s+assists\)/i);
                    if (assistMatch && assistMatch[1].toLowerCase().includes(lastName)) q1ast++;
                  }
                  playerStats[String(ath.athlete.id)].q1pts = q1pts;
                  playerStats[String(ath.athlete.id)].q1reb = q1reb;
                  playerStats[String(ath.athlete.id)].q1ast = q1ast;
                }
              }
            }
          }
          return { date, opponent, result, playerStats };
        } catch { return null; }
      })
    );

    const validBoxScores = boxScores.filter(Boolean);

    // Build per-player game logs with smart line calculation
    const calcLine = (values, multiplier) => {
      if (!values.length) return null;
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      // Always produce X.5 format
      const raw = avg * multiplier;
      const floored = Math.floor(raw);
      return multiplier < 1 ? floored - 0.5 : floored + 0.5;
    };

    const hitRate = (values, line) => {
      if (!values.length || line == null) return 0;
      return Math.round(values.filter(v => v > line).length / values.length * 100);
    };

    const playerLogs = topPlayers.map(p => {
      const pid = String(p.id);
      const games = validBoxScores
        .map(bs => bs.playerStats[pid] ? { ...bs.playerStats[pid], date: bs.date, opponent: bs.opponent, result: bs.result } : null)
        .filter(g => g && !g.dnp && g.min >= 10);

      if (games.length < 3) return null; // not enough data

      const ptsVals = games.map(g => g.pts);
      const rebVals = games.map(g => g.reb);
      const astVals = games.map(g => g.ast);
      const q1ptsVals = games.map(g => g.q1pts || 0).filter(v => v > 0);
      const q1rebVals = games.map(g => g.q1reb || 0);
      const q1astVals = games.map(g => g.q1ast || 0);

      const avg = arr => arr.length ? parseFloat((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : 0;

      // Calculate safe/value/risky lines and their hit rates
      const safePtsLine  = calcLine(ptsVals, 0.60);
      const valuePtsLine = calcLine(ptsVals, 0.85);
      const riskyPtsLine = calcLine(ptsVals, 1.08);
      const safeRebLine  = calcLine(rebVals, 0.60);
      const safeAstLine  = calcLine(astVals, 0.60);
      const safeQ1PtsLine = q1ptsVals.length >= 3 ? calcLine(q1ptsVals, 0.60) : null;

      return {
        id: pid,
        name: p.fullName,
        position: p.position?.abbreviation || "?",
        gamesPlayed: games.length,
        avgs: { pts: avg(ptsVals), reb: avg(rebVals), ast: avg(astVals), q1pts: avg(q1ptsVals), q1reb: avg(q1rebVals), q1ast: avg(q1astVals) },
        lines: {
          safePts:   safePtsLine,  safePtsHit:   hitRate(ptsVals, safePtsLine),
          valuePts:  valuePtsLine, valuePtsHit:  hitRate(ptsVals, valuePtsLine),
          riskyPts:  riskyPtsLine, riskyPtsHit:  hitRate(ptsVals, riskyPtsLine),
          safeReb:   safeRebLine,  safeRebHit:   hitRate(rebVals, safeRebLine),
          safeAst:   safeAstLine,  safeAstHit:   hitRate(astVals, safeAstLine),
          safeQ1Pts: safeQ1PtsLine, safeQ1PtsHit: hitRate(q1ptsVals, safeQ1PtsLine),
        },
      };
    }).filter(Boolean).sort((a, b) => b.avgs.pts - a.avgs.pts).slice(0, 6);

    console.log(`[gamelogs-batch] ${abbrev}: ${playerLogs.length} players processed`);
    res.json({ team: abbrev, players: playerLogs });
  } catch (err) {
    console.error(`/gamelogs-batch ${abbrev}:`, err.message);
    res.json({ players: [] });
  }
});


// ── /def-vs-position/:abbrev: how a team defends each position ───────────────
app.get("/def-vs-position/:abbrev", async (req, res) => {
  const abbrev = normalizeAbbrev(req.params.abbrev);
  const teamId = ESPN_IDS[abbrev];
  if (!teamId) return res.status(400).json({ error: `Unknown team: ${abbrev}` });
  try {
    const year = new Date().getFullYear();
    // Get last 15 completed games for this team
    const schedule = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${year}`
    ).then(r => r.json());
    const now = new Date();
    const recentGames = (schedule.events || [])
      .filter(e => e.competitions?.[0]?.status?.type?.completed && new Date(e.date) < now)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 15);

    // For each game, get opponent players' stats grouped by position
    const posStats = { PG: [], SG: [], SF: [], PF: [], C: [] };

    await Promise.all(recentGames.map(async event => {
      try {
        const summary = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`
        ).then(r => r.json());
        const comp = event.competitions?.[0];
        const oppTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) !== abbrev);
        if (!oppTeam) return;

        // Get opponent roster to know positions
        const oppAbbrev = normalizeAbbrev(oppTeam.team?.abbreviation);
        const oppTeamId = ESPN_IDS[oppAbbrev];
        if (!oppTeamId) return;

        const oppRoster = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${oppTeamId}/roster`
        ).then(r => r.json());
        const positionMap = {};
        (oppRoster.athletes || []).forEach(a => {
          positionMap[String(a.id)] = a.position?.abbreviation || "?";
        });

        // Get box score stats for opponent players
        for (const team of (summary.boxscore?.players || [])) {
          // Only look at opponent team
          const teamAbbr = normalizeAbbrev(team.team?.abbreviation);
          if (teamAbbr === abbrev) continue;
          for (const sg of (team.statistics || [])) {
            const labels = (sg.labels || []).map(l => l.toLowerCase());
            const ptsIdx = labels.indexOf("pts");
            const rebIdx = labels.indexOf("reb");
            const astIdx = labels.indexOf("ast");
            const minIdx = labels.findIndex(l => l === "min" || l === "minutes");
            for (const ath of (sg.athletes || [])) {
              const s = ath.stats || [];
              if (!s.length || ath.didNotPlay || s[0] === "DNP" || s[0] === "--") continue;
              const min = minIdx >= 0 ? parseFloat(s[minIdx]) || 0 : 0;
              if (min < 15) continue; // skip bench scrubs
              const pos = positionMap[String(ath.athlete?.id)] || "?";
              const normPos = pos === "G" ? "PG" : pos === "F" ? "SF" : pos === "C/F" ? "PF" : pos;
              if (!posStats[normPos]) continue;
              posStats[normPos].push({
                pts: ptsIdx >= 0 ? parseFloat(s[ptsIdx]) || 0 : 0,
                reb: rebIdx >= 0 ? parseFloat(s[rebIdx]) || 0 : 0,
                ast: astIdx >= 0 ? parseFloat(s[astIdx]) || 0 : 0,
              });
            }
          }
        }
      } catch {}
    }));

    // Calculate averages and rank (lower = better defense)
    const avg = arr => arr.length ? parseFloat((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : 0;
    const result = {};
    for (const [pos, games] of Object.entries(posStats)) {
      result[pos] = {
        pts: avg(games.map(g=>g.pts)),
        reb: avg(games.map(g=>g.reb)),
        ast: avg(games.map(g=>g.ast)),
        gamesCount: games.length,
      };
    }
    console.log(`[def-vs-pos] ${abbrev}: done`);
    res.json({ team: abbrev, positions: result });
  } catch (err) {
    console.error(`/def-vs-position ${abbrev}:`, err.message);
    res.json({ team: abbrev, positions: {} });
  }
});

// ── /props-lab/:playerId: full player props data for Props Lab ────────────────
app.get("/props-lab/:playerId", async (req, res) => {
  const { playerId } = req.params;
  try {
    const year = new Date().getFullYear();

    // Get player team via roster scan (reuse cache)
    let teamAbbrev = null, teamId = null;
    if (playerCache.length > 0) {
      const found = playerCache.find(p => p.id === String(playerId));
      if (found) { teamAbbrev = found.team; teamId = ESPN_IDS[found.team]; }
    }
    if (!teamId) {
      for (const [abbrev, tid] of Object.entries(ESPN_IDS)) {
        try {
          const roster = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${tid}/roster`).then(r=>r.json());
          const found = (roster.athletes||[]).find(a => String(a.id) === String(playerId));
          if (found) { teamAbbrev = abbrev; teamId = tid; break; }
        } catch {}
      }
    }
    if (!teamId) return res.json({ error: "Player not found" });

    // Get schedule
    const schedule = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${year}`
    ).then(r => r.json());
    const now = new Date();
    const completedGames = (schedule.events || [])
      .filter(e => e.competitions?.[0]?.status?.type?.completed && new Date(e.date) < now)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20);

    // Fetch all box scores
    const gameData = await Promise.all(completedGames.map(async event => {
      try {
        const summary = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`
        ).then(r => r.json());
        const comp = event.competitions?.[0];
        const myTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) === teamAbbrev);
        const oppTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) !== teamAbbrev);
        const result = myTeam?.winner ? "W" : "L";
        const opponent = oppTeam?.team?.abbreviation || "?";
        const oppTeamId = ESPN_IDS[normalizeAbbrev(opponent)];
        const homeAway = myTeam?.homeAway || "?";

        // Find player in box score
        let playerStats = null;
        let teammatesOut = [];

        for (const team of (summary.boxscore?.players || [])) {
          const isMyTeam = normalizeAbbrev(team.team?.abbreviation) === teamAbbrev;
          for (const sg of (team.statistics || [])) {
            const labels = (sg.labels || []).map(l => l.toLowerCase());
            const ptsIdx = labels.indexOf("pts");
            const rebIdx = labels.indexOf("reb");
            const astIdx = labels.indexOf("ast");
            const minIdx = labels.findIndex(l => l === "min" || l === "minutes");
            const fg3Idx = labels.findIndex(l => l === "3pt" || l === "3pm");

            for (const ath of (sg.athletes || [])) {
              const s = ath.stats || [];
              const athId = String(ath.athlete?.id);
              const dnp = ath.didNotPlay || !s.length || s[0] === "DNP" || s[0] === "--";

              if (isMyTeam && athId !== String(playerId) && dnp) {
                teammatesOut.push(ath.athlete?.displayName || athId);
              }

              if (athId === String(playerId)) {
                if (dnp) { playerStats = { dnp: true }; }
                else {
                  const pts = ptsIdx >= 0 ? parseFloat(s[ptsIdx]) || 0 : 0;
                  const reb = rebIdx >= 0 ? parseFloat(s[rebIdx]) || 0 : 0;
                  const ast = astIdx >= 0 ? parseFloat(s[astIdx]) || 0 : 0;
                  const min = minIdx >= 0 ? parseFloat(s[minIdx]) || 0 : 0;
                  const fg3 = fg3Idx >= 0 ? parseFloat(s[fg3Idx]) || 0 : 0;

                  // Q1 from plays
                  const playerName = (ath.athlete?.displayName || "").toLowerCase();
                  const lastName = playerName.split(" ").slice(-1)[0] || "";
                  let q1pts=0, q1reb=0, q1ast=0;
                  for (const play of (summary.plays||[]).filter(p=>p.period?.number===1)) {
                    const tt = (play.type?.text||"").toLowerCase();
                    const pt = play.text || "";
                    if (play.scoringPlay && play.scoreValue > 0) {
                      const m = pt.toLowerCase().match(/^([a-z\s.\-']+)\s+makes/);
                      if (m && m[1].trim().includes(lastName)) q1pts += play.scoreValue;
                    }
                    if (tt.includes("rebound") && !tt.includes("team") && pt.toLowerCase().includes(lastName)) q1reb++;
                    const am = pt.match(/\(([^)]+)\s+assists\)/i);
                    if (am && am[1].toLowerCase().includes(lastName)) q1ast++;
                  }

                  playerStats = { dnp:false, pts, reb, ast, min, fg3, q1pts, q1reb, q1ast,
                    ptsAst: pts+ast, ptsReb: pts+reb, rebAst: reb+ast, ptsRebAst: pts+reb+ast,
                    doubleDouble: (pts>=10?1:0)+(reb>=10?1:0)+(ast>=10?1:0)>=2,
                    tripleDouble: (pts>=10?1:0)+(reb>=10?1:0)+(ast>=10?1:0)>=3,
                  };
                }
              }
            }
          }
        }
        if (!playerStats) return null;
        return { date: event.date, opponent, homeAway, result, teammatesOut, oppTeamId, ...playerStats };
      } catch { return null; }
    }));

    const games = gameData.filter(g => g && !g.dnp && g.min >= 10);
    const avg = arr => arr.length ? parseFloat((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : 0;
    const med = arr => { if(!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); return parseFloat((s[Math.floor(s.length/2)]).toFixed(1)); };

    const seasonAvg = {
      pts: avg(games.map(g=>g.pts)), reb: avg(games.map(g=>g.reb)), ast: avg(games.map(g=>g.ast)),
      min: avg(games.map(g=>g.min)), fg3: avg(games.map(g=>g.fg3)),
      ptsAst: avg(games.map(g=>g.ptsAst)), ptsReb: avg(games.map(g=>g.ptsReb)),
      rebAst: avg(games.map(g=>g.rebAst)), ptsRebAst: avg(games.map(g=>g.ptsRebAst)),
      q1pts: avg(games.map(g=>g.q1pts)), q1reb: avg(games.map(g=>g.q1reb)), q1ast: avg(games.map(g=>g.q1ast)),
    };
    const seasonMed = {
      pts: med(games.map(g=>g.pts)), reb: med(games.map(g=>g.reb)), ast: med(games.map(g=>g.ast)),
      fg3: med(games.map(g=>g.fg3)), ptsAst: med(games.map(g=>g.ptsAst)),
      ptsReb: med(games.map(g=>g.ptsReb)), ptsRebAst: med(games.map(g=>g.ptsRebAst)),
      q1pts: med(games.map(g=>g.q1pts)),
    };

    console.log(`[props-lab] ${playerId} (${teamAbbrev}): ${games.length} games`);
    res.json({ playerId, team: teamAbbrev, games: gameData.filter(Boolean), seasonAvg, seasonMed });
  } catch (err) {
    console.error(`/props-lab ${playerId}:`, err.message);
    res.json({ error: err.message });
  }
});


// ── /defvsposition/:teamAbbrev: how team defends each position ────────────────
app.get("/defvsposition/:teamAbbrev", async (req, res) => {
  const abbrev = normalizeAbbrev(req.params.teamAbbrev);
  const teamId = ESPN_IDS[abbrev];
  if (!teamId) return res.json({ error: "Unknown team" });
  try {
    const year = new Date().getFullYear();
    const schedule = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${year}`
    ).then(r => r.json());
    const now = new Date();
    const games = (schedule.events || [])
      .filter(e => e.competitions?.[0]?.status?.type?.completed && new Date(e.date) < now)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20); // last 20 games for better sample size

    // Accumulate opponent pts allowed per position
    // Each position bucket tracks total pts and game count
    const posStats = { PG:{pts:0,n:0}, SG:{pts:0,n:0}, SF:{pts:0,n:0}, PF:{pts:0,n:0}, C:{pts:0,n:0} };

    // Normalize ESPN position abbreviations to standard 5 positions
    // ESPN uses: PG, SG, SF, PF, C for starters
    // and: G (guard), F (forward), C (center), G-F, F-G, F-C, C-F for flex spots
    const normalizePos = (pos) => {
      switch(pos) {
        case "PG": return ["PG"];
        case "SG": return ["SG"];
        case "SF": return ["SF"];
        case "PF": return ["PF"];
        case "C":  return ["C"];
        // Combo positions — split credit between both positions
        case "G":   return ["PG", "SG"];
        case "F":   return ["SF", "PF"];
        case "G-F": case "F-G": return ["SG", "SF"];
        case "F-C": case "C-F": return ["PF", "C"];
        default:    return [];
      }
    };

    await Promise.all(games.map(async event => {
      try {
        const summary = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`
        ).then(r => r.json());
        const comp = event.competitions?.[0];
        const oppTeam = comp?.competitors?.find(t => normalizeAbbrev(t.team?.abbreviation) !== abbrev);
        const oppAbbrev = normalizeAbbrev(oppTeam?.team?.abbreviation || "");

        for (const team of (summary.boxscore?.players || [])) {
          const teamAbbr = normalizeAbbrev(team.team?.abbreviation || "");
          if (teamAbbr === abbrev) continue; // skip defending team, only look at opponent
          for (const sg of (team.statistics || [])) {
            const labels = (sg.labels || []).map(l => l.toLowerCase());
            const ptsIdx = labels.indexOf("pts");
            const minIdx = labels.findIndex(l => l === "min" || l === "minutes");
            if (ptsIdx < 0) continue;
            for (const ath of (sg.athletes || [])) {
              const s = ath.stats || [];
              const dnp = ath.didNotPlay || !s.length || s[0] === "DNP" || s[0] === "--";
              if (dnp) continue;
              const min = minIdx >= 0 ? parseFloat(s[minIdx]) || 0 : 999;
              if (min < 10) continue; // ignore garbage-time players
              const pts = parseFloat(s[ptsIdx]) || 0;
              const pos = ath.athlete?.position?.abbreviation || "";
              const positions = normalizePos(pos);
              // For combo positions, split credit evenly so totals aren't double-counted
              const weight = 1 / (positions.length || 1);
              for (const p of positions) {
                if (posStats[p]) {
                  posStats[p].pts += pts * weight;
                  posStats[p].n   += weight;
                }
              }
            }
          }
        }
      } catch {}
    }));

    const result = {};
    for (const [pos, d] of Object.entries(posStats)) {
      result[pos] = d.n > 0 ? parseFloat((d.pts / d.n).toFixed(1)) : null;
    }
    console.log(`[defvsposition] ${abbrev}: ${games.length} games analyzed`, result);
    res.json({ team: abbrev, defVsPosition: result, gamesAnalyzed: games.length });
  } catch (err) {
    console.error(`/defvsposition:`, err.message);
    res.json({ defVsPosition: {} });
  }
});

// ── /playerheadshot/:playerId: return ESPN headshot URL ───────────────────────
app.get("/playerheadshot/:playerId", async (req, res) => {
  const { playerId } = req.params;
  // ESPN headshots follow a predictable URL pattern
  res.json({
    url: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=96&h=70&cb=1`
  });
});

app.get("/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🏀 NBA Proxy running on port ${PORT}`);
});
