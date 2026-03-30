import { useState, useEffect, useCallback, useRef } from "react";

// ── Results tracker storage ───────────────────────────────────────────────────
const STORAGE_KEY = "courtiq_results_v2"; // v2: fixed ESPN stat parsing (labels not indices)
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } };
const saveHistory = (h) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); } catch {} };
const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const TEAM_COLORS = {
  LAL: { primary: "#552583", accent: "#FDB927" },
  IND: { primary: "#002D62", accent: "#FDBB30" },
  BOS: { primary: "#007A33", accent: "#BA9653" },
  CHA: { primary: "#1D1160", accent: "#00788C" },
  PHI: { primary: "#006BB6", accent: "#ED174C" },
  UTA: { primary: "#002B5C", accent: "#00471B" },
  MEM: { primary: "#5D76A9", accent: "#12173F" },
  POR: { primary: "#E03A3E", accent: "#000000" },
  MIL: { primary: "#00471B", accent: "#EEE1C6" },
  ATL: { primary: "#E03A3E", accent: "#C1D32F" },
  LAC: { primary: "#C8102E", accent: "#1D428A" },
  ORL: { primary: "#0077C0", accent: "#C4CED4" },
  DAL: { primary: "#00538C", accent: "#B8C4CA" },
  WAS: { primary: "#002B5C", accent: "#E31837" },
  MIA: { primary: "#98002E", accent: "#F9A01B" },
  BKN: { primary: "#000000", accent: "#FFFFFF" },
  HOU: { primary: "#CE1141", accent: "#000000" },
  GSW: { primary: "#1D428A", accent: "#FFC72C" },
  SAS: { primary: "#C4CED4", accent: "#000000" },
  DET: { primary: "#C8102E", accent: "#1D428A" },
  MIN: { primary: "#0C2340", accent: "#236192" },
  TOR: { primary: "#CE1141", accent: "#000000" },
  PHX: { primary: "#1D1160", accent: "#E56020" },
  CHI: { primary: "#CE1141", accent: "#000000" },
  SAC: { primary: "#5A2D81", accent: "#63727A" },
  NOP: { primary: "#0C2340", accent: "#C8102E" },
  DEN: { primary: "#0E2240", accent: "#FEC524" },
  NYK: { primary: "#006BB6", accent: "#F58426" },
  OKC: { primary: "#007AC1", accent: "#EF3B24" },
  CLE: { primary: "#860038", accent: "#FDBB30" },
};

const INJURY_COLORS = {
  "Out":          { bg: "#ef444418", text: "#ef4444", border: "#ef444433", label: "OUT" },
  "Doubtful":     { bg: "#f9731618", text: "#f97316", border: "#f9731633", label: "DOUBT" },
  "Questionable": { bg: "#eab30818", text: "#eab308", border: "#eab30833", label: "Q" },
  "Day-To-Day":   { bg: "#eab30818", text: "#eab308", border: "#eab30833", label: "DTD" },
  "Suspended":    { bg: "#a855f718", text: "#a855f7", border: "#a855f733", label: "SUSP" },
};

const UNAVAILABLE_STATUSES = ["Out", "Doubtful", "Questionable", "Day-To-Day", "Suspended"];

// Players currently serving suspensions (ESPN API doesn't expose this reliably).
// Add/remove as suspensions change. Format: "Full Name"
const SUSPENDED_PLAYERS = [
  "Paul George",       // PHI — 25-game suspension, returns ~Mar 25 2026
];

async function fetchRosterWithInjuries(teamAbbrev) {
  try {
    const res = await fetch(`${API}/roster/${teamAbbrev}`);
    const data = await res.json();
    const players = data.players || [];
    return players.map(p =>
      SUSPENDED_PLAYERS.includes(p.name) ? { ...p, status: "Suspended" } : p
    );
  } catch (err) {
    console.error(`Error fetching roster for ${teamAbbrev}:`, err.message);
    return [];
  }
}

async function fetchSchedule(teamAbbrev) {
  try { return await (await fetch(`${API}/schedule/${teamAbbrev}`)).json(); }
  catch { return null; }
}
async function fetchPlayerStats(teamAbbrev) {
  try { return (await (await fetch(`${API}/playerstats/${teamAbbrev}`)).json()).players || []; }
  catch { return []; }
}
async function fetchTeamStats(teamAbbrev) {
  try { return await (await fetch(`${API}/teamstats/${teamAbbrev}`)).json(); }
  catch { return null; }
}
async function fetchGameLogsBatch(teamAbbrev) {
  try {
    const data = await (await fetch(`${API}/gamelogs-batch/${teamAbbrev}`)).json();
    return data.players || [];
  }
  catch { return []; }
}

function parseGames(data) {
  const games = data?.games || data?.data?.games || [];
  const now = new Date();
  return {
    live: games.filter(g => g.status === "inprogress"),
    upcoming: games.filter(g => g.status === "scheduled" && new Date(g.start_time) > now),
    recent: games.filter(g => g.status === "closed").slice(-6),
  };
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function InjuryBadge({ status }) {
  const cfg = INJURY_COLORS[status];
  if (!cfg) return null;
  return (
    <span style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`, borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 800, letterSpacing: 0.5 }}>
      {cfg.label}
    </span>
  );
}

function ConfidenceBadge({ pct }) {
  const color = pct >= 75 ? "#22c55e" : pct >= 55 ? "#f59e0b" : "#94a3b8";
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>
      {pct.toFixed(0)}% CONF
    </span>
  );
}

function WinBar({ homeTeam, awayTeam, homeProb, awayProb }) {
  const hc = TEAM_COLORS[homeTeam]?.accent || "#60a5fa";
  const ac = TEAM_COLORS[awayTeam]?.accent || "#f472b6";
  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 4 }}>
        <span style={{ color: hc, fontWeight: 700 }}>{homeTeam} {homeProb?.toFixed(0)}%</span>
        <span style={{ color: ac, fontWeight: 700 }}>{awayTeam} {awayProb?.toFixed(0)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: "#1e293b", overflow: "hidden", display: "flex" }}>
        <div style={{ width: `${homeProb}%`, background: hc, transition: "width 0.8s ease" }} />
        <div style={{ width: `${awayProb}%`, background: ac, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

function InjuryReport({ players, teamAbbrev }) {
  const injured = players.filter(p => p.status && p.status !== "Active");
  const tc = TEAM_COLORS[teamAbbrev];
  if (injured.length === 0) return (
    <div style={{ color: "#22c55e", fontSize: 12, padding: "6px 0", display: "flex", alignItems: "center", gap: 6 }}>
      <span>✓</span> All clear — no injuries reported
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {injured.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 5, background: tc?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: tc?.accent || "#fff", flexShrink: 0 }}>
            {teamAbbrev}
          </div>
          <span style={{ color: "#94a3b8", fontSize: 12, flex: 1 }}>{p.name} <span style={{ color: "#475569" }}>({p.position})</span></span>
          <InjuryBadge status={p.status} />
        </div>
      ))}
    </div>
  );
}

function DepthRow({ player, tc, maxMinutes }) {
  const isStarter = player.role === "Starter";
  const minPct = (player.minutes / maxMinutes) * 100;

  return (
    <div style={{ background: "#0a111e", borderRadius: 8, padding: "9px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ minWidth: 28, height: 20, borderRadius: 4, background: isStarter ? (tc?.primary || "#1e293b") : "#0f172a", border: `1px solid ${isStarter ? (tc?.accent || "#334155") + "66" : "#1e293b"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: isStarter ? (tc?.accent || "#94a3b8") : "#475569" }}>
          {player.position}
        </div>
        <span style={{ color: isStarter ? "#f1f5f9" : "#94a3b8", fontWeight: isStarter ? 700 : 400, fontSize: 13, flex: 1 }}>
          {player.player}
        </span>
        <span style={{ color: isStarter ? "#f1f5f9" : "#64748b", fontWeight: 700, fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", minWidth: 28, textAlign: "right" }}>
          {player.minutes}
        </span>
        <span style={{ color: "#475569", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", minWidth: 32, textAlign: "right" }}>
          {player.usage}%
        </span>
      </div>
      <div style={{ height: 3, borderRadius: 99, background: "#0f172a", overflow: "hidden" }}>
        <div style={{ width: `${minPct}%`, height: "100%", background: isStarter ? (tc?.accent || "#3b82f6") : "#1e293b", borderRadius: 99, transition: "width 0.6s ease" }} />
      </div>
      {player.note && (
        <div style={{ color: "#334155", fontSize: 10, marginTop: 4 }}>{player.note}</div>
      )}
    </div>
  );
}

function GameCard({ game, onClick, selected }) {
  const isLive = game.status === "inprogress";
  const isClosed = game.status === "closed";
  const homeScore = game.score?.[game.home];
  const awayScore = game.score?.[game.away];
  const homeProb = game.win_probability?.[game.home];
  const awayProb = game.win_probability?.[game.away];
  return (
    <div onClick={() => onClick(game)} style={{ background: selected ? "#1e293b" : "#0f172a", border: selected ? "1.5px solid #3b82f6" : "1.5px solid #1e293b", borderRadius: 12, padding: "16px 18px", cursor: "pointer", transition: "all 0.2s", position: "relative", overflow: "hidden" }}>
      {isLive && (
        <div style={{ position: "absolute", top: 10, right: 12, display: "flex", alignItems: "center", gap: 5, color: "#ef4444", fontSize: 11, fontWeight: 700 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.2s infinite" }} />
          Q{game.quarter} {game.clock}
        </div>
      )}
      {isClosed && <div style={{ position: "absolute", top: 10, right: 12, color: "#475569", fontSize: 10, fontWeight: 600 }}>FINAL</div>}
      {!isLive && !isClosed && <div style={{ position: "absolute", top: 10, right: 12, color: "#64748b", fontSize: 10 }}>{formatTime(game.start_time)}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[game.away, game.home].map((team) => {
          const score = game.score?.[team];
          const isWinner = isClosed && ((team === game.home && homeScore > awayScore) || (team === game.away && awayScore > homeScore));
          return (
            <div key={team} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: TEAM_COLORS[team]?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: TEAM_COLORS[team]?.accent || "#fff", border: `1px solid ${TEAM_COLORS[team]?.accent || "#334155"}44` }}>
                {team}
              </div>
              <span style={{ color: isWinner ? "#f1f5f9" : "#94a3b8", fontWeight: isWinner ? 700 : 400, fontSize: 14, fontFamily: "'IBM Plex Mono', monospace", flex: 1 }}>
                {game.teams[team]?.name?.split(" ").slice(-1)[0]}
              </span>
              {score !== undefined && (
                <span style={{ color: isWinner ? "#f1f5f9" : "#64748b", fontWeight: isWinner ? 800 : 500, fontSize: 18, fontFamily: "'IBM Plex Mono', monospace", minWidth: 36, textAlign: "right" }}>
                  {score}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {homeProb && awayProb && <WinBar homeTeam={game.home} awayTeam={game.away} homeProb={homeProb} awayProb={awayProb} />}
    </div>
  );
}

// ── BetBuilderTab component ──────────────────────────────────────────────────
function BetBuilderTab({ prediction, game }) {
  const bb = prediction.betBuilder;
  const [boxScore, setBoxScore] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (game.status !== "closed" || !bb || boxScore) return;
    setChecking(true);
    fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${game.espnId || game.id}`)
      .then(r => r.json())
      .then(data => {
        // Use labels array for named stat lookup — never hardcode array positions
        const map = {};
        (data.boxscore?.players || []).forEach(team => {
          (team.statistics || []).forEach(sg => {
            const labels = (sg.labels || []).map(l => l.toLowerCase());
            const ptsIdx = labels.indexOf("pts");
            const rebIdx = labels.indexOf("reb");
            const astIdx = labels.indexOf("ast");
            (sg.athletes || []).forEach(a => {
              const name = a.athlete?.displayName || a.athlete?.fullName;
              if (!name || map[name.toLowerCase()]) return;
              const s = a.stats || [];
              const dnp = a.didNotPlay || !s.length || s[0] === "DNP" || s[0] === "--";
              map[name.toLowerCase()] = {
                dnp,
                points:   dnp || ptsIdx < 0 ? 0 : parseFloat(s[ptsIdx]) || 0,
                rebounds: dnp || rebIdx < 0 ? 0 : parseFloat(s[rebIdx]) || 0,
                assists:  dnp || astIdx < 0 ? 0 : parseFloat(s[astIdx]) || 0,
              };
            });
          });
        });
        setBoxScore(map);
        if (Object.keys(map).length > 0) {
          const history = loadHistory();
          if (history[game.id]) {
            history[game.id].results = map;
            history[game.id].status = "closed";
            saveHistory(history);
          }
        }
      })
      .catch(() => setBoxScore({}))
      .finally(() => setChecking(false));
  }, [game.status, game.id]);

  const findPlayer = (name) => {
    if (!boxScore) return null;
    const k = name.toLowerCase();
    if (boxScore[k]) return boxScore[k];
    const last = name.split(" ").slice(-1)[0].toLowerCase();
    const found = Object.keys(boxScore).find(key => key.includes(last));
    return found ? boxScore[found] : null;
  };

  const checkLeg = (leg) => {
    if (!boxScore || game.status !== "closed") return null;
    const ps = findPlayer(leg.player);
    if (!ps) return "dnp";
    if (ps.dnp) return "dnp";
    const actual = ps[leg.stat] ?? 0;
    return leg.direction === "over" ? (actual > leg.line ? "hit" : "miss") : (actual < leg.line ? "hit" : "miss");
  };

  const tierSummary = (legs) => {
    if (!boxScore || game.status !== "closed") return null;
    const res = (legs||[]).map(l => checkLeg(l)).filter(r => r && r !== "dnp");
    if (!res.length) return null;
    const hits = res.filter(r => r === "hit").length;
    return { hits, total: res.length, pct: Math.round(hits/res.length*100) };
  };

  if (!bb) return <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>🎰 No bet builder data — try regenerating.</div>;

  const TIERS = [
    { key: "lowRisk",    data: bb.lowRisk,    color: "#22c55e", icon: "🛡️", badge: "SAFE",     desc: "3 legs · 65% of avg (floored) · High probability" },
    { key: "mediumRisk", data: bb.mediumRisk, color: "#f59e0b", icon: "⚡", badge: "VALUE",    desc: "5 legs · Near season avg · Good risk/reward" },
    { key: "highRisk",   data: bb.highRisk,   color: "#ef4444", icon: "🚀", badge: "LONGSHOT", desc: "7-8 legs · Stretch targets · Big payout" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "#0a111e", borderRadius: 8, padding: "8px 12px", border: "1px solid #1e293b", fontSize: 11, color: "#475569" }}>
        {game.status === "closed"
          ? checking ? "⟳ Checking ESPN box score..." : boxScore && Object.keys(boxScore).length ? "✅ Results auto-checked from ESPN" : "⚠️ Box score unavailable"
          : "📋 Lines at 68/85/105% of season avg · Stat roles enforced · Usage boosts applied"}
      </div>
      {TIERS.map(({ key, data, color, icon, badge, desc }) => {
        if (!data) return null;
        const summary = tierSummary(data.legs||[]);
        const cc = summary ? (summary.pct>=60?"#22c55e":summary.pct>=40?"#f59e0b":"#ef4444") : (data.overallConfidence>=60?"#22c55e":data.overallConfidence>=42?"#f59e0b":"#ef4444");
        return (
          <div key={key} style={{ background: "#0a111e", borderRadius: 14, border: `1.5px solid ${color}44`, overflow: "hidden" }}>
            <div style={{ background: `linear-gradient(135deg,${color}18,${color}08)`, padding: "14px 16px", borderBottom: `1px solid ${color}22`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                  <span style={{ color, fontWeight: 800, fontSize: 14 }}>{data.label||badge}</span>
                  <span style={{ background: color+"25", color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 7px", fontSize: 9, fontWeight: 800 }}>{badge}</span>
                  {summary && <span style={{ background: cc+"22", color: cc, border: `1px solid ${cc}44`, borderRadius: 4, padding: "1px 7px", fontSize: 9, fontWeight: 800, marginLeft: 4 }}>{summary.hits}/{summary.total} HIT</span>}
                </div>
                <div style={{ color: "#475569", fontSize: 10 }}>{desc}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color, fontWeight: 900, fontSize: 22, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1 }}>{data.estimatedOdds}×</div>
                <div style={{ color: cc, fontSize: 10, fontWeight: 700, marginTop: 2 }}>{summary ? `${summary.pct}% actual` : `${data.overallConfidence}% predicted`}</div>
              </div>
            </div>
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              {(data.legs||[]).map((leg, li) => {
                const tc = TEAM_COLORS[leg.team];
                const isOver = leg.direction === "over";
                const dc = isOver ? "#22c55e" : "#3b82f6";
                const si = leg.stat==="points"?"🏀":leg.stat==="rebounds"?"💪":"🤝";
                const lc = (leg.confidence??60);
                const lcc = lc>=72?"#22c55e":lc>=58?"#f59e0b":"#ef4444";
                const tooLow = (leg.stat==="points"&&leg.line<8)||(leg.stat==="rebounds"&&leg.line<3)||(leg.stat==="assists"&&leg.line<2);
                const result = checkLeg(leg);
                const ps = findPlayer(leg.player);
                const actual = ps&&!ps.dnp ? ps[leg.stat] : null;
                const rbg = result==="hit"?"#22c55e10":result==="miss"?"#ef444410":result==="dnp"?"#47556910":"#0f172a";
                const rb  = result==="hit"?"1px solid #22c55e33":result==="miss"?"1px solid #ef444433":result==="dnp"?"1px solid #47556933":"none";
                return (
                  <div key={li} style={{ background: tooLow?"#ef444410":rbg, borderRadius: 9, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, border: tooLow?"1px solid #ef444433":rb }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: tc?.primary||"#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 800, color: tc?.accent||"#fff", flexShrink: 0 }}>{leg.team}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{leg.player}</div>
                      <div style={{ color: "#475569", fontSize: 10, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{leg.reason}</div>
                      {tooLow && <div style={{ color: "#ef4444", fontSize: 9, fontWeight: 700, marginTop: 2 }}>⚠️ May be too low for sportsbook</div>}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <div style={{ background: dc+"15", border: `1px solid ${dc}40`, borderRadius: 6, padding: "3px 8px", display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                        <span style={{ fontSize: 10 }}>{si}</span>
                        <span style={{ color: dc, fontWeight: 800, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" }}>{isOver?"O":"U"} {leg.line} {leg.stat==="points"?"PTS":leg.stat==="rebounds"?"REB":"AST"}</span>
                      </div>
                      {result==="hit"  && <div style={{ color: "#22c55e", fontSize: 10, fontWeight: 800 }}>✅ HIT {actual!=null?`(${actual})`:""}</div>}
                      {result==="miss" && <div style={{ color: "#ef4444", fontSize: 10, fontWeight: 800 }}>❌ MISS {actual!=null?`(${actual})`:""}</div>}
                      {result==="dnp"  && <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800 }}>⛔ DNP</div>}
                      {!result         && <div style={{ color: lcc, fontSize: 9, fontWeight: 700 }}>{lc}% conf</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            {data.tip && <div style={{ padding: "8px 14px 12px", borderTop: `1px solid ${color}15` }}><div style={{ color: "#475569", fontSize: 10, fontStyle: "italic" }}>💡 {data.tip}</div></div>}
          </div>
        );
      })}
      <div style={{ background: "#0a111e", borderRadius: 10, padding: "10px 14px", border: "1px solid #1e293b" }}>
        <div style={{ color: "#334155", fontSize: 10 }}>⚠️ <strong style={{ color: "#475569" }}>Disclaimer:</strong> Odds are AI estimates. Actual odds depend on your sportsbook. Bet responsibly.</div>
      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════════════════
// PROPS LAB — Full PropsMadness-style player prop researcher
// ═══════════════════════════════════════════════════════════════════════════════
const STAT_TYPES = [
  { key: "pts",       label: "Points",      short: "PTS" },
  { key: "ast",       label: "Assists",     short: "AST" },
  { key: "reb",       label: "Rebounds",    short: "REB" },
  { key: "fg3",       label: "Threes",      short: "3PM" },
  { key: "ptsAst",    label: "Pts+Ast",     short: "P+A" },
  { key: "ptsReb",    label: "Pts+Reb",     short: "P+R" },
  { key: "rebAst",    label: "Reb+Ast",     short: "R+A" },
  { key: "ptsRebAst", label: "Pts+Reb+Ast", short: "PRA" },
  { key: "q1pts",     label: "1Q Points",   short: "1QP" },
  { key: "q1reb",     label: "1Q Rebounds", short: "1QR" },
  { key: "q1ast",     label: "1Q Assists",  short: "1QA" },
];

// ── PropsLab: Full PropsMadness-style player prop researcher ──────────────────
function PropsLab({ onClose }) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [gamelog, setGamelog] = useState(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);

  // Stat + filter state
  const [statType, setStatType] = useState("pts");
  const [gameFilter, setGameFilter] = useState("L20"); // L5 L10 L20 All
  const [useMedian, setUseMedian] = useState(false);
  const [line, setLine] = useState("");

  // W/O filter (without) + W/ filter (with) — stored as {id, name, team}
  const [woPlayers, setWoPlayers] = useState([]);
  const [wPlayers,  setWPlayers]  = useState([]);
  const [woQuery, setWoQuery] = useState("");
  const [woResults, setWoResults] = useState([]);
  const [wQuery,  setWQuery]  = useState("");
  const [wResults,  setWResults]  = useState([]);

  // Splits toggle filters
  const [splitHome,     setSplitHome]     = useState(false);
  const [splitAway,     setSplitAway]     = useState(false);
  const [splitWins,     setSplitWins]     = useState(false);
  const [splitLosses,   setSplitLosses]   = useState(false);
  const [splitB2B,      setSplitB2B]      = useState(false);
  const [splitRegular,  setSplitRegular]  = useState(false);
  const [splitPlayoffs, setSplitPlayoffs] = useState(false);

  // Advanced filters
  const [splitH2H,      setSplitH2H]      = useState(false);  // vs today's opponent only
  const [splitVsTeam,   setSplitVsTeam]   = useState("");     // vs specific team abbreviation
  const [splitMargin,   setSplitMargin]   = useState("");     // "close" | "large"
  const [splitMinutes,  setSplitMinutes]  = useState("");     // "30+" | "35+" | "38+"

  // Right sidebar active tab
  const [rightTab, setRightTab] = useState("splits");

  // Bar chart hover (must live here at component top — never inside JSX)
  const [hoveredBar, setHoveredBar] = useState(null);

  // Extra data
  const [defVsPos, setDefVsPos] = useState(null);
  const [oppTeam, setOppTeam] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [loadingVerdict, setLoadingVerdict] = useState(false);

  const parsedLine = line ? parseFloat(line) : null;

  // ── Search ────────────────────────────────────────────────────────────────
  const searchPlayer = async (q) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const data = await fetch(`${API}/playersearch/${encodeURIComponent(q)}`).then(r => r.json());
      setSearchResults(data.players || []);
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const selectPlayer = async (player) => {
    setSelected(player);
    setSearchResults([]);
    setQuery(player.name);
    setGamelog(null);
    setVerdict(null);
    setWoPlayers([]);
    setLoading(true);
    try {
      const data = await fetch(`${API}/gamelog/${player.id}`).then(r => r.json());
      setGamelog(data);
      // Find next opponent from today's games
      const games = await fetch(`${API}/games`).then(r => r.json());
      const todayGame = (games.games || []).find(g =>
        g.home === player.team || g.away === player.team
      );
      if (todayGame) {
        const opp = todayGame.home === player.team ? todayGame.away : todayGame.home;
        setOppTeam(opp);
        // Fetch def vs position for opponent
        const dvp = await fetch(`${API}/defvsposition/${opp}`).then(r => r.json());
        setDefVsPos(dvp.defVsPosition || null);
      }
    } catch {}
    setLoading(false);
  };

  // W/O teammate search (without)
  const searchWo = async (q) => {
    if (q.length < 2) { setWoResults([]); return; }
    try {
      const data = await fetch(`${API}/playersearch/${encodeURIComponent(q)}`).then(r => r.json());
      setWoResults((data.players || []).filter(p => p.team === selected?.team && p.id !== selected?.id));
    } catch {}
  };

  // W/ teammate search (with)
  const searchW = async (q) => {
    if (q.length < 2) { setWResults([]); return; }
    try {
      const data = await fetch(`${API}/playersearch/${encodeURIComponent(q)}`).then(r => r.json());
      setWResults((data.players || []).filter(p => p.team === selected?.team && p.id !== selected?.id));
    } catch {}
  };

  // ── Stat calculation ──────────────────────────────────────────────────────
  const getStatValue = (game, type) => {
    switch(type) {
      case "pts": return game.pts || 0;
      case "ast": return game.ast || 0;
      case "reb": return game.reb || 0;
      case "3pm": return game.threes || 0;
      case "pts+ast": return (game.pts || 0) + (game.ast || 0);
      case "pts+reb": return (game.pts || 0) + (game.reb || 0);
      case "reb+ast": return (game.reb || 0) + (game.ast || 0);
      case "pts+reb+ast": return (game.pts || 0) + (game.reb || 0) + (game.ast || 0);
      case "dd": return ((game.pts >= 10 ? 1 : 0) + (game.reb >= 10 ? 1 : 0) + (game.ast >= 10 ? 1 : 0)) >= 2 ? 1 : 0;
      case "td": return ((game.pts >= 10 ? 1 : 0) + (game.reb >= 10 ? 1 : 0) + (game.ast >= 10 ? 1 : 0)) >= 3 ? 1 : 0;
      case "q1pts": return game.q1pts || 0;
      case "q1ast": return game.q1ast || 0;
      case "q1reb": return game.q1reb || 0;
      default: return 0;
    }
  };

  const isBinary = statType === "dd" || statType === "td";

  // Base pool — exclude DNP and garbage-time games
  const allGames = (gamelog?.games || []).filter(g => !g.dnp && g.min >= 8);

  // Normalize teammate arrays — backend may send strings (old) or {id,name} objects (new)
  const normArr = (arr) => (arr || []).map(t =>
    typeof t === "string" ? { id: null, name: t } : t
  );

  // Match a selected player against a normalized teammate array using id OR last-name
  const tmMatch = (player, rawArr) => {
    const arr = normArr(rawArr);
    const lastName = player.name.split(" ").slice(-1)[0].toLowerCase();
    return arr.some(t =>
      (t.id && t.id === String(player.id)) ||
      (t.name && t.name.toLowerCase().includes(lastName))
    );
  };

  // W/O — keep games where teammate is NOT in teammatesIn (didn't play 8+ min)
  // W/  — keep games where teammate IS in teammatesIn (played 8+ min)
  // Only filter games that have teammate data (new backend); pass through old games without it
  let filteredGames = allGames;
  if (woPlayers.length > 0)
    filteredGames = filteredGames.filter(g =>
      !g.teammatesIn ||  // no data = pass through (don't drop the game)
      woPlayers.every(wo => !tmMatch(wo, g.teammatesIn))
    );
  if (wPlayers.length > 0)
    filteredGames = filteredGames.filter(g =>
      g.teammatesIn &&
      wPlayers.every(w => tmMatch(w, g.teammatesIn))
    );

  // Splits filters
  if (splitHome)     filteredGames = filteredGames.filter(g => g.homeAway === "home");
  if (splitAway)     filteredGames = filteredGames.filter(g => g.homeAway !== "home");
  if (splitWins)     filteredGames = filteredGames.filter(g => g.result === "W");
  if (splitLosses)   filteredGames = filteredGames.filter(g => g.result === "L");
  if (splitB2B)      filteredGames = filteredGames.filter(g => g.isB2B);
  if (splitRegular)  filteredGames = filteredGames.filter(g => !g.isPlayoff);
  if (splitPlayoffs) filteredGames = filteredGames.filter(g => g.isPlayoff);

  // Advanced filters
  if (splitH2H && oppTeam)
    filteredGames = filteredGames.filter(g => g.opponent === oppTeam);
  if (splitVsTeam)
    filteredGames = filteredGames.filter(g => g.opponent === splitVsTeam);
  if (splitMargin === "close")
    filteredGames = filteredGames.filter(g => g.margin != null ? Math.abs(g.margin) <= 8 : true);
  if (splitMargin === "large")
    filteredGames = filteredGames.filter(g => g.margin != null ? Math.abs(g.margin) > 15 : true);
  if (splitMinutes)
    filteredGames = filteredGames.filter(g => g.min >= parseInt(splitMinutes));

  // Apply game count filter
  const filterCount = gameFilter === "L5" ? 5 : gameFilter === "L10" ? 10 : gameFilter === "L20" ? 20 : 999;
  const displayGames = filteredGames.slice(0, filterCount);
  const values = displayGames.map(g => getStatValue(g, statType));

  const mean = values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
  const sorted = [...values].sort((a,b)=>a-b);
  const median = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
  const avg = useMedian ? median : mean;

  const hits = parsedLine != null ? values.filter(v => isBinary ? v === 1 : v > parsedLine) : [];
  const hitRate = values.length > 0 && parsedLine != null ? Math.round(hits.length / values.length * 100) : null;
  const maxVal = Math.max(...values, parsedLine || 0, 1);

  // L5/L10 hit rates for summary
  const calcHitRate = (n) => {
    const v = filteredGames.slice(0, n).map(g => getStatValue(g, statType));
    if (!v.length || parsedLine == null) return null;
    return Math.round(v.filter(x => isBinary ? x === 1 : x > parsedLine).length / v.length * 100);
  };

  const statLabels = {
    pts:"Points", ast:"Assists", reb:"Rebounds", "3pm":"Threes",
    "pts+ast":"Pts+Ast", "pts+reb":"Pts+Reb", "reb+ast":"Reb+Ast",
    "pts+reb+ast":"Pts+Reb+Ast", dd:"Double Double", td:"Triple Double",
    q1pts:"1Q Points", q1ast:"1Q Assists", q1reb:"1Q Rebounds"
  };

  const statGroups = [
    { label: "Core", stats: ["pts","ast","reb","3pm"] },
    { label: "Combos", stats: ["pts+ast","pts+reb","reb+ast","pts+reb+ast"] },
    { label: "Milestones", stats: ["dd","td"] },
    { label: "1st Quarter", stats: ["q1pts","q1ast","q1reb"] },
  ];

  const hitColor = hitRate == null ? "#475569" : hitRate >= 70 ? "#22c55e" : hitRate >= 55 ? "#f59e0b" : "#ef4444";

  // Position for def vs position lookup
  const posMap = { PG:"PG", SG:"SG", G:"PG", SF:"SF", PF:"PF", F:"SF", C:"C", "C-F":"PF" };
  const playerPos = posMap[selected?.position] || selected?.position;
  const dvpVal = defVsPos ? defVsPos[playerPos] : null;

  const getVerdict = async () => {
    if (!selected || parsedLine == null || !gamelog) return;
    setLoadingVerdict(true);
    setVerdict(null);
    const recentStr = displayGames.slice(0,10).map(g => `${g.opponent}: ${getStatValue(g,statType)}`).join(", ");
    const prompt = `Player: ${selected.name} (${selected.position}, ${selected.team})
Prop: ${statLabels[statType]} ${line ? `O/U ${parsedLine}` : ""}
Season avg: ${avg.toFixed(1)} | Hit rate: ${hitRate}% in last ${values.length} games
Recent: ${recentStr}
${dvpVal ? `Opponent (${oppTeam}) allows ${dvpVal} pts/game to ${playerPos}s` : ""}
Respond ONLY with JSON: {"lean":"OVER|UNDER|AVOID","confidence":50-90,"reason":"2 sentences","keyFactor":"string"}`;

    let text = null;
    const GEMINI = import.meta.env.VITE_GEMINI_API_KEY;
    const GROQ = import.meta.env.VITE_GROQ_API_KEY;
    if (GEMINI) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI}`,
          { method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{maxOutputTokens:200,temperature:0.2} }) });
        const d = await r.json();
        text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      } catch {}
    }
    if (!text && GROQ) {
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions",
          { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${GROQ}`},
            body: JSON.stringify({ model:"llama-3.1-8b-instant", max_tokens:200, messages:[{role:"user",content:prompt}] }) });
        if (r.ok) { const d = await r.json(); text = d.choices?.[0]?.message?.content; }
      } catch {}
    }
    if (text) {
      try { setVerdict(JSON.parse(text.replace(/```json|```/g,"").trim())); }
      catch { setVerdict({lean:"AVOID",confidence:50,reason:"Could not parse response.",keyFactor:"—"}); }
    } else {
      setVerdict({lean:"AVOID",confidence:50,reason:"AI unavailable. Check hit rates manually.",keyFactor:"Rate limited"});
    }
    setLoadingVerdict(false);
  };

  const tc = TEAM_COLORS[selected?.team];
  const verdictColor = verdict?.lean==="OVER"?"#22c55e":verdict?.lean==="UNDER"?"#3b82f6":"#f59e0b";

  return (
    <div style={{position:"fixed",inset:0,background:"#020817",zIndex:200,display:"flex",flexDirection:"column",fontFamily:"'IBM Plex Sans',sans-serif"}}>
      <style>{`
        .pl-scroll::-webkit-scrollbar{width:4px;height:4px}
        .pl-scroll::-webkit-scrollbar-track{background:#0a111e}
        .pl-scroll::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        .pl-tab{padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.15s}
        .pl-tab:hover{background:#1e293b!important}
        .pl-statbtn{padding:5px 10px;border-radius:5px;border:none;cursor:pointer;font-size:11px;font-weight:600;transition:all 0.15s}
        .pl-statbtn:hover{opacity:0.85}
      `}</style>

      {/* ── Header ── */}
      <div style={{padding:"12px 20px",borderBottom:"1px solid #0f172a",display:"flex",alignItems:"center",gap:12,background:"#020817",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:30,height:30,borderRadius:8,background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🔬</div>
          <div>
            <div style={{fontWeight:800,fontSize:15,fontFamily:"'IBM Plex Mono',monospace"}}>PROPS <span style={{color:"#8b5cf6"}}>LAB</span></div>
            <div style={{color:"#334155",fontSize:9,fontWeight:600,letterSpacing:1}}>PLAYER PROP RESEARCHER</div>
          </div>
        </div>

        {/* Search */}
        <div style={{position:"relative",flex:1,maxWidth:340}}>
          <input value={query} onChange={e=>{setQuery(e.target.value);searchPlayer(e.target.value);}}
            placeholder="Search player... (e.g. Harden, SGA, Tatum)"
            style={{width:"100%",background:"#0a111e",border:"1px solid #1e293b",borderRadius:8,padding:"8px 14px",color:"#f1f5f9",fontSize:13,outline:"none"}}/>
          {searching && <div style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",color:"#475569",fontSize:11}}>...</div>}
          {searchResults.length > 0 && (
            <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#0a111e",border:"1px solid #1e293b",borderRadius:8,marginTop:4,zIndex:50,overflow:"hidden",boxShadow:"0 8px 24px #000a"}}>
              {searchResults.map(p => (
                <div key={p.id} onClick={()=>selectPlayer(p)} style={{padding:"9px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid #0f172a"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#0f172a"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <img src={`https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${p.id}.png&w=40&h=30`} alt="" style={{width:32,height:32,borderRadius:6,objectFit:"cover",background:"#1e293b"}} onError={e=>e.target.style.display="none"}/>
                  <div style={{width:24,height:24,borderRadius:5,background:TEAM_COLORS[p.team]?.primary||"#1e293b",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:800,color:TEAM_COLORS[p.team]?.accent||"#fff",flexShrink:0}}>{p.team}</div>
                  <div>
                    <div style={{color:"#f1f5f9",fontWeight:700,fontSize:13}}>{p.name}</div>
                    <div style={{color:"#475569",fontSize:10}}>{p.position} · {p.team}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Game filter tabs */}
        {selected && (
          <div style={{display:"flex",gap:4,background:"#0a111e",borderRadius:8,padding:3,border:"1px solid #1e293b"}}>
            {["L5","L10","L20","All"].map(f => (
              <button key={f} className="pl-tab" onClick={()=>setGameFilter(f)}
                style={{background:gameFilter===f?"#1e293b":"transparent",color:gameFilter===f?"#f1f5f9":"#475569"}}>
                {f}
              </button>
            ))}
          </div>
        )}

        {/* Median toggle */}
        {selected && (
          <button onClick={()=>setUseMedian(!useMedian)} className="pl-tab"
            style={{background:useMedian?"#8b5cf622":"transparent",border:"1px solid "+(useMedian?"#8b5cf6":"#1e293b"),color:useMedian?"#8b5cf6":"#475569"}}>
            {useMedian?"Median":"Average"}
          </button>
        )}

        <button onClick={onClose} style={{marginLeft:"auto",background:"transparent",border:"1px solid #1e293b",color:"#475569",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12}}>✕ Close</button>
      </div>

      {/* ── Main layout ── */}
      {!selected && !loading && (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"#334155"}}>
          <div style={{fontSize:48}}>🔬</div>
          <div style={{fontSize:16,fontWeight:600,color:"#475569"}}>Search a player to get started</div>
          <div style={{fontSize:12}}>Prop research · Hit rates · Def vs Position · W/O filter</div>
        </div>
      )}

      {loading && (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:"#8b5cf6"}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#8b5cf6",animation:"bounce 0.8s 0s infinite"}}/>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#8b5cf6",animation:"bounce 0.8s 0.15s infinite"}}/>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#8b5cf6",animation:"bounce 0.8s 0.3s infinite"}}/>
          <span style={{marginLeft:8,fontSize:13}}>Loading player data...</span>
        </div>
      )}

      {selected && gamelog && (
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>

          {/* ── Left sidebar: stat type selector ── */}
          <div style={{width:160,borderRight:"1px solid #0f172a",padding:"12px 8px",overflowY:"auto"}} className="pl-scroll">
            {statGroups.map(group => (
              <div key={group.label} style={{marginBottom:12}}>
                <div style={{color:"#334155",fontSize:9,fontWeight:700,letterSpacing:1,padding:"0 6px",marginBottom:5}}>{group.label.toUpperCase()}</div>
                {group.stats.map(s => (
                  <button key={s} className="pl-statbtn" onClick={()=>{setStatType(s);setVerdict(null);}}
                    style={{width:"100%",textAlign:"left",marginBottom:2,background:statType===s?"#8b5cf622":"transparent",color:statType===s?"#8b5cf6":"#94a3b8",border:statType===s?"1px solid #8b5cf644":"1px solid transparent"}}>
                    {statLabels[s]}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* ── Center: chart + game log ── */}
          <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}} className="pl-scroll">

            {/* Player header */}
            <div style={{display:"flex",alignItems:"center",gap:16,background:"#0a111e",borderRadius:12,padding:16,border:"1px solid #1e293b"}}>
              <img src={`https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${selected.id}.png&w=96&h=70`} alt={selected.name}
                style={{width:60,height:60,borderRadius:10,objectFit:"cover",background:"#1e293b",border:`2px solid ${tc?.primary||"#1e293b"}`}}
                onError={e=>{e.target.style.display="none"}}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:20,color:"#f1f5f9"}}>{selected.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
                  <div style={{width:22,height:22,borderRadius:5,background:tc?.primary||"#1e293b",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:800,color:tc?.accent||"#fff"}}>{selected.team}</div>
                  <span style={{color:"#475569",fontSize:12}}>{selected.position}</span>
                  {oppTeam && <span style={{color:"#334155",fontSize:11}}>vs <span style={{color:"#64748b"}}>{oppTeam}</span> today</span>}
                </div>
              </div>
              {/* Key stats */}
              <div style={{display:"flex",gap:16}}>
                {[
                  {label:"PTS",val:gamelog.seasonAvg?.pts},
                  {label:"REB",val:gamelog.seasonAvg?.reb},
                  {label:"AST",val:gamelog.seasonAvg?.ast},
                ].map(({label,val}) => (
                  <div key={label} style={{textAlign:"center"}}>
                    <div style={{color:"#f1f5f9",fontWeight:800,fontSize:18,fontFamily:"'IBM Plex Mono',monospace"}}>{val||"—"}</div>
                    <div style={{color:"#475569",fontSize:10,fontWeight:700}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stat type header + line input + hit rate */}
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:8,padding:"6px 12px",color:"#8b5cf6",fontWeight:700,fontSize:13}}>
                {statLabels[statType]}
              </div>
              <input type="number" step="0.5" placeholder="Line (e.g. 21.5)" value={line}
                onChange={e=>{setLine(e.target.value);setVerdict(null);}}
                style={{background:"#0a111e",border:"1px solid #1e293b",borderRadius:8,padding:"7px 12px",color:"#f1f5f9",fontSize:14,fontWeight:800,width:130,fontFamily:"'IBM Plex Mono',monospace",outline:"none"}}/>
              {hitRate != null && (
                <div style={{background:hitColor+"18",border:`1px solid ${hitColor}44`,borderRadius:8,padding:"6px 14px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                  <div style={{color:hitColor,fontWeight:900,fontSize:20,fontFamily:"'IBM Plex Mono',monospace",lineHeight:1}}>{hitRate}%</div>
                  <div style={{color:"#475569",fontSize:9}}>HIT RATE ({hits.length}/{values.length})</div>
                </div>
              )}
              {/* L5/L10 pills */}
              {parsedLine != null && [5,10].map(n => {
                const r = calcHitRate(n);
                if (r == null) return null;
                const cl = r>=70?"#22c55e":r>=55?"#f59e0b":"#ef4444";
                return <div key={n} style={{background:cl+"15",border:`1px solid ${cl}33`,borderRadius:6,padding:"4px 10px",textAlign:"center"}}>
                  <div style={{color:cl,fontWeight:800,fontSize:13,fontFamily:"'IBM Plex Mono',monospace"}}>{r}%</div>
                  <div style={{color:"#475569",fontSize:9}}>L{n}</div>
                </div>;
              })}
              <div style={{marginLeft:"auto",color:"#475569",fontSize:12}}>
                Showing <span style={{color:"#f1f5f9",fontWeight:700}}>{displayGames.length}</span> games
                {useMedian ? " · Median" : " · Average"}: <span style={{color:"#f1f5f9",fontWeight:700}}>{avg.toFixed(1)}</span>
              </div>
            </div>

            {/* Bar chart */}
            {(
                <div style={{background:"#0a111e",borderRadius:12,padding:"16px 16px 10px",border:"1px solid #1e293b",position:"relative"}}>
                  <div style={{display:"flex",alignItems:"flex-end",gap:3,height:150,position:"relative"}}>
                    {/* Line marker */}
                    {parsedLine != null && (
                      <div style={{position:"absolute",left:0,right:0,bottom:`${Math.min((parsedLine/maxVal)*100,98)}%`,borderTop:"2px dashed #f59e0b",zIndex:5,pointerEvents:"none"}}>
                        <span style={{position:"absolute",left:0,top:-16,background:"#f59e0b",color:"#000",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:3}}>{parsedLine}</span>
                      </div>
                    )}
                    {/* Avg line */}
                    <div style={{position:"absolute",left:0,right:0,bottom:`${Math.min((avg/maxVal)*100,98)}%`,borderTop:"1px dashed #334155",zIndex:4,pointerEvents:"none"}}>
                      <span style={{position:"absolute",right:0,top:-13,color:"#475569",fontSize:8}}>avg {avg.toFixed(1)}</span>
                    </div>

                    {/* Bars — green=W, red=L, with value inside */}
                    {displayGames.map((g, i) => {
                      const val = getStatValue(g, statType);
                      const heightPct = maxVal > 0 ? Math.max((val/maxVal)*100, 8) : 8;
                      const isWin = g.result === "W";
                      // Bar color = win/loss result
                      const barColor = isWin ? "#22c55e" : "#ef4444";
                      // Hit/miss shown as top border indicator
                      const isHit = parsedLine != null && (isBinary ? val===1 : val > parsedLine);
                      const hitBorder = parsedLine != null ? (isHit ? "2px solid #22c55e" : "2px solid #ef4444") : "none";
                      const isHovered = hoveredBar === i;

                      return (
                        <div key={i}
                          style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%",position:"relative",cursor:"pointer"}}
                          onMouseEnter={()=>setHoveredBar(i)}
                          onMouseLeave={()=>setHoveredBar(null)}>

                          {/* Hover tooltip */}
                          {isHovered && (
                            <div style={{position:"absolute",bottom:"100%",left:"50%",transform:"translateX(-50%)",zIndex:20,background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"8px 12px",whiteSpace:"nowrap",pointerEvents:"none",boxShadow:"0 4px 16px #000a",marginBottom:6}}>
                              <div style={{color:"#f1f5f9",fontWeight:700,fontSize:12,marginBottom:4}}>vs {g.opponent} · {g.homeAway==="home"?"H":"A"}</div>
                              <div style={{display:"flex",gap:10,marginBottom:3}}>
                                <span style={{color:isWin?"#22c55e":"#ef4444",fontWeight:800,fontSize:11}}>{g.result}</span>
                                <span style={{color:"#64748b",fontSize:10}}>{g.date ? new Date(g.date).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : ""}</span>
                              </div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 12px",fontSize:11}}>
                                <span style={{color:"#475569"}}>PTS</span><span style={{color:"#f1f5f9",fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{g.pts}</span>
                                <span style={{color:"#475569"}}>REB</span><span style={{color:"#f1f5f9",fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{g.reb}</span>
                                <span style={{color:"#475569"}}>AST</span><span style={{color:"#f1f5f9",fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{g.ast}</span>
                                <span style={{color:"#475569"}}>MIN</span><span style={{color:"#f1f5f9",fontFamily:"'IBM Plex Mono',monospace"}}>{Math.round(g.min)}</span>
                              </div>
                              {parsedLine != null && (
                                <div style={{marginTop:6,padding:"3px 8px",borderRadius:4,background:isHit?"#22c55e22":"#ef444422",color:isHit?"#22c55e":"#ef4444",fontWeight:800,fontSize:11,textAlign:"center"}}>
                                  {isHit ? `✅ OVER ${parsedLine}` : `❌ UNDER ${parsedLine}`}
                                </div>
                              )}
                            </div>
                          )}

                          {/* The bar */}
                          <div style={{
                            width:"100%",
                            background: isHovered ? barColor : barColor+"aa",
                            borderRadius:"3px 3px 0 0",
                            height:`${heightPct}%`,
                            borderTop: parsedLine != null ? (isHit ? "3px solid #22c55eff" : "3px solid #ef4444ff") : "none",
                            transition:"background 0.1s",
                            position:"relative",
                            display:"flex",
                            alignItems:"center",
                            justifyContent:"center",
                            overflow:"hidden",
                          }}>
                            {/* Score inside bar */}
                            <span style={{
                              color:"#fff",
                              fontWeight:800,
                              fontSize: heightPct > 20 ? 10 : 8,
                              fontFamily:"'IBM Plex Mono',monospace",
                              textShadow:"0 1px 2px #000a",
                              userSelect:"none",
                            }}>{val}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* X axis: opponent + date */}
                  <div style={{display:"flex",gap:3,marginTop:5}}>
                    {displayGames.map((g,i) => (
                      <div key={i} style={{flex:1,textAlign:"center",color:"#334155",fontSize:6,overflow:"hidden",whiteSpace:"nowrap"}}>
                        {g.opponent?.slice(0,3)||"?"}
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div style={{display:"flex",gap:12,marginTop:8,fontSize:10,flexWrap:"wrap"}}>
                    <span style={{color:"#22c55e"}}>🟩 Win</span>
                    <span style={{color:"#ef4444"}}>🟥 Loss</span>
                    {parsedLine != null && <>
                      <span style={{color:"#475569",marginLeft:4}}>Border: <span style={{color:"#22c55e"}}>over</span> / <span style={{color:"#ef4444"}}>under</span></span>
                      <span style={{color:"#475569",marginLeft:"auto"}}>{hits.length}/{values.length} over {parsedLine} ({hitRate}%)</span>
                    </>}
                    {parsedLine == null && <span style={{color:"#f59e0b",marginLeft:"auto"}}>--- Line ({parsedLine || "not set"})</span>}
                  </div>
                </div>
            )}

            {/* AI Verdict */}
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <button onClick={getVerdict} disabled={!parsedLine||loadingVerdict}
                style={{background:"#6d28d9",border:"none",color:"#fff",borderRadius:8,padding:"8px 18px",fontSize:12,fontWeight:700,cursor:parsedLine?"pointer":"not-allowed",opacity:parsedLine?1:0.5}}>
                {loadingVerdict?"Analyzing...":"🤖 AI Verdict"}
              </button>
              {verdict && (
                <div style={{flex:1,background:verdictColor+"12",borderRadius:10,padding:"10px 14px",border:`1px solid ${verdictColor}33`,display:"flex",alignItems:"center",gap:12}}>
                  <div style={{background:verdictColor+"22",color:verdictColor,border:`1px solid ${verdictColor}44`,borderRadius:6,padding:"4px 12px",fontWeight:800,fontSize:14,flexShrink:0}}>{verdict.lean}</div>
                  <div style={{flex:1}}>
                    <div style={{color:"#94a3b8",fontSize:12,lineHeight:1.5}}>{verdict.reason}</div>
                    <div style={{color:"#475569",fontSize:10,marginTop:3}}>Key: {verdict.keyFactor}</div>
                  </div>
                  <div style={{color:verdictColor,fontWeight:800,fontSize:16,fontFamily:"'IBM Plex Mono',monospace",flexShrink:0}}>{verdict.confidence}%</div>
                </div>
              )}
            </div>

            {/* Game log table */}
            <div style={{background:"#0a111e",borderRadius:12,border:"1px solid #1e293b",overflow:"hidden"}}>
              <div style={{padding:"10px 16px",borderBottom:"1px solid #0f172a",display:"flex",alignItems:"center",gap:10}}>
                <span style={{color:"#64748b",fontSize:10,fontWeight:700,letterSpacing:1}}>GAME LOG</span>
                <span style={{color:"#334155",fontSize:10,marginLeft:"auto"}}>PTS · REB · AST · MIN</span>
              </div>
              {displayGames.slice(0,20).map((g,i) => {
                const val = getStatValue(g, statType);
                const isHit = parsedLine != null && (isBinary ? val===1 : val > parsedLine);
                return (
                  <div key={i} style={{padding:"8px 16px",borderBottom:"1px solid #0f172a",display:"flex",alignItems:"center",gap:10,background:parsedLine!=null?(isHit?"#22c55e08":"#ef444408"):"transparent"}}>
                    <div style={{width:20,textAlign:"center"}}>
                      {parsedLine != null && (isHit ? <span style={{color:"#22c55e",fontSize:11}}>✅</span> : <span style={{color:"#ef4444",fontSize:11}}>❌</span>)}
                    </div>
                    <div style={{flex:1}}>
                      <span style={{color:"#94a3b8",fontSize:12,fontWeight:600}}>vs {g.opponent}</span>
                      <span style={{color:"#334155",fontSize:10,marginLeft:6}}>{g.homeAway==="home"?"H":"A"} · {g.result}</span>
                    </div>
                    <div style={{display:"flex",gap:10,fontFamily:"'IBM Plex Mono',monospace",fontSize:12}}>
                      <span style={{color:statType==="pts"||statType.includes("pts")?"#f1f5f9":"#475569",fontWeight:statType==="pts"?800:400}}>{g.pts}</span>
                      <span style={{color:statType==="reb"||statType.includes("reb")?"#f1f5f9":"#475569",fontWeight:statType==="reb"?800:400}}>{g.reb}</span>
                      <span style={{color:statType==="ast"||statType.includes("ast")?"#f1f5f9":"#475569",fontWeight:statType==="ast"?800:400}}>{g.ast}</span>
                      <span style={{color:"#1e293b"}}>{Math.round(g.min)}m</span>
                    </div>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:800,color:parsedLine!=null?(isHit?"#22c55e":"#ef4444"):"#8b5cf6",minWidth:32,textAlign:"right"}}>{val}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Right sidebar ── */}
          <div style={{width:230,borderLeft:"1px solid #0f172a",padding:"12px 10px",overflowY:"auto",display:"flex",flexDirection:"column",gap:12}} className="pl-scroll">

            {/* Tab bar */}
            <div style={{display:"flex",gap:2,background:"#0a111e",borderRadius:8,padding:3,border:"1px solid #1e293b",flexShrink:0}}>
              {[{id:"splits",label:"Splits"},{id:"oppRank",label:"Opp Rankings"},{id:"stats",label:"Stats"}].map(t=>(
                <button key={t.id} onClick={()=>setRightTab(t.id)}
                  style={{flex:1,padding:"5px 4px",background:rightTab===t.id?"#1e293b":"transparent",border:"none",borderRadius:6,color:rightTab===t.id?"#f1f5f9":"#475569",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── SPLITS TAB ── */}
            {rightTab==="splits" && (<>

              {/* Active filter summary badge */}
              {(woPlayers.length>0||wPlayers.length>0||splitHome||splitAway||splitWins||splitLosses||splitB2B||splitRegular||splitPlayoffs||splitH2H||splitVsTeam||splitMargin||splitMinutes) && (
                <div style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:8,padding:"6px 10px",fontSize:10,color:"#8b5cf6",fontWeight:700}}>
                  Showing {displayGames.length} filtered games
                  <button onClick={()=>{setWoPlayers([]);setWPlayers([]);setSplitHome(false);setSplitAway(false);setSplitWins(false);setSplitLosses(false);setSplitB2B(false);setSplitRegular(false);setSplitPlayoffs(false);setSplitH2H(false);setSplitVsTeam("");setSplitMargin("");setSplitMinutes("");}}
                    style={{float:"right",background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:11,padding:0}}>✕ Clear all</button>
                </div>
              )}

              {/* ── Basic splits ── */}
              <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:10}}>SPLITS</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {[
                    {label:"Home",    active:splitHome,     toggle:()=>{setSplitHome(h=>!h);setSplitAway(false);}},
                    {label:"Away",    active:splitAway,     toggle:()=>{setSplitAway(a=>!a);setSplitHome(false);}},
                    {label:"Wins",    active:splitWins,     toggle:()=>{setSplitWins(w=>!w);setSplitLosses(false);}},
                    {label:"Losses",  active:splitLosses,   toggle:()=>{setSplitLosses(l=>!l);setSplitWins(false);}},
                    {label:"B2B",     active:splitB2B,      toggle:()=>setSplitB2B(b=>!b)},
                    {label:"Regular", active:splitRegular,  toggle:()=>{setSplitRegular(r=>!r);setSplitPlayoffs(false);}},
                    {label:"Playoffs",active:splitPlayoffs, toggle:()=>{setSplitPlayoffs(p=>!p);setSplitRegular(false);}},
                  ].map(({label,active,toggle})=>(
                    <button key={label} onClick={toggle}
                      style={{padding:"4px 10px",borderRadius:20,border:`1px solid ${active?"#8b5cf6":"#1e293b"}`,background:active?"#8b5cf622":"transparent",color:active?"#8b5cf6":"#475569",fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── H2H + Vs Team ── */}
              <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:10}}>OPPONENT</div>
                {/* H2H — vs today's opponent */}
                {oppTeam && (
                  <button onClick={()=>setSplitH2H(h=>!h)}
                    style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${splitH2H?"#3b82f6":"#1e293b"}`,background:splitH2H?"#3b82f622":"transparent",color:splitH2H?"#3b82f6":"#475569",fontSize:11,fontWeight:700,cursor:"pointer",textAlign:"left",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span>H2H vs {oppTeam}</span>
                    {splitH2H && <span style={{fontSize:9,color:"#3b82f6"}}>{allGames.filter(g=>g.opponent===oppTeam).length}g</span>}
                  </button>
                )}
                {/* Vs specific team picker */}
                <div style={{color:"#334155",fontSize:9,marginBottom:5}}>vs specific team:</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {[...new Set(allGames.map(g=>g.opponent))].sort().map(opp=>(
                    <button key={opp} onClick={()=>setSplitVsTeam(v=>v===opp?"":opp)}
                      style={{padding:"3px 7px",borderRadius:4,border:`1px solid ${splitVsTeam===opp?"#3b82f6":"#1e293b"}`,background:splitVsTeam===opp?"#3b82f622":"transparent",color:splitVsTeam===opp?"#3b82f6":"#475569",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                      {opp}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Win/Loss Margin ── */}
              <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:10}}>WIN/LOSS MARGIN</div>
                <div style={{display:"flex",gap:5}}>
                  {[
                    {label:"Close (≤8)",  val:"close"},
                    {label:"Large (15+)", val:"large"},
                  ].map(({label,val})=>(
                    <button key={val} onClick={()=>setSplitMargin(m=>m===val?"":val)}
                      style={{flex:1,padding:"5px 8px",borderRadius:8,border:`1px solid ${splitMargin===val?"#f59e0b":"#1e293b"}`,background:splitMargin===val?"#f59e0b22":"transparent",color:splitMargin===val?"#f59e0b":"#475569",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                      {label}
                    </button>
                  ))}
                </div>
                {splitMargin && <div style={{color:"#334155",fontSize:9,marginTop:5}}>
                  {allGames.filter(g=>splitMargin==="close"?Math.abs(g.margin||0)<=8:Math.abs(g.margin||0)>15).length}g match
                  {!allGames.some(g=>g.margin!=null) && <span style={{color:"#ef444488"}}> · margin data not in gamelog yet</span>}
                </div>}
              </div>

              {/* ── Minutes Played ── */}
              <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:10}}>MINUTES PLAYED</div>
                <div style={{display:"flex",gap:5}}>
                  {["30+","35+","38+"].map(m=>(
                    <button key={m} onClick={()=>setSplitMinutes(v=>v===m?"":m)}
                      style={{flex:1,padding:"5px 8px",borderRadius:8,border:`1px solid ${splitMinutes===m?"#06b6d4":"#1e293b"}`,background:splitMinutes===m?"#06b6d422":"transparent",color:splitMinutes===m?"#06b6d4":"#475569",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Season splits summary — clickable rows activate the split */}
              {gamelog && (
                <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                  <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:10}}>SEASON SPLITS</div>
                  {[
                    {label:"Home",   sg:allGames.filter(g=>g.homeAway==="home"),   activate:()=>{setSplitHome(true);setSplitAway(false);}},
                    {label:"Away",   sg:allGames.filter(g=>g.homeAway!=="home"),   activate:()=>{setSplitAway(true);setSplitHome(false);}},
                    {label:"Wins",   sg:allGames.filter(g=>g.result==="W"),         activate:()=>{setSplitWins(true);setSplitLosses(false);}},
                    {label:"Losses", sg:allGames.filter(g=>g.result==="L"),         activate:()=>{setSplitLosses(true);setSplitWins(false);}},
                    {label:"B2B",    sg:allGames.filter(g=>g.isB2B),               activate:()=>setSplitB2B(true)},
                  ].map(({label,sg,activate})=>{
                    if(!sg.length) return null;
                    const vals=sg.map(g=>getStatValue(g,statType));
                    const a=(vals.reduce((x,y)=>x+y,0)/vals.length).toFixed(1);
                    const hr=parsedLine!=null?Math.round(vals.filter(v=>v>parsedLine).length/vals.length*100):null;
                    const hrc=hr!=null?(hr>=70?"#22c55e":hr>=50?"#f59e0b":"#ef4444"):"#475569";
                    return (
                      <div key={label} onClick={activate} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7,cursor:"pointer",padding:"3px 4px",borderRadius:5}}
                        onMouseEnter={e=>e.currentTarget.style.background="#0f172a"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <span style={{color:"#64748b",fontSize:11}}>{label} <span style={{color:"#334155"}}>({sg.length}g)</span></span>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{color:"#f1f5f9",fontWeight:700,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}>{a}</span>
                          {hr!=null&&<span style={{background:hrc+"22",color:hrc,fontSize:10,fontWeight:800,borderRadius:4,padding:"1px 5px"}}>{hr}%</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* W/ filter — WITH teammate */}
              <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #22c55e33"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                  <span style={{color:"#22c55e",fontSize:9,fontWeight:700,letterSpacing:1}}>W/ FILTER</span>
                  <span style={{color:"#334155",fontSize:9}}>— games WITH teammate</span>
                </div>
                <input value={wQuery} onChange={e=>{setWQuery(e.target.value);searchW(e.target.value);}}
                  placeholder="Search teammate..."
                  style={{width:"100%",background:"#0f172a",border:"1px solid #22c55e33",borderRadius:6,padding:"6px 10px",color:"#f1f5f9",fontSize:11,outline:"none",marginBottom:6}}/>
                {wResults.length>0&&(
                  <div style={{background:"#0f172a",borderRadius:6,overflow:"hidden",marginBottom:6}}>
                    {wResults.slice(0,4).map(p=>(
                      <div key={p.id} onClick={()=>{setWPlayers([...wPlayers,p]);setWQuery("");setWResults([]);}}
                        style={{padding:"6px 10px",cursor:"pointer",fontSize:11,color:"#94a3b8",borderBottom:"1px solid #1e293b"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#1e293b"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
                {wPlayers.map(p=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#22c55e15",border:"1px solid #22c55e33",borderRadius:5,padding:"4px 8px",marginBottom:4}}>
                    <span style={{color:"#22c55e",fontSize:10,fontWeight:600}}>W/ {p.name.split(" ").slice(-1)[0]}</span>
                    <button onClick={()=>setWPlayers(wPlayers.filter(x=>x.id!==p.id))} style={{background:"none",border:"none",color:"#22c55e",cursor:"pointer",fontSize:13,padding:0,lineHeight:1}}>×</button>
                  </div>
                ))}
                {wPlayers.length===0&&<div style={{color:"#334155",fontSize:10}}>Filters to games the teammate played</div>}

              </div>

              {/* W/O filter — WITHOUT teammate (teammate must be in teammatesOut = DNP) */}
              <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #ef444433"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                  <span style={{color:"#ef4444",fontSize:9,fontWeight:700,letterSpacing:1}}>W/O FILTER</span>
                  <span style={{color:"#334155",fontSize:9}}>— games WITHOUT teammate</span>
                </div>
                <input value={woQuery} onChange={e=>{setWoQuery(e.target.value);searchWo(e.target.value);}}
                  placeholder="Search teammate..."
                  style={{width:"100%",background:"#0f172a",border:"1px solid #ef444433",borderRadius:6,padding:"6px 10px",color:"#f1f5f9",fontSize:11,outline:"none",marginBottom:6}}/>
                {woResults.length>0&&(
                  <div style={{background:"#0f172a",borderRadius:6,overflow:"hidden",marginBottom:6}}>
                    {woResults.slice(0,4).map(p=>(
                      <div key={p.id} onClick={()=>{setWoPlayers([...woPlayers,p]);setWoQuery("");setWoResults([]);}}
                        style={{padding:"6px 10px",cursor:"pointer",fontSize:11,color:"#94a3b8",borderBottom:"1px solid #1e293b"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#1e293b"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
                {woPlayers.map(p=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#ef444415",border:"1px solid #ef444433",borderRadius:5,padding:"4px 8px",marginBottom:4}}>
                    <span style={{color:"#ef4444",fontSize:10,fontWeight:600}}>W/O {p.name.split(" ").slice(-1)[0]}</span>
                    <button onClick={()=>setWoPlayers(woPlayers.filter(x=>x.id!==p.id))} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:13,padding:0,lineHeight:1}}>×</button>
                  </div>
                ))}
                {woPlayers.length===0&&<div style={{color:"#334155",fontSize:10}}>Filters to games the teammate sat out (DNP)</div>}
              </div>

              {/* Last 5 quick glance */}
              {displayGames.length>0&&(
                <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                  <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:8}}>LAST 5 GAMES</div>
                  {displayGames.slice(0,5).map((g,i)=>{
                    const val=getStatValue(g,statType);
                    const isHit=parsedLine!=null&&val>parsedLine;
                    return(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div>
                          <span style={{color:"#94a3b8",fontSize:11}}>vs {g.opponent}</span>
                          <span style={{color:"#334155",fontSize:9,marginLeft:4}}>{g.result}</span>
                        </div>
                        <span style={{color:parsedLine!=null?(isHit?"#22c55e":"#ef4444"):"#f1f5f9",fontWeight:800,fontSize:13,fontFamily:"'IBM Plex Mono',monospace"}}>{val}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>)}

            {/* ── OPP RANKINGS TAB ── */}
            {rightTab==="oppRank"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {defVsPos&&oppTeam?(
                  <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                    <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:4}}>DEF VS POSITION</div>
                    <div style={{color:"#475569",fontSize:10,marginBottom:10}}>
                      <span style={{color:"#f1f5f9",fontWeight:700}}>{oppTeam}</span> avg pts allowed per position (L20):
                    </div>
                    {Object.entries(defVsPos).map(([pos,pts])=>{
                      const isMe=pos===playerPos;
                      if(pts==null) return(
                        <div key={pos} style={{marginBottom:8,opacity:0.4}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{color:"#475569",fontSize:12}}>{pos}</span>
                            <span style={{color:"#334155",fontSize:11}}>—</span>
                          </div>
                          <div style={{height:5,background:"#0f172a",borderRadius:99}}/>
                        </div>
                      );
                      const barPct=Math.min((pts/35)*100,100);
                      const barColor=pts>=25?"#ef4444":pts>=20?"#f59e0b":"#22c55e";
                      return(
                        <div key={pos} style={{marginBottom:8}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{color:isMe?"#f1f5f9":"#475569",fontWeight:isMe?700:400,fontSize:12,display:"flex",alignItems:"center",gap:4}}>
                              {isMe&&<span style={{background:"#8b5cf622",color:"#8b5cf6",fontSize:8,fontWeight:800,padding:"1px 4px",borderRadius:3}}>YOU</span>}
                              {pos}
                            </span>
                            <span style={{color:isMe?barColor:"#64748b",fontWeight:isMe?800:500,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}>{pts}</span>
                          </div>
                          <div style={{height:5,background:"#0f172a",borderRadius:99,overflow:"hidden"}}>
                            <div style={{width:`${barPct}%`,height:"100%",background:isMe?barColor:"#1e293b",borderRadius:99,transition:"width 0.4s"}}/>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{color:"#1e293b",fontSize:9,marginTop:8}}>10+ min threshold · combo positions split</div>
                  </div>
                ):(
                  <div style={{color:"#334155",fontSize:12,textAlign:"center",padding:"20px 0"}}>
                    {oppTeam?"Loading...":"No game found for today"}
                  </div>
                )}
              </div>
            )}

            {/* ── STATS TAB ── */}
            {rightTab==="stats"&&gamelog&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                  <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:10}}>SEASON AVERAGES</div>
                  {[
                    {label:"Points",  val:gamelog.seasonAvg?.pts},
                    {label:"Rebounds",val:gamelog.seasonAvg?.reb},
                    {label:"Assists", val:gamelog.seasonAvg?.ast},
                    {label:"Minutes", val:gamelog.seasonAvg?.min},
                  ].filter(r=>r.val!=null).map(({label,val})=>(
                    <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,paddingBottom:8,borderBottom:"1px solid #0f172a"}}>
                      <span style={{color:"#64748b",fontSize:11}}>{label}</span>
                      <span style={{color:"#f1f5f9",fontWeight:800,fontSize:13,fontFamily:"'IBM Plex Mono',monospace"}}>{val}</span>
                    </div>
                  ))}
                </div>
                <div style={{background:"#0a111e",borderRadius:10,padding:12,border:"1px solid #1e293b"}}>
                  <div style={{color:"#64748b",fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:10}}>FILTERED SAMPLE ({displayGames.length}g)</div>
                  {(()=>{
                    const pts=displayGames.map(g=>g.pts||0);
                    const reb=displayGames.map(g=>g.reb||0);
                    const ast=displayGames.map(g=>g.ast||0);
                    const avg2=arr=>arr.length?(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1):"—";
                    const max2=arr=>arr.length?Math.max(...arr):"—";
                    return [
                      {label:"Avg PTS",val:avg2(pts)},{label:"Avg REB",val:avg2(reb)},
                      {label:"Avg AST",val:avg2(ast)},{label:"Max PTS",val:max2(pts)},
                    ].map(({label,val})=>(
                      <div key={label} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <span style={{color:"#475569",fontSize:11}}>{label}</span>
                        <span style={{color:"#f1f5f9",fontWeight:700,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}>{val}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}


// ── ResultsDashboard component ────────────────────────────────────────────────
function ResultsDashboard({ onClose }) {
  const [history, setHistory] = useState(loadHistory());
  const [checking, setChecking] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);

  const entries = Object.values(history).sort((a,b) => new Date(b.date) - new Date(a.date));

  // Fetch box scores for all closed games that don't have results yet
  const checkAllResults = async () => {
    setChecking(true);
    setCheckedCount(0);
    const h = loadHistory();
    let count = 0;

    for (const entry of Object.values(h)) {
      // Skip if already resolved
      if (entry.results) { setCheckedCount(c => c + 1); continue; }

      try {
        // Always fetch summary — it tells us if game is complete AND has box score
        const data = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${entry.gameId}`
        ).then(r => r.json());

        // Check if game is actually finished via header status
        const competition = data.header?.competitions?.[0];
        const statusType = competition?.status?.type?.name || competition?.status?.type?.id;
        const isCompleted = competition?.status?.type?.completed === true
          || statusType === "STATUS_FINAL"
          || statusType === "3" // ESPN status id 3 = final
          || data.header?.competitions?.[0]?.status?.type?.state === "post";

        // Update status in history
        if (isCompleted) {
          h[entry.gameId].status = "closed";
        } else {
          // Game not done yet — skip box score parsing
          setCheckedCount(c => c + 1);
          continue;
        }

        // Parse box score
        const map = {};
        (data.boxscore?.players||[]).forEach(team => {
          (team.statistics||[]).forEach(sg => {
            const labels = (sg.labels||[]).map(l=>l.toLowerCase());
            const ptsIdx = labels.indexOf("pts");
            const rebIdx = labels.indexOf("reb");
            const astIdx = labels.indexOf("ast");
            (sg.athletes||[]).forEach(a => {
              const name = a.athlete?.displayName||a.athlete?.fullName;
              if (!name || map[name.toLowerCase()]) return;
              const s = a.stats||[];
              const dnp = a.didNotPlay||!s.length||s[0]==="DNP"||s[0]==="--";
              map[name.toLowerCase()] = {
                dnp,
                points:   dnp||ptsIdx<0 ? 0 : parseFloat(s[ptsIdx])||0,
                rebounds: dnp||rebIdx<0 ? 0 : parseFloat(s[rebIdx])||0,
                assists:  dnp||astIdx<0 ? 0 : parseFloat(s[astIdx])||0,
              };
            });
          });
        });
        if (Object.keys(map).length > 0) { h[entry.gameId].results = map; count++; }
      } catch {}
      setCheckedCount(c => c + 1);
    }
    saveHistory(h);
    setHistory({...h});
    setChecking(false);
  };

  // Compute accuracy stats from all entries with results
  const computeStats = () => {
    const tiers = { lowRisk: {hits:0,total:0,dnp:0}, mediumRisk: {hits:0,total:0,dnp:0}, highRisk: {hits:0,total:0,dnp:0}, firstQuarter: {hits:0,total:0,dnp:0} };
    const byStatType = { points:{hits:0,total:0}, rebounds:{hits:0,total:0}, assists:{hits:0,total:0} };

    for (const entry of Object.values(history)) {
      if (!entry.results || !entry.betBuilder) continue;
      const map = entry.results;

      const findP = (name) => {
        const k = name.toLowerCase();
        if (map[k]) return map[k];
        const last = name.split(" ").slice(-1)[0].toLowerCase();
        const found = Object.keys(map).find(key => key.includes(last));
        return found ? map[found] : null;
      };

      for (const [tierKey, tier] of Object.entries(entry.betBuilder)) {
        if (!tiers[tierKey] || !tier?.legs) continue;
        for (const leg of tier.legs) {
          const ps = findP(leg.player);
          if (!ps || ps.dnp) { tiers[tierKey].dnp++; continue; }
          const actual = ps[leg.stat] ?? 0;
          const hit = leg.direction === "over" ? actual > leg.line : actual < leg.line;
          tiers[tierKey].total++;
          if (hit) tiers[tierKey].hits++;
          if (byStatType[leg.stat]) {
            byStatType[leg.stat].total++;
            if (hit) byStatType[leg.stat].hits++;
          }
        }
      }
    }
    return { tiers, byStatType };
  };

  const stats = computeStats();
  const gamesWithResults = entries.filter(e => e.results).length;

  const TierBar = ({ label, color, icon, data }) => {
    const pct = data.total > 0 ? Math.round(data.hits/data.total*100) : null;
    const barColor = pct == null ? "#1e293b" : pct >= 65 ? "#22c55e" : pct >= 48 ? "#f59e0b" : "#ef4444";
    return (
      <div style={{ background: "#0a111e", borderRadius: 12, padding: 14, border: `1px solid ${color}33` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 13 }}>{label}</div>
              <div style={{ color: "#475569", fontSize: 10 }}>{data.hits}/{data.total} legs hit · {data.dnp} DNP excluded</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: barColor, fontWeight: 900, fontSize: 28, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1 }}>{pct != null ? `${pct}%` : "—"}</div>
          </div>
        </div>
        <div style={{ height: 6, background: "#0f172a", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: `${pct||0}%`, height: "100%", background: barColor, borderRadius: 99, transition: "width 0.6s ease" }} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#020817", zIndex: 200, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #0f172a", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#020817", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📊</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, fontFamily: "'IBM Plex Mono',monospace" }}>RESULTS <span style={{ color: "#3b82f6" }}>TRACKER</span></div>
            <div style={{ color: "#334155", fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>{entries.length} GAMES TRACKED · {gamesWithResults} RESOLVED</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={checkAllResults} disabled={checking}
            style={{ background: checking?"#1e293b":"#1d4ed8", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 8, cursor: checking?"not-allowed":"pointer", fontSize: 12, fontWeight: 700 }}>
            {checking ? `Checking... (${checkedCount})` : "🔄 Check All Results"}
          </button>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #1e293b", color: "#475569", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>✕ Close</button>
        </div>
      </div>

      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 900, margin: "0 auto", width: "100%" }}>

        {/* Accuracy overview */}
        {gamesWithResults > 0 && (
          <div>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" }}>📈 Accuracy by Tier ({gamesWithResults} games)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <TierBar label="Safe Parlay"     color="#22c55e" icon="🛡️" data={stats.tiers.lowRisk} />
              <TierBar label="Value Parlay"    color="#f59e0b" icon="⚡" data={stats.tiers.mediumRisk} />
              <TierBar label="Longshot Parlay" color="#ef4444" icon="🚀" data={stats.tiers.highRisk} />
              {stats.tiers.firstQuarter.total > 0 && <TierBar label="1Q Parlay" color="#8b5cf6" icon="1️⃣" data={stats.tiers.firstQuarter} />}
            </div>
            {/* Stat type breakdown */}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {[{label:"PTS legs",key:"points",icon:"🏀"},{label:"REB legs",key:"rebounds",icon:"💪"},{label:"AST legs",key:"assists",icon:"🤝"}].map(({label,key,icon}) => {
                const d = stats.byStatType[key];
                const pct = d.total > 0 ? Math.round(d.hits/d.total*100) : null;
                const clr = pct==null?"#475569":pct>=65?"#22c55e":pct>=48?"#f59e0b":"#ef4444";
                return (
                  <div key={key} style={{ flex: 1, background: "#0a111e", borderRadius: 10, padding: 12, border: "1px solid #1e293b", textAlign: "center" }}>
                    <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
                    <div style={{ color: clr, fontWeight: 900, fontSize: 20, fontFamily: "'IBM Plex Mono',monospace" }}>{pct!=null?`${pct}%`:"—"}</div>
                    <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{label}</div>
                    <div style={{ color: "#334155", fontSize: 9 }}>{d.hits}/{d.total}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Game history */}
        <div>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" }}>🗓️ Game History</div>
          {entries.length === 0 ? (
            <div style={{ background: "#0a111e", borderRadius: 12, padding: 40, textAlign: "center", border: "1px solid #1e293b" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
              <div style={{ color: "#475569", fontWeight: 600 }}>No games tracked yet</div>
              <div style={{ color: "#334155", fontSize: 12, marginTop: 4 }}>Generate a prediction with the 🎰 Builder tab to start tracking</div>
            </div>
          ) : entries.map(entry => {
            const hasResults = !!entry.results;
            const map = entry.results || {};
            const findP = (name) => {
              const k = name.toLowerCase();
              if (map[k]) return map[k];
              const last = name.split(" ").slice(-1)[0].toLowerCase();
              const found = Object.keys(map).find(key => key.includes(last));
              return found ? map[found] : null;
            };

            // Compute per-tier mini summary
            const miniSummary = (legs) => {
              if (!hasResults || !legs) return null;
              const res = legs.map(leg => {
                const ps = findP(leg.player);
                if (!ps || ps.dnp) return null;
                const actual = ps[leg.stat] ?? 0;
                return leg.direction === "over" ? actual > leg.line : actual < leg.line;
              }).filter(r => r !== null);
              if (!res.length) return null;
              const hits = res.filter(Boolean).length;
              return { hits, total: res.length };
            };

            const bb = entry.betBuilder || {};
            const safeSumm  = miniSummary(bb.lowRisk?.legs);
            const valSumm   = miniSummary(bb.mediumRisk?.legs);
            const longSumm  = miniSummary(bb.highRisk?.legs);
            const q1Summ    = miniSummary(bb.firstQuarter?.legs);
            const dateStr   = new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

            return (
              <div key={entry.gameId} style={{ background: "#0a111e", borderRadius: 12, padding: 16, border: "1px solid #1e293b", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: hasResults ? 12 : 0 }}>
                  <div>
                    <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{entry.gameLabel || entry.gameId}</div>
                    <div style={{ color: "#334155", fontSize: 11, marginTop: 2 }}>{dateStr} · {hasResults ? "✅ Results in" : entry.status === "closed" ? "⟳ Pending check" : "⏳ Game not finished"}</div>
                  </div>
                  {hasResults && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {[{s:safeSumm,c:"#22c55e",l:"S"},{s:valSumm,c:"#f59e0b",l:"V"},{s:longSumm,c:"#ef4444",l:"L"},{s:q1Summ,c:"#8b5cf6",l:"1Q"}].map(({s,c,l}) => s ? (
                        <div key={l} style={{ background: c+"15", border: `1px solid ${c}33`, borderRadius: 6, padding: "3px 8px", textAlign: "center" }}>
                          <div style={{ color: c, fontWeight: 800, fontSize: 11, fontFamily: "'IBM Plex Mono',monospace" }}>{s.hits}/{s.total}</div>
                          <div style={{ color: "#475569", fontSize: 8 }}>{l}</div>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>
                {/* Show leg results inline */}
                {hasResults && bb.lowRisk?.legs && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {["lowRisk","mediumRisk","highRisk","firstQuarter"].flatMap((tk, ti) =>
                      (bb[tk]?.legs||[]).slice(0, ti===0?3:ti===1?5:ti===2?4:4).map((leg, li) => {
                        const ps = findP(leg.player);
                        const dnp = !ps || ps.dnp;
                        const actual = ps && !ps.dnp ? ps[leg.stat] : null;
                        const hit = !dnp && actual != null && (leg.direction==="over" ? actual > leg.line : actual < leg.line);
                        const miss = !dnp && actual != null && !hit;
                        const clr = dnp?"#475569":hit?"#22c55e":"#ef4444";
                        const lbl = `${leg.player.split(" ").slice(-1)[0]} ${leg.direction==="over"?"O":"U"}${leg.line} ${leg.stat==="points"?"PTS":leg.stat==="rebounds"?"REB":"AST"}`;
                        return (
                          <div key={`${tk}-${li}`} style={{ background: clr+"15", border: `1px solid ${clr}33`, borderRadius: 5, padding: "2px 7px", fontSize: 9, color: clr, fontWeight: 600 }}>
                            {dnp?"⛔":hit?"✅":"❌"} {lbl} {actual!=null?`(${actual})`:""}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {entries.length > 0 && (
          <button onClick={() => { if (confirm("Clear all tracked results?")) { saveHistory({}); setHistory({}); }}}
            style={{ background: "transparent", border: "1px solid #1e293b", color: "#334155", padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 11 }}>
            🗑️ Clear All History
          </button>
        )}
      </div>
    </div>
  );
}

function PredictionPanel({ game, onClose }) {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rosters, setRosters] = useState({ home: [], away: [] });
  const [standings, setStandings] = useState({});
  const [activeTab, setActiveTab] = useState("game");

  const homeTeam = game.teams[game.home]?.name;
  const awayTeam = game.teams[game.away]?.name;

  const fetchPrediction = useCallback(async () => {
    setLoading(true);
    setPrediction(null);
    try {
      const isClosed = game.status === "closed";
      const homeScore = game.score?.[game.home];
      const awayScore = game.score?.[game.away];
      const homeProb = game.win_probability?.[game.home];
      const awayProb = game.win_probability?.[game.away];

      const FALLBACK_STANDINGS = {
        OKC: { wins: 51, losses: 15, pct: 0.773, homeRecord: "27-6",  awayRecord: "24-9",  confRank: 1 },
        SAS: { wins: 47, losses: 17, pct: 0.734, homeRecord: "25-7",  awayRecord: "22-10", confRank: 1 },
        DET: { wins: 45, losses: 18, pct: 0.714, homeRecord: "24-8",  awayRecord: "21-10", confRank: 1 },
        BOS: { wins: 43, losses: 21, pct: 0.672, homeRecord: "23-9",  awayRecord: "20-12", confRank: 2 },
        NYK: { wins: 41, losses: 25, pct: 0.621, homeRecord: "22-10", awayRecord: "19-15", confRank: 3 },
        MIN: { wins: 40, losses: 24, pct: 0.625, homeRecord: "21-11", awayRecord: "19-13", confRank: 2 },
        CLE: { wins: 40, losses: 25, pct: 0.615, homeRecord: "22-10", awayRecord: "18-15", confRank: 4 },
        HOU: { wins: 39, losses: 24, pct: 0.619, homeRecord: "21-10", awayRecord: "18-14", confRank: 3 },
        DEN: { wins: 39, losses: 26, pct: 0.600, homeRecord: "22-10", awayRecord: "17-16", confRank: 4 },
        LAL: { wins: 39, losses: 25, pct: 0.609, homeRecord: "21-11", awayRecord: "18-14", confRank: 5 },
        PHX: { wins: 37, losses: 27, pct: 0.578, homeRecord: "20-12", awayRecord: "17-15", confRank: 6 },
        MIA: { wins: 36, losses: 29, pct: 0.554, homeRecord: "20-12", awayRecord: "16-17", confRank: 5 },
        TOR: { wins: 36, losses: 27, pct: 0.571, homeRecord: "19-13", awayRecord: "17-14", confRank: 6 },
        ORL: { wins: 35, losses: 28, pct: 0.556, homeRecord: "19-13", awayRecord: "16-15", confRank: 7 },
        PHI: { wins: 34, losses: 30, pct: 0.531, homeRecord: "18-14", awayRecord: "16-16", confRank: 8 },
        ATL: { wins: 33, losses: 31, pct: 0.516, homeRecord: "18-14", awayRecord: "15-17", confRank: 9 },
        LAC: { wins: 32, losses: 32, pct: 0.500, homeRecord: "17-15", awayRecord: "15-17", confRank: 7 },
        GSW: { wins: 32, losses: 32, pct: 0.500, homeRecord: "17-15", awayRecord: "15-17", confRank: 8 },
        POR: { wins: 31, losses: 34, pct: 0.477, homeRecord: "17-15", awayRecord: "14-19", confRank: 9 },
        CHA: { wins: 32, losses: 33, pct: 0.492, homeRecord: "17-15", awayRecord: "15-18", confRank: 10 },
        MIL: { wins: 27, losses: 36, pct: 0.429, homeRecord: "15-17", awayRecord: "12-19", confRank: 11 },
        CHI: { wins: 26, losses: 38, pct: 0.406, homeRecord: "14-18", awayRecord: "12-20", confRank: 12 },
        MEM: { wins: 23, losses: 40, pct: 0.365, homeRecord: "13-19", awayRecord: "10-21", confRank: 10 },
        DAL: { wins: 21, losses: 43, pct: 0.328, homeRecord: "12-20", awayRecord: "9-23",  confRank: 11 },
        NOP: { wins: 21, losses: 45, pct: 0.318, homeRecord: "12-20", awayRecord: "9-25",  confRank: 12 },
        UTA: { wins: 20, losses: 45, pct: 0.308, homeRecord: "11-21", awayRecord: "9-24",  confRank: 13 },
        WAS: { wins: 16, losses: 47, pct: 0.254, homeRecord: "9-23",  awayRecord: "7-24",  confRank: 13 },
        BKN: { wins: 17, losses: 47, pct: 0.266, homeRecord: "9-23",  awayRecord: "8-24",  confRank: 14 },
        IND: { wins: 15, losses: 49, pct: 0.234, homeRecord: "8-24",  awayRecord: "7-25",  confRank: 14 },
        SAC: { wins: 15, losses: 50, pct: 0.231, homeRecord: "8-24",  awayRecord: "7-26",  confRank: 15 },
      };

      const [
        homePlayers, awayPlayers, standingsRaw,
        homeSchedule, awaySchedule,
        homePlayerStats, awayPlayerStats,
        homeTeamStats, awayTeamStats,
        homeGameLogs, awayGameLogs,
      ] = await Promise.all([
        fetchRosterWithInjuries(game.home),
        fetchRosterWithInjuries(game.away),
        fetch(`${API}/standings`).then(r => r.json()).catch(() => ({})),
        fetchSchedule(game.home),
        fetchSchedule(game.away),
        fetchPlayerStats(game.home),
        fetchPlayerStats(game.away),
        fetchTeamStats(game.home),
        fetchTeamStats(game.away),
        fetchGameLogsBatch(game.home),
        fetchGameLogsBatch(game.away),
      ]);

      const standingsData = { ...FALLBACK_STANDINGS, ...(typeof standingsRaw === "object" && !standingsRaw.error ? standingsRaw : {}) };
      setRosters({ home: homePlayers, away: awayPlayers });
      setStandings(standingsData);

      const homeRecord = standingsData[game.home];
      const awayRecord = standingsData[game.away];

      // ── Helpers ────────────────────────────────────────────────────────────
      const fmt1   = v => v != null ? Number(v).toFixed(1) : null;
      const fmtPct = v => v != null ? (Number(v) * 100).toFixed(1) + "%" : null;
      const or     = (v, fallback) => v ?? fallback;

      const buildStrength = (abbrev, record, isHome) => {
        if (!record) return `${abbrev} (${isHome ? "HOME" : "AWAY"}): no record data`;
        const tier =
          record.pct >= 0.65 ? "ELITE" : record.pct >= 0.55 ? "GOOD" :
          record.pct >= 0.45 ? "AVERAGE" : record.pct >= 0.35 ? "WEAK" : "BOTTOM-TIER";
        return `${abbrev} (${isHome ? "HOME" : "AWAY"}): ${record.wins}-${record.losses} | ${(record.pct*100).toFixed(1)}% | ${tier} | #${record.confRank} conf | Home: ${record.homeRecord} | Away: ${record.awayRecord}${record.last10 ? ` | L10: ${record.last10}` : ""}${record.streak ? ` | Streak: ${record.streak}` : ""}`;
      };

      const homePct = homeRecord?.pct ?? 0.5;
      const awayPct = awayRecord?.pct  ?? 0.5;
      const pctGap  = Math.abs(homePct - awayPct);
      const stronger = homePct >= awayPct ? game.home : game.away;

      let dominanceNote;
      if (pctGap >= 0.20)      dominanceNote = `⚠️ MAJOR MISMATCH: ${stronger} is vastly superior (${(pctGap*100).toFixed(0)}% win-rate gap). Pick ${stronger} unless their 20+ PPG star is OUT.`;
      else if (pctGap >= 0.12) dominanceNote = `${stronger} has a clear edge (${(pctGap*100).toFixed(0)}% gap). Needs a star injury to flip.`;
      else if (pctGap >= 0.06) dominanceNote = `${stronger} has a moderate edge — defense, form & rest are tiebreakers.`;
      else                     dominanceNote = `Closely matched — matchup exploits, form, and rest decide it.`;

      const homeAvailable   = homePlayers.filter(p => !UNAVAILABLE_STATUSES.includes(p.status));
      const awayAvailable   = awayPlayers.filter(p => !UNAVAILABLE_STATUSES.includes(p.status));
      const homeUnavailable = homePlayers.filter(p =>  UNAVAILABLE_STATUSES.includes(p.status));
      const awayUnavailable = awayPlayers.filter(p =>  UNAVAILABLE_STATUSES.includes(p.status));
      const formatPlayers     = pl => pl.length ? pl.map(p => `${p.name} (${p.position}, ${p.ppg?.toFixed(1)||'?'}ppg/${p.rpg?.toFixed(1)||'?'}rpg/${p.apg?.toFixed(1)||'?'}apg)`).join(", ") : "None";
      const formatUnavailable = pl => pl.length ? pl.map(p => `${p.name} [${p.status}]`).join(", ") : "None";

      // ── Recent Form ────────────────────────────────────────────────────────
      const buildFormSummary = (sch, abbrev) => {
        if (!sch || sch.error) return `${abbrev}: form unavailable`;
        const w = sch.recentWins ?? 0, l = sch.recentLosses ?? 0;
        const trend = w >= 4 ? "🔥 HOT" : w === 3 ? "↗ Good form" : w === 2 ? "→ Mixed" : "❄️ COLD";
        return `${abbrev} L5: ${sch.recentForm || "N/A"} (${w}W-${l}L) | ${trend}`;
      };

      // ── Rest ───────────────────────────────────────────────────────────────
      const buildRestSummary = (sch, abbrev) => {
        if (!sch || sch.restDays == null) return `${abbrev}: rest data unavailable`;
        if (sch.isBackToBack) return `⚠️ ${abbrev} BACK-TO-BACK (${sch.restDays}d rest) → −3 to −4 pts fatigue penalty`;
        if (sch.restDays >= 3) return `${abbrev}: well-rested (${sch.restDays} days off) → +1 to +2 pts freshness`;
        return `${abbrev}: normal rest (${sch.restDays} days off)`;
      };

      // ── Star Power ─────────────────────────────────────────────────────────
      const buildStarPower = (abbrev, pStats, unavail) => {
        if (!pStats?.length) return `${abbrev}: player stats unavailable`;
        const outNames = unavail.map(p => p.name);
        const missing  = pStats.filter(p => outNames.includes(p.name) && p.ppg >= 15)
          .map(p => `${p.name} (${fmt1(p.ppg)} PPG, ${fmt1(p.rpg)} RPG, ${fmt1(p.apg)} APG) [OUT]`);
        const top3 = pStats.filter(p => !outNames.includes(p.name)).slice(0, 3)
          .map(p => `${p.name} ${fmt1(p.ppg)}pts/${fmt1(p.rpg)}reb/${fmt1(p.apg)}ast${p.fg3Pct > 0.35 ? " (shooter)" : ""}`);
        let s = `${abbrev} top available: ${top3.join(" | ")}`;
        if (missing.length) s += ` ⚠️ MISSING: ${missing.join(", ")}`;
        return s;
      };

      // ── Defensive Profile ──────────────────────────────────────────────────
      const buildDefenseProfile = (abbrev, ts) => {
        if (!ts || ts.error) return `${abbrev}: defense stats unavailable`;
        const d = ts.defense || {}, r = ts.ratings || {};
        const parts = [`${abbrev} DEF:`];
        if (d.oppPpg      != null) parts.push(`Opp PPG allowed: ${fmt1(d.oppPpg)}`);
        if (r.defRating   != null) parts.push(`DefRtg: ${fmt1(r.defRating)}`);
        if (d.oppFg3Pct   != null) parts.push(`Opp 3PT% allowed: ${fmtPct(d.oppFg3Pct)}`);
        if (d.oppPaintPts != null) parts.push(`Opp paint pts allowed/gm: ${fmt1(d.oppPaintPts)}`);
        if (d.oppFgPct    != null) parts.push(`Opp FG% allowed: ${fmtPct(d.oppFgPct)}`);
        if (d.stealsPg    != null) parts.push(`STL/gm: ${fmt1(d.stealsPg)}`);
        if (d.blocksPg    != null) parts.push(`BLK/gm: ${fmt1(d.blocksPg)}`);
        return parts.join(" | ");
      };

      // ── Offensive Profile ──────────────────────────────────────────────────
      const buildOffenseProfile = (abbrev, ts) => {
        if (!ts || ts.error) return `${abbrev}: offense stats unavailable`;
        const o = ts.offense || {}, r = ts.ratings || {};
        const parts = [`${abbrev} OFF:`];
        if (o.ppg              != null) parts.push(`PPG: ${fmt1(o.ppg)}`);
        if (r.offRating        != null) parts.push(`OffRtg: ${fmt1(r.offRating)}`);
        if (o.fg3Rate          != null) parts.push(`3PT attempt rate: ${fmtPct(o.fg3Rate)}`);
        if (o.fg3Pct           != null) parts.push(`3PT%: ${fmtPct(o.fg3Pct)}`);
        if (o.paintPtsPerGame  != null) parts.push(`Paint pts/gm: ${fmt1(o.paintPtsPerGame)}`);
        if (o.astPg            != null) parts.push(`AST/gm: ${fmt1(o.astPg)}`);
        if (o.tovPg            != null) parts.push(`TOV/gm: ${fmt1(o.tovPg)}`);
        return parts.join(" | ");
      };

      // ── MATCHUP EXPLOITATION ───────────────────────────────────────────────
      // Cross-ref each team's offensive strengths vs opponent's specific defensive weaknesses
      // and name WHICH players will benefit
      const buildMatchupExploits = (hts, ats, hStats, aStats, hUnavail, aUnavail) => {
        const exploits = [];
        const hOff = hts?.offense || {}, hDef = hts?.defense || {};
        const aOff = ats?.offense || {}, aDef = ats?.defense || {};
        const hOutNames = hUnavail.map(p => p.name);
        const aOutNames = aUnavail.map(p => p.name);

        // Top available scorers/role-players for naming specific abusers
        const hTopScorers  = (hStats || []).filter(p => !hOutNames.includes(p.name)).slice(0, 3);
        const aTopScorers  = (aStats  || []).filter(p => !aOutNames.includes(p.name)).slice(0, 3);
        const hPaintGuys   = (hStats || []).filter(p => !hOutNames.includes(p.name) && (p.position === "C" || p.position === "PF" || p.position === "SF")).slice(0, 2);
        const aPaintGuys   = (aStats  || []).filter(p => !aOutNames.includes(p.name) && (p.position === "C" || p.position === "PF" || p.position === "SF")).slice(0, 2);
        const hShooters    = (hStats || []).filter(p => !hOutNames.includes(p.name) && p.fg3Pct >= 0.36).slice(0, 2);
        const aShooters    = (aStats  || []).filter(p => !aOutNames.includes(p.name) && p.fg3Pct >= 0.36).slice(0, 2);
        const hBallHandler = hTopScorers[0];
        const aBallHandler = aTopScorers[0];

        // 1. AWAY team 3PT offense vs HOME team perimeter defense
        if (aOff.fg3Rate != null && hDef.oppFg3Pct != null) {
          const heavyShooter = aOff.fg3Rate >= 0.37;
          const leakyPerimeter = hDef.oppFg3Pct >= 0.365;
          const elitePerimeter = hDef.oppFg3Pct != null && hDef.oppFg3Pct <= 0.33;
          if (heavyShooter && leakyPerimeter) {
            const names = aShooters.map(p => p.name).join(" & ") || aTopScorers[0]?.name || game.away;
            exploits.push(`🎯 3PT EXPLOIT (${game.away} → ${game.home}): ${game.away} launches ${fmtPct(aOff.fg3Rate)} of shots from 3 vs ${game.home}'s porous perimeter (allows ${fmtPct(hDef.oppFg3Pct)} from 3 — bottom tier). ${names} will get wide-open looks. Expect +6 to +10 pts from 3 for ${game.away} vs average.`);
          } else if (elitePerimeter && heavyShooter) {
            exploits.push(`🛡️ 3PT SHUTDOWN (${game.home} neutralizes ${game.away}): ${game.home}'s elite perimeter D (allows only ${fmtPct(hDef.oppFg3Pct)} from 3) will shut down ${game.away}'s 3PT-heavy offense (${fmtPct(aOff.fg3Rate)} rate). ${game.away} forced to attack the paint instead.`);
          }
        }

        // 2. HOME team 3PT offense vs AWAY team perimeter defense
        if (hOff.fg3Rate != null && aDef.oppFg3Pct != null) {
          const heavyShooter = hOff.fg3Rate >= 0.37;
          const leakyPerimeter = aDef.oppFg3Pct >= 0.365;
          const elitePerimeter = aDef.oppFg3Pct != null && aDef.oppFg3Pct <= 0.33;
          if (heavyShooter && leakyPerimeter) {
            const names = hShooters.map(p => p.name).join(" & ") || hTopScorers[0]?.name || game.home;
            exploits.push(`🎯 3PT EXPLOIT (${game.home} → ${game.away}): ${game.home} shoots ${fmtPct(hOff.fg3Rate)} of attempts from 3 vs ${game.away}'s leaky perimeter (allows ${fmtPct(aDef.oppFg3Pct)} from 3). ${names} should have a field day from distance. Expect +6 to +10 pts from 3 vs average.`);
          } else if (elitePerimeter && heavyShooter) {
            exploits.push(`🛡️ 3PT SHUTDOWN (${game.away} neutralizes ${game.home}): ${game.away}'s elite perimeter D (${fmtPct(aDef.oppFg3Pct)} opp 3PT%) will force ${game.home} off the arc. ${game.home} must attack paint.`);
          }
        }

        // 3. AWAY team paint offense vs HOME team interior defense
        if (aOff.paintPtsPerGame != null && hDef.oppPaintPts != null) {
          const paintHeavy = aOff.paintPtsPerGame >= 48;
          const softInterior = hDef.oppPaintPts >= 50;
          const eliteInterior = hDef.oppPaintPts != null && hDef.oppPaintPts <= 42;
          if (paintHeavy && softInterior) {
            const names = aPaintGuys.map(p => p.name).join(" & ") || aTopScorers[0]?.name || game.away;
            exploits.push(`🏀 PAINT EXPLOIT (${game.away} → ${game.home}): ${game.away} scores ${fmt1(aOff.paintPtsPerGame)} pts in the paint per game vs ${game.home}'s soft interior D (allows ${fmt1(hDef.oppPaintPts)} paint pts/gm — vulnerable). ${names} will dominate the lane. Project +5 to +8 bonus paint pts.`);
          } else if (paintHeavy && eliteInterior) {
            const blocker = (hStats || []).filter(p => !hOutNames.includes(p.name) && p.bpg >= 1).slice(0,1)[0];
            exploits.push(`🛡️ PAINT SHUTDOWN (${game.home} walls off ${game.away}): ${game.away} lives in the paint (${fmt1(aOff.paintPtsPerGame)} pts/gm) but ${game.home} allows only ${fmt1(hDef.oppPaintPts)} paint pts — elite interior D.${blocker ? ` ${blocker.name} (${fmt1(blocker.bpg)} BPK/gm) will protect the rim.` : ""} ${game.away} forced to the perimeter.`);
          }
        }

        // 4. HOME team paint offense vs AWAY team interior defense
        if (hOff.paintPtsPerGame != null && aDef.oppPaintPts != null) {
          const paintHeavy = hOff.paintPtsPerGame >= 48;
          const softInterior = aDef.oppPaintPts >= 50;
          const eliteInterior = aDef.oppPaintPts != null && aDef.oppPaintPts <= 42;
          if (paintHeavy && softInterior) {
            const names = hPaintGuys.map(p => p.name).join(" & ") || hTopScorers[0]?.name || game.home;
            exploits.push(`🏀 PAINT EXPLOIT (${game.home} → ${game.away}): ${game.home} scores ${fmt1(hOff.paintPtsPerGame)} paint pts/gm vs ${game.away}'s soft interior (allows ${fmt1(aDef.oppPaintPts)}/gm). ${names} will feast down low. Project +5 to +8 bonus paint pts.`);
          } else if (paintHeavy && eliteInterior) {
            exploits.push(`🛡️ PAINT SHUTDOWN (${game.away} walls off ${game.home}): ${game.home}'s paint-heavy offense (${fmt1(hOff.paintPtsPerGame)}/gm) runs into ${game.away}'s elite interior D (allows only ${fmt1(aDef.oppPaintPts)}/gm). ${game.home} will need to kick out to 3.`);
          }
        }

        // 5. Mid-range / overall FG% mismatch
        if (hOff.ppg != null && aDef.oppFgPct != null && hDef.oppFgPct != null && aOff.ppg != null) {
          const hScoringVsDef = hOff.ppg - (aDef.oppPpg ?? hOff.ppg);
          const aScoringVsDef = aOff.ppg - (hDef.oppPpg ?? aOff.ppg);
          if (hScoringVsDef > 6) exploits.push(`📈 SCORING EDGE: ${game.home} averages ${fmt1(hOff.ppg)} PPG and faces a ${game.away} defense allowing ${fmt1(aDef.oppPpg)} — ${game.home} offense should score freely.`);
          if (aScoringVsDef > 6) exploits.push(`📈 SCORING EDGE: ${game.away} averages ${fmt1(aOff.ppg)} PPG and faces a ${game.home} defense allowing ${fmt1(hDef.oppPpg)} — ${game.away} offense should score freely.`);
        }

        // 6. Ball-handler vs defense (pace/turnover angle)
        if (hOff.tovPg != null && aDef.stealsPg != null) {
          if (aDef.stealsPg >= 9 && hOff.tovPg >= 15) {
            exploits.push(`💸 TURNOVER TRAP: ${game.away} forces ${fmt1(aDef.stealsPg)} steals/gm — ${game.home}'s sloppy ${fmt1(hOff.tovPg)} TOV/gm offense is a prime target. Expect extra ${game.away} possessions and transition buckets.`);
          }
        }
        if (aOff.tovPg != null && hDef.stealsPg != null) {
          if (hDef.stealsPg >= 9 && aOff.tovPg >= 15) {
            exploits.push(`💸 TURNOVER TRAP: ${game.home} forces ${fmt1(hDef.stealsPg)} steals/gm — ${game.away}'s sloppy ${fmt1(aOff.tovPg)} TOV/gm offense is a prime target. Expect extra ${game.home} possessions and transition buckets.`);
          }
        }

        return exploits.length
          ? exploits.join("\n")
          : "No glaring style exploits detected — this is a balanced matchup on paper.";
      };

      // ── Blowout Risk ───────────────────────────────────────────────────────
      const buildBlowoutAnalysis = (hts, ats, hRec, aRec, hSch, aSch) => {
        const signals = []; let score = 0;
        const hDef = hts?.ratings?.defRating, aDef = ats?.ratings?.defRating;
        if (hDef != null && aDef != null) {
          const gap = Math.abs(hDef - aDef), better = hDef < aDef ? game.home : game.away;
          if (gap >= 8)  { score += 4; signals.push(`🛡️ Massive def rating gap (${fmt1(gap)} pts/100 — ${better} far superior defensively)`); }
          else if (gap >= 5) { score += 2; signals.push(`🛡️ Significant def rating gap (${fmt1(gap)} pts/100 — ${better})`); }
          else if (gap >= 3) { score += 1; signals.push(`🛡️ Moderate def rating gap (${fmt1(gap)} pts/100 — ${better})`); }
        }
        const hForced = hts?.defense?.stealsPg, hCommit = hts?.offense?.tovPg;
        const aForced = ats?.defense?.stealsPg, aCommit = ats?.offense?.tovPg;
        if (hForced != null && hCommit != null && aForced != null && aCommit != null) {
          const hNet = hForced - hCommit, aNet = aForced - aCommit;
          const gap = Math.abs(hNet - aNet), winner = hNet > aNet ? game.home : game.away;
          if (gap >= 4)  { score += 3; signals.push(`💸 Major TOV differential (+${fmt1(gap)}/gm — ${winner})`); }
          else if (gap >= 2) { score += 1; signals.push(`💸 TOV edge for ${winner} (+${fmt1(gap)}/gm)`); }
        }
        if (hRec && aRec) {
          const wGap = Math.abs((hRec.pct ?? 0.5) - (aRec.pct ?? 0.5));
          if (wGap >= 0.25) { score += 3; signals.push(`📊 Massive record gap (${(wGap*100).toFixed(0)}% — talent mismatch)`); }
          else if (wGap >= 0.15) { score += 1; signals.push(`📊 Clear record gap (${(wGap*100).toFixed(0)}%)`); }
        }
        if (hSch?.isBackToBack && !aSch?.isBackToBack) { score += 1; signals.push(`😴 ${game.home} on B2B vs rested ${game.away}`); }
        if (aSch?.isBackToBack && !hSch?.isBackToBack) { score += 1; signals.push(`😴 ${game.away} on B2B vs rested ${game.home}`); }
        const level = score >= 7 ? "HIGH" : score >= 4 ? "ELEVATED" : score >= 2 ? "POSSIBLE" : "LOW";
        return { level, score, summary: signals.length ? signals.join("\n") : "No significant blowout signals." };
      };

      const blowoutData = buildBlowoutAnalysis(homeTeamStats, awayTeamStats, homeRecord, awayRecord, homeSchedule, awaySchedule);
      const matchupExploits = buildMatchupExploits(homeTeamStats, awayTeamStats, homePlayerStats, awayPlayerStats, homeUnavailable, awayUnavailable);
      const clutchLine = (abbrev, ts) => {
        const c = ts?.clutch;
        if (!c || c.wins == null || c.losses == null) return null;
        const t = c.wins + c.losses, pct = t > 0 ? (c.wins/t*100).toFixed(0) : "?";
        return `${abbrev}: ${c.wins}-${c.losses} close games (${pct}%) — ${c.wins/t >= 0.6 ? "CLUTCH 💪" : c.wins/t <= 0.4 ? "choke risk ⚠️" : "avg clutch"}`;
      };

      const prompt = `You are an elite NBA analytics AI. Use EVERY section below to make the most accurate game prediction and blowout assessment possible.

Game: ${awayTeam} @ ${homeTeam}
Status: ${game.status}
${game.score ? `Current Score: ${game.away} ${awayScore} - ${homeScore} ${game.home}` : ""}
${game.quarter ? `Quarter: ${game.quarter}, Clock: ${game.clock}` : ""}
${homeProb ? `ESPN Win Probability: ${game.home} ${homeProb?.toFixed(1)}% / ${game.away} ${awayProb?.toFixed(1)}%` : ""}
${isClosed ? `Final: ${game.away} ${awayScore} - ${homeScore} ${game.home}` : ""}

=== TEAM STRENGTH (40%) ===
${buildStrength(game.home, homeRecord, true)}
${buildStrength(game.away, awayRecord, false)}
${dominanceNote}

=== RECENT FORM (15%) ===
${buildFormSummary(homeSchedule, game.home)}
${buildFormSummary(awaySchedule, game.away)}
RULE: 4+ win streak = +3 pts. 4+ loss streak = −3 pts.

=== REST & FATIGUE (8%) ===
${buildRestSummary(homeSchedule, game.home)}
${buildRestSummary(awaySchedule, game.away)}

=== STAR POWER & INJURIES (12%) ===
${buildStarPower(game.home, homePlayerStats, homeUnavailable)}
${buildStarPower(game.away, awayPlayerStats, awayUnavailable)}
RULE: 20+ PPG star OUT = −8 to −12 pts. 15-19 PPG OUT = −4 to −7 pts.

=== DEFENSIVE PROFILE (10%) ===
${buildDefenseProfile(game.home, homeTeamStats)}
${buildDefenseProfile(game.away, awayTeamStats)}

=== OFFENSIVE PROFILE (5%) ===
${buildOffenseProfile(game.home, homeTeamStats)}
${buildOffenseProfile(game.away, awayTeamStats)}

=== PACE MATCHUP (3%) ===
${homeTeamStats?.pace || awayTeamStats?.pace ? `${game.home} pace: ${fmt1(homeTeamStats?.pace) || "N/A"} | ${game.away} pace: ${fmt1(awayTeamStats?.pace) || "N/A"}` : "Pace data unavailable"}

=== CLUTCH RECORD (2%) ===
${clutchLine(game.home, homeTeamStats) || `${game.home}: clutch data unavailable`}
${clutchLine(game.away, awayTeamStats) || `${game.away}: clutch data unavailable`}

=== MATCHUP EXPLOITATION ANALYSIS — WHO ABUSES WHAT ===
This section cross-references each team's offensive strengths against the opponent's specific defensive weaknesses.
Use these to adjust projected scores AND player props accordingly.

${matchupExploits}

EXPLOITATION RULES:
- If a team has a 3PT EXPLOIT: add 6-10 pts to their projected score AND boost named shooter props by 3-5 pts
- If a team has a PAINT EXPLOIT: add 5-8 pts to their projected score AND boost named big/wing props by 3-4 pts
- If a SHUTDOWN is flagged: reduce the affected team's projected score by 4-8 pts in that zone
- If a TURNOVER TRAP is flagged: add 4-6 transition pts for the forcing team
- A team can have BOTH an exploit AND face a shutdown — net them out in the final score

=== BLOWOUT INDICATORS (5%) ===
Pre-calculated blowout score: ${blowoutData.score}/10 — Level: ${blowoutData.level}
${blowoutData.summary}
BLOWOUT RULES: HIGH(7+)=18-30pt margin. ELEVATED(4-6)=10-18pt. POSSIBLE(2-3)=6-12pt. LOW(0-1)=under 8pt.

=== AVAILABLE PLAYERS (only these will play) ===
${game.home}: ${formatPlayers(homeAvailable)}
${game.away}: ${formatPlayers(awayAvailable)}

=== UNAVAILABLE (will NOT play) ===
${game.home}: ${formatUnavailable(homeUnavailable)}
${game.away}: ${formatUnavailable(awayUnavailable)}

HARD RULES:
1. Season record = 40% of pick. Always your baseline.
2. Hot team (4+ wins) beats cold team in close matchups.
3. Back-to-back = −3 to −4 pts. Well-rested = +1 to +2 pts.
4. APPLY all exploitation adjustments to the predicted score — they are pre-calculated for you.
5. Name specific players in exploits — don't be generic.
6. Home court = +2 to +3 pts only. Never overrides a 10+ win-rate gap.
7. ONLY use players from AVAILABLE PLAYERS. Roster above is ground truth.

Respond ONLY with a valid JSON object (no markdown):
{
  "winner": "${game.home} or ${game.away} abbreviation",
  "winnerName": "full team name",
  "predictedScore": { "${game.home}": number, "${game.away}": number },
  "confidence": number (50-95),
  "analysis": "3 sentences: (1) record/strength edge, (2) which specific exploit changes the score most, (3) form/rest/injury net adjustment",
  "keyFactor": "the single most decisive factor — name the specific matchup or player",
  "injuryImpact": "describe impact of any missing 15+ PPG player with point estimate, or 'No significant injury impact'",
  "exploits": [
    { "team": "abbrev of team who benefits", "zone": "3PT|PAINT|MID|TURNOVER", "type": "EXPLOIT|SHUTDOWN", "players": ["specific player names who benefit"], "projectedBonus": number, "description": "one sentence" }
  ],
  "blowoutRisk": {
    "level": "HIGH|ELEVATED|POSSIBLE|LOW",
    "favoredTeam": "${game.home} or ${game.away} abbreviation",
    "projectedMargin": number,
    "drivers": ["2-3 specific reasons"],
    "gameScript": "one sentence on how quarters likely play out"
  },
  "playerProps": [
    { "player": "name", "team": "abbrev", "points": number, "rebounds": number, "assists": number, "plusMinus": number, "confidence": number, "garbageTimeRisk": "HIGH|MEDIUM|LOW", "garbageTimeNote": "reason or empty" }
  ],
  "plusMinusLeaders": [
    { "player": "name", "team": "abbrev", "plusMinus": number, "reason": "brief reason" }
  ],
  "depthChart": {
    "${game.home}": [{ "player": "name", "position": "PG/SG/SF/PF/C", "minutes": number, "role": "Starter|Rotation|Bench", "usage": number, "note": "brief note" }],
    "${game.away}": [{ "player": "name", "position": "PG/SG/SF/PF/C", "minutes": number, "role": "Starter|Rotation|Bench", "usage": number, "note": "brief note" }]
  },
  "betBuilder": {
    "lowRisk":    { "label": "Safe Parlay",     "legs": [{ "player": "full name", "team": "abbrev", "stat": "points|rebounds|assists", "line": number, "direction": "over|under", "confidence": number, "reason": "avg X, line is Y% of avg, hitRate Z% in L15" }], "estimatedOdds": number, "overallConfidence": number, "tip": "one sentence" },
    "mediumRisk": { "label": "Value Parlay",    "legs": [{ "player": "full name", "team": "abbrev", "stat": "points|rebounds|assists", "line": number, "direction": "over|under", "confidence": number, "reason": "avg X, line is Y% of avg, hitRate Z% in L15" }], "estimatedOdds": number, "overallConfidence": number, "tip": "one sentence" },
    "highRisk":   { "label": "Longshot Parlay", "legs": [{ "player": "full name", "team": "abbrev", "stat": "points|rebounds|assists", "line": number, "direction": "over|under", "confidence": number, "reason": "avg X, line is Y% of avg, hitRate Z% in L15" }], "estimatedOdds": number, "overallConfidence": number, "tip": "one sentence" },
    "firstQuarter": { "label": "1Q Parlay", "legs": [{ "player": "full name", "team": "abbrev", "stat": "q1pts|q1reb|q1ast", "line": number, "direction": "over|under", "confidence": number, "reason": "Q1 avg X, line is Y, hitRate Z% in L15" }], "estimatedOdds": number, "overallConfidence": number, "tip": "one sentence" }
  }
}

4 props (2 per team, AVAILABLE only). 3 plus/minus leaders. Depth: 8 players/team (5 starters + 3 rotation, AVAILABLE only). Starters 28-36 min. Rotation 10-22 min.
GARBAGE TIME: playerProps garbageTimeRisk=HIGH if projectedMargin 15+, MEDIUM if 8-14, LOW otherwise. Reduce stats and explain.

=== PLAYER PROP INTELLIGENCE (L15 game log data — use for BET BUILDER lines) ===
${(() => {
  const formatPlayerLogs = (logs, abbrev) => {
    if (!logs || logs.length === 0) return `${abbrev}: No game log data`;
    return logs.slice(0, 5).map(p => {
      const l = p.lines;
      const q1 = l.safeQ1Pts != null ? ` | Q1pts avg ${p.avgs.q1pts} → safe ${l.safeQ1Pts}(.5) ${l.safeQ1PtsHit}%hit` : "";
      return `${p.name} (${p.position}, ${p.gamesPlayed}G): avg ${p.avgs.pts}pts/${p.avgs.reb}reb/${p.avgs.ast}ast | SAFE line: ${l.safePts}pts(${l.safePtsHit}%hit) ${l.safeReb}reb(${l.safeRebHit}%hit) | VALUE: ${l.valuePts}pts(${l.valuePtsHit}%hit) | RISKY: ${l.riskyPts}pts(${l.riskyPtsHit}%hit)${q1}`;
    }).join("\n");
  };
  return `${game.home}:\n${formatPlayerLogs(homeGameLogs, game.home)}\n${game.away}:\n${formatPlayerLogs(awayGameLogs, game.away)}`;
})()}

USE THESE PRE-CALCULATED LINES for bet builder — they are based on actual L15 game results with real hit rates. Prefer lines with 70%+ hit rate for safe tier, 55%+ for value tier.

=== BET BUILDER — MANDATORY RULES ===
STEP 1 — ELIGIBLE PLAYERS ONLY:
- ONLY use players listed in AVAILABLE PLAYERS above. Zero exceptions.
- NEVER use anyone from UNAVAILABLE list.

STEP 2 — STAT ROLE CHECK (before assigning any leg):
- POINTS: any available player with PPG shown above. Most reliable stat — prefer this.
- REBOUNDS: only players with RPG >= 5.0. Only use if player is a primary rebounder (C or PF).
- ASSISTS: only players with APG >= 5.0. VERY VOLATILE — only use in mediumRisk and highRisk, NEVER in lowRisk.
- Centers/PF position → NEVER assign assists legs. EVER.
- NEVER derive a line from blocks, steals, or 3PM stats.
- MINIMUM: points line >= 8, rebounds line >= 3, assists line >= 2.

STEP 3 — LINE CALCULATION (ALL lines MUST end in .5 — sportsbooks use half-points to avoid pushes):
Formula: FLOOR(player_avg * multiplier) - 0.5  → always produces X.5 format

lowRisk line = FLOOR(player_avg * 0.60) - 0.5
  Example: avg 32ppg → FLOOR(19.2) - 0.5 = 18.5
  Example: avg 25ppg → FLOOR(15.0) - 0.5 = 14.5
  Example: avg 20ppg → FLOOR(12.0) - 0.5 = 11.5
  Example: avg 10rpg → FLOOR(6.0)  - 0.5 = 5.5

mediumRisk line = FLOOR(player_avg * 0.85) + 0.5
  Example: avg 32ppg → FLOOR(27.2) + 0.5 = 27.5
  Example: avg 20ppg → FLOOR(17.0) + 0.5 = 17.5

highRisk line = FLOOR(player_avg * 1.08) + 0.5
  Example: avg 32ppg → FLOOR(34.5) + 0.5 = 34.5
  Example: avg 20ppg → FLOOR(21.6) + 0.5 = 21.5

CRITICAL: Every single line number must end in .5 (e.g. 14.5, 18.5, 27.5). Never use whole numbers like 15, 19, 27.

STEP 4 — USAGE BOOST:
If a player averaging 15+ PPG is UNAVAILABLE, their positional replacement line += 3pts (mention in reason).

STEP 5 — TIERS:
lowRisk: exactly 3 legs. POINTS ONLY. Use the pre-calculated "SAFE line" from PLAYER PROP INTELLIGENCE above — those lines already have real hit rates. Pick legs where safePtsHit >= 70%. conf 75-88 each. estimatedOdds 3-5. overallConfidence 68-78.
mediumRisk: exactly 5 legs. Mix PTS and REB. Use "VALUE line" from PLAYER PROP INTELLIGENCE. Target valuePtsHit >= 55%. Can include 1 AST leg max if APG >= 5. conf 60-72 each. estimatedOdds 8-18. overallConfidence 45-55.
highRisk: exactly 7 legs. Mix all stats. Use "RISKY line" from PLAYER PROP INTELLIGENCE. Target riskyPtsHit >= 35%. Available players only. conf 48-62 each. estimatedOdds 35-100. overallConfidence 22-33.
firstQuarter: exactly 3-4 legs. Use Q1pts data from PLAYER PROP INTELLIGENCE (safeQ1Pts lines). Only include players who have Q1 data (safeQ1PtsHit shown). stat field must be "q1pts", "q1reb", or "q1ast". Lines end in .5. estimatedOdds 4-10. overallConfidence 55-70.

NEVER repeat same player more than twice across all four tiers combined.
CRITICAL: Use the pre-calculated lines from PLAYER PROP INTELLIGENCE — they are based on real game results. Only override if injury/matchup context strongly suggests otherwise.
In reason field: always write "avg Xppg, line Ypts, hitRate Z% in L15 games".
DATA QUALITY: if playerStats show 0 PPG for a player, skip them.
${isClosed ? "Game is final — post-game analysis mode." : ""}`;

      // ── AI call: Groq primary → Gemini fallback ────────────────────────────
      const SYSTEM_MSG = "You are an elite NBA analytics AI. Respond ONLY with a valid JSON object — no preamble, no markdown. For exploits: name actual players from AVAILABLE PLAYERS list who will benefit. Apply all exploitation point adjustments to predictedScore. ONLY use players from AVAILABLE PLAYERS — never hallucinate.";

      const callGroq = async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}` },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              max_tokens: 4096,
              messages: [{ role: "system", content: SYSTEM_MSG }, { role: "user", content: prompt }]
            }),
          });
          if (res.status === 429) { console.warn(`Groq 429 attempt ${attempt+1}`); continue; }
          const d = await res.json();
          const t = d.choices?.[0]?.message?.content;
          if (t) return t;
        }
        return null;
      };

      const callGemini = async () => {
        const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;
        if (!GEMINI_KEY) return null;
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: SYSTEM_MSG + "\n\n" + prompt }] }],
                generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
              }),
            }
          );
          const d = await res.json();
          return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
        } catch { return null; }
      };

      let text = await callGroq();
      if (!text) {
        console.warn("Groq failed — falling back to Gemini...");
        text = await callGemini();
      }
      if (!text) {
        const hasGemini = !!import.meta.env.VITE_GEMINI_API_KEY;
        throw new Error(hasGemini
          ? "Both Groq and Gemini rate limited. Please wait 30 seconds and retry."
          : "Groq rate limited. Add VITE_GEMINI_API_KEY to your .env for automatic fallback.");
      }
      const clean = text.replace(/```json|```/g, "").trim();
      try {
        const parsed = JSON.parse(clean);
        setPrediction(parsed);
        if (parsed.betBuilder) {
          const history = loadHistory();
          history[game.id] = {
            gameId: game.id,
            gameLabel: `${game.teams[game.away]?.name} @ ${game.teams[game.home]?.name}`,
            homeAbbrev: game.home, awayAbbrev: game.away,
            date: new Date().toISOString(),
            status: game.status,
            betBuilder: parsed.betBuilder,
            results: history[game.id]?.results || null,
          };
          saveHistory(history);
        }
      } catch {
        setPrediction({ error: "AI returned an invalid response. Please retry." });
      }
    } catch (err) {
      console.error("Prediction error:", err);
      setPrediction({ error: err.message || "Failed to load prediction. Please try again." });
    }
    setLoading(false);
  }, [game]);

  useEffect(() => { fetchPrediction(); }, [fetchPrediction]);

  const homeInjured = rosters.home.filter(p => p.status !== "Active");
  const awayInjured = rosters.away.filter(p => p.status !== "Active");
  const totalInjuries = homeInjured.length + awayInjured.length;
  const homeRecord = standings[game.home];
  const awayRecord = standings[game.away];

  const tabs = ["game", "depth", "injuries", "props", "plus-minus", "bet-builder"];
  const tabLabels = { game: "Prediction", depth: "⏱ Minutes", injuries: "🩹 Injuries", props: "Props", "plus-minus": "+/−", "bet-builder": "🎰 Builder" };

  return (
    <div style={{ background: "#0f172a", border: "1.5px solid #1e293b", borderRadius: 16, padding: 24, height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>AI PREDICTION</div>
          <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 18 }}>{awayTeam} @ {homeTeam}</div>
          <div style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>{formatDate(game.start_time)} · {formatTime(game.start_time)}</div>
        </div>
        <button onClick={onClose} style={{ background: "#1e293b", border: "none", color: "#64748b", width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0a111e", borderRadius: 8, padding: 4 }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "7px 4px", background: activeTab === tab ? "#1e293b" : "transparent", border: "none", borderRadius: 6, color: activeTab === tab ? "#f1f5f9" : "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s", position: "relative" }}>
            {tabLabels[tab]}
            {tab === "injuries" && totalInjuries > 0 && !loading && (
              <span style={{ position: "absolute", top: 2, right: 2, background: "#ef4444", color: "#fff", borderRadius: 99, width: 14, height: 14, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{totalInjuries}</span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ color: "#3b82f6", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Analyzing matchup...</div>
          <div style={{ color: "#334155", fontSize: 12 }}>Fetching rosters · Checking injuries · Running AI</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 16 }}>
            {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", animation: `bounce 0.8s ${i * 0.15}s infinite` }} />)}
          </div>
        </div>
      )}

      {!loading && prediction?.error && (
        <div style={{ color: "#ef4444", textAlign: "center", padding: 24, fontSize: 13 }}>
          {prediction.error}
          <div><button onClick={fetchPrediction} style={{ marginTop: 12, background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Retry</button></div>
        </div>
      )}

      {/* GAME TAB */}
      {!loading && prediction && !prediction.error && activeTab === "game" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Record comparison cards */}
          {(homeRecord || awayRecord) && (
            <div style={{ display: "flex", gap: 8 }}>
              {[{ abbrev: game.home, record: homeRecord, label: "HOME" }, { abbrev: game.away, record: awayRecord, label: "AWAY" }].map(({ abbrev, record, label }) => {
                const tc = TEAM_COLORS[abbrev];
                const pct = record?.pct ?? 0;
                const barColor = pct >= 0.6 ? "#22c55e" : pct >= 0.45 ? "#f59e0b" : "#ef4444";
                return (
                  <div key={abbrev} style={{ flex: 1, background: "#0a111e", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 4, background: tc?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 800, color: tc?.accent || "#fff" }}>{abbrev}</div>
                      <span style={{ color: "#475569", fontSize: 9, fontWeight: 700 }}>{label}</span>
                      {record?.confRank && <span style={{ marginLeft: "auto", color: "#334155", fontSize: 9 }}>#{record.confRank} conf</span>}
                    </div>
                    <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 16, fontFamily: "'IBM Plex Mono', monospace" }}>{record ? `${record.wins}-${record.losses}` : "—"}</div>
                    <div style={{ height: 3, borderRadius: 99, background: "#0f172a", overflow: "hidden", marginTop: 6 }}>
                      <div style={{ width: `${pct * 100}%`, height: "100%", background: barColor, borderRadius: 99 }} />
                    </div>
                    {record && <div style={{ color: "#475569", fontSize: 9, marginTop: 4 }}>{record.homeRecord} home · {record.awayRecord} away</div>}
                    {record?.last10 && <div style={{ color: "#334155", fontSize: 9, marginTop: 2 }}>L10: {record.last10}</div>}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ background: "#0a111e", border: `1.5px solid ${(TEAM_COLORS[prediction.winner]?.accent || "#3b82f6") + "44"}`, borderRadius: 12, padding: 18 }}>
            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>PREDICTED WINNER</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: TEAM_COLORS[prediction.winner]?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: TEAM_COLORS[prediction.winner]?.accent || "#fff" }}>
                {prediction.winner}
              </div>
              <div>
                <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 17 }}>{prediction.winnerName}</div>
                <ConfidenceBadge pct={prediction.confidence} />
              </div>
            </div>
            {prediction.predictedScore && (
              <div style={{ display: "flex", gap: 12, marginTop: 14, fontFamily: "'IBM Plex Mono', monospace" }}>
                {[game.away, game.home].map(team => (
                  <div key={team} style={{ flex: 1, background: "#0f172a", borderRadius: 8, padding: "10px 14px", border: `1px solid ${prediction.winner === team ? TEAM_COLORS[team]?.accent + "66" : "#1e293b"}` }}>
                    <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>{game.teams[team]?.name?.split(" ").slice(-1)[0]}</div>
                    <div style={{ color: prediction.winner === team ? "#f1f5f9" : "#64748b", fontSize: 28, fontWeight: 800 }}>{prediction.predictedScore[team]}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {prediction.injuryImpact && prediction.injuryImpact !== "No significant injury impact" && (
            <div style={{ background: "#ef444411", borderRadius: 12, padding: 14, border: "1px solid #ef444433", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 16 }}>🩹</span>
              <div>
                <div style={{ color: "#ef4444", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>INJURY IMPACT</div>
                <div style={{ color: "#fca5a5", fontSize: 12 }}>{prediction.injuryImpact}</div>
              </div>
            </div>
          )}

          <div style={{ background: "#0a111e", borderRadius: 12, padding: 16 }}>
            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>ANALYSIS</div>
            <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.7, margin: 0 }}>{prediction.analysis}</p>
          </div>

          <div style={{ background: "#0a111e", borderRadius: 12, padding: 16, border: "1px solid #fbbf2422" }}>
            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>KEY FACTOR</div>
            <div style={{ color: "#fbbf24", fontSize: 13, fontWeight: 600 }}>⚡ {prediction.keyFactor}</div>
          </div>

          {/* MATCHUP EXPLOITS CARD */}
          {(prediction.exploits || []).length > 0 && (
            <div style={{ background: "#0a111e", borderRadius: 12, padding: 16, border: "1px solid #8b5cf622" }}>
              <div style={{ color: "#8b5cf6", fontSize: 10, fontWeight: 800, letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" }}>🔬 Matchup Exploits</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {prediction.exploits.map((ex, i) => {
                  const isExploit = ex.type === "EXPLOIT";
                  const zoneColors = { "3PT": "#3b82f6", PAINT: "#f97316", MID: "#a855f7", TURNOVER: "#ef4444" };
                  const zoneColor = zoneColors[ex.zone] || "#64748b";
                  const tc = TEAM_COLORS[ex.team];
                  return (
                    <div key={i} style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px", border: `1px solid ${isExploit ? zoneColor + "44" : "#22c55e33"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 5, background: tc?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: tc?.accent || "#fff", flexShrink: 0 }}>{ex.team}</div>
                        <span style={{ background: zoneColor + "22", color: zoneColor, border: `1px solid ${zoneColor}44`, borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>{ex.zone}</span>
                        <span style={{ background: isExploit ? "#ef444422" : "#22c55e22", color: isExploit ? "#ef4444" : "#22c55e", border: `1px solid ${isExploit ? "#ef444433" : "#22c55e33"}`, borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{isExploit ? "EXPLOIT" : "SHUTDOWN"}</span>
                        {ex.projectedBonus != null && (
                          <span style={{ marginLeft: "auto", color: isExploit ? "#22c55e" : "#ef4444", fontSize: 12, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace" }}>{isExploit ? "+" : "−"}{Math.abs(ex.projectedBonus)} pts</span>
                        )}
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: ex.players?.length ? 8 : 0 }}>{ex.description}</div>
                      {(ex.players || []).length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {ex.players.map((name, j) => (
                            <span key={j} style={{ background: zoneColor + "15", color: zoneColor, border: `1px solid ${zoneColor}33`, borderRadius: 99, padding: "2px 8px", fontSize: 10, fontWeight: 600 }}>{name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* BLOWOUT RISK CARD */}
          {prediction.blowoutRisk && (() => {
            const br = prediction.blowoutRisk;
            const cfgs = {
              HIGH:     { bg: "#ef444418", border: "#ef444440", badge: "#ef4444", label: "💥 HIGH BLOWOUT RISK", text: "#fca5a5" },
              ELEVATED: { bg: "#f9731618", border: "#f9731640", badge: "#f97316", label: "🔥 ELEVATED BLOWOUT RISK", text: "#fdba74" },
              POSSIBLE: { bg: "#eab30818", border: "#eab30840", badge: "#eab308", label: "⚡ BLOWOUT POSSIBLE", text: "#fde047" },
              LOW:      { bg: "#22c55e11", border: "#22c55e30", badge: "#22c55e", label: "🤝 COMPETITIVE GAME EXPECTED", text: "#86efac" },
            };
            const cfg = cfgs[br.level] || cfgs.LOW;
            const shortName = br.favoredTeam === game.home
              ? game.teams[game.home]?.name?.split(" ").slice(-1)[0]
              : game.teams[game.away]?.name?.split(" ").slice(-1)[0];
            return (
              <div style={{ background: cfg.bg, borderRadius: 12, padding: 16, border: `1px solid ${cfg.border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ color: cfg.badge, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>{cfg.label}</div>
                  <span style={{ background: cfg.badge + "22", color: cfg.badge, border: `1px solid ${cfg.badge}44`, borderRadius: 6, padding: "2px 10px", fontSize: 13, fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace" }}>
                    {shortName} +{br.projectedMargin}
                  </span>
                </div>
                {br.gameScript && <div style={{ color: cfg.text, fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>📽️ {br.gameScript}</div>}
                {(br.drivers || []).map((d, i) => (
                  <div key={i} style={{ color: "#64748b", fontSize: 11, display: "flex", gap: 6, marginBottom: 3 }}>
                    <span style={{ color: cfg.badge }}>›</span><span>{d}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          <button onClick={fetchPrediction} style={{ background: "transparent", border: "1px solid #1e293b", color: "#475569", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
            ↻ Regenerate Prediction
          </button>
        </div>
      )}

      {/* DEPTH CHART TAB */}
      {!loading && prediction && !prediction.error && activeTab === "depth" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ color: "#64748b", fontSize: 11, marginBottom: -8 }}>Projected minutes & usage for today's game</div>
          {[game.home, game.away].map(teamAbbrev => {
            const tc = TEAM_COLORS[teamAbbrev];
            const teamName = game.teams[teamAbbrev]?.name;
            const players = prediction.depthChart?.[teamAbbrev] || [];
            const starters = players.filter(p => p.role === "Starter");
            const rotation = players.filter(p => p.role !== "Starter");
            const maxMinutes = Math.max(...players.map(p => p.minutes), 1);
            return (
              <div key={teamAbbrev}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: tc?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: tc?.accent || "#fff" }}>{teamAbbrev}</div>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{teamName}</span>
                  <span style={{ color: "#334155", fontSize: 11, marginLeft: "auto" }}>MIN · USG%</span>
                </div>
                {starters.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ color: "#475569", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>STARTERS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {starters.map((p, i) => <DepthRow key={i} player={p} tc={tc} maxMinutes={maxMinutes} />)}
                    </div>
                  </div>
                )}
                {rotation.length > 0 && (
                  <div>
                    <div style={{ color: "#334155", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>ROTATION</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {rotation.map((p, i) => <DepthRow key={i} player={p} tc={tc} maxMinutes={maxMinutes} />)}
                    </div>
                  </div>
                )}
                {players.length === 0 && <div style={{ color: "#334155", fontSize: 12, padding: "12px 0" }}>No depth data available</div>}
              </div>
            );
          })}
          <div style={{ color: "#1e293b", fontSize: 11, textAlign: "center" }}>AI projected · Based on current roster & injury report</div>
        </div>
      )}

      {/* INJURIES TAB */}
      {!loading && activeTab === "injuries" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rosters.home.length === 0 && rosters.away.length === 0 ? (
            <div style={{ color: "#475569", textAlign: "center", padding: "30px 0", fontSize: 13 }}>Loading injury data...</div>
          ) : (
            <>
              {[
                { abbrev: game.home, name: homeTeam, players: rosters.home },
                { abbrev: game.away, name: awayTeam, players: rosters.away },
              ].map(({ abbrev, name, players }) => {
                const tc = TEAM_COLORS[abbrev];
                const injuredCount = players.filter(p => p.status !== "Active").length;
                return (
                  <div key={abbrev} style={{ background: "#0a111e", borderRadius: 12, padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: tc?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: tc?.accent || "#fff" }}>{abbrev}</div>
                      <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{name}</div>
                      <span style={{ marginLeft: "auto", background: injuredCount > 0 ? "#ef444422" : "#22c55e22", color: injuredCount > 0 ? "#ef4444" : "#22c55e", border: `1px solid ${injuredCount > 0 ? "#ef444433" : "#22c55e33"}`, borderRadius: 99, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                        {injuredCount} injured
                      </span>
                    </div>
                    <InjuryReport players={players} teamAbbrev={abbrev} />
                  </div>
                );
              })}
              <div style={{ color: "#334155", fontSize: 11, textAlign: "center" }}>Sourced from ESPN · Updates on each prediction load</div>
            </>
          )}
        </div>
      )}

      {/* PROPS TAB */}
      {!loading && prediction && !prediction.error && activeTab === "props" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Projected stat lines — adjusted for garbage time & usage</div>
          {(prediction.playerProps || []).map((p, i) => {
            const tc = TEAM_COLORS[p.team];
            const gt = p.garbageTimeRisk || "LOW";
            const gtColor = gt === "HIGH" ? "#ef4444" : gt === "MEDIUM" ? "#f97316" : "#22c55e";
            const gtIcon = gt === "HIGH" ? "🚨" : gt === "MEDIUM" ? "⚠️" : "✓";
            return (
              <div key={i} style={{ background: "#0a111e", borderRadius: 12, padding: 16, border: `1px solid ${gt !== "LOW" ? gtColor+"55" : (tc?.primary||"#1e293b")}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: tc?.primary||"#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: tc?.accent||"#fff" }}>{p.team}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{p.player}</div>
                    <ConfidenceBadge pct={p.confidence} />
                  </div>
                  <div style={{ background: gtColor+"18", border: `1px solid ${gtColor}44`, borderRadius: 6, padding: "3px 8px", fontSize: 9, fontWeight: 800, color: gtColor }}>{gtIcon} {gt}</div>
                </div>
                {gt !== "LOW" && p.garbageTimeNote && (
                  <div style={{ background: gtColor+"10", border: `1px solid ${gtColor}30`, borderRadius: 8, padding: "7px 10px", marginBottom: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                    <span style={{ color: gtColor, fontWeight: 700 }}>{gt} garbage time risk</span> — {p.garbageTimeNote}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  {[{ label: "PTS", val: p.points }, { label: "REB", val: p.rebounds }, { label: "AST", val: p.assists }, { label: "+/-", val: (p.plusMinus > 0 ? "+" : "") + p.plusMinus, highlight: p.plusMinus > 0 }].map(stat => (
                    <div key={stat.label} style={{ flex: 1, background: "#0f172a", borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
                      <div style={{ color: stat.highlight ? "#22c55e" : "#f1f5f9", fontWeight: 800, fontSize: 20, fontFamily: "'IBM Plex Mono', monospace" }}>{stat.val}</div>
                      <div style={{ color: "#475569", fontSize: 10, fontWeight: 700 }}>{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PLUS MINUS TAB */}
      {!loading && prediction && !prediction.error && activeTab === "plus-minus" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Expected impact players by +/−</div>
          {(prediction.plusMinusLeaders || []).map((p, i) => {
            const tc = TEAM_COLORS[p.team];
            const positive = p.plusMinus >= 0;
            return (
              <div key={i} style={{ background: "#0a111e", borderRadius: 12, padding: 16, border: `1px solid ${positive ? "#22c55e22" : "#ef444422"}`, display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ minWidth: 52, height: 52, borderRadius: 10, background: positive ? "#22c55e11" : "#ef444411", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: positive ? "#22c55e" : "#ef4444", fontFamily: "'IBM Plex Mono', monospace", border: `1.5px solid ${positive ? "#22c55e33" : "#ef444433"}` }}>
                  {positive ? "+" : ""}{p.plusMinus}
                </div>
                <div>
                  <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{p.player}</div>
                  <div style={{ display: "inline-block", background: tc?.primary || "#1e293b", color: tc?.accent || "#fff", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, marginBottom: 4 }}>{p.team}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>{p.reason}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* BET BUILDER TAB */}
      {!loading && prediction && !prediction.error && activeTab === "bet-builder" && (
        <BetBuilderTab prediction={prediction} game={game} />
      )}
    </div>
  );
}

export default function App() {
  const [gamesData, setGamesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState(null);
  const [activeSection, setActiveSection] = useState("upcoming");
  const [showResults, setShowResults] = useState(false);
  const [showPropsLab, setShowPropsLab] = useState(false);

  useEffect(() => {
    const loadGames = async () => {
      try {
        const res = await fetch(`${API}/games`);
        const data = await res.json();
        setGamesData(data);
      } catch (err) {
        console.error("Failed to load games:", err);
      } finally {
        setLoading(false);
      }
    };
    loadGames();
    const interval = setInterval(loadGames, 60000);
    return () => clearInterval(interval);
  }, []);

  const parsed = gamesData ? parseGames(gamesData) : { live: [], upcoming: [], recent: [] };
  const sections = [
    { id: "live", label: "🔴 Live", count: parsed.live.length },
    { id: "upcoming", label: "Upcoming", count: parsed.upcoming.length },
    { id: "recent", label: "Recent", count: parsed.recent.length },
  ];
  const activeGames = parsed[activeSection] || [];

  return (
    <div style={{ minHeight: "100vh", background: "#020817", color: "#f1f5f9", fontFamily: "'IBM Plex Sans', 'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700;800&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a111e; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
      `}</style>

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #0f172a", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#020817", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏀</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.5, fontFamily: "'IBM Plex Mono', monospace" }}>COURT<span style={{ color: "#3b82f6" }}>IQ</span></div>
            <div style={{ color: "#334155", fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>NBA PREDICTION ENGINE</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setShowPropsLab(true)}
            style={{ background: "#0a111e", border: "1px solid #7c3aed44", borderRadius: 8, padding: "6px 14px", color: "#7c3aed", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            🔬 Props Lab
          </button>
          <button onClick={() => setShowPropChecker(true)}
            style={{ background: "#0a111e", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 14px", color: "#8b5cf6", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            🔍 Check Prop
          </button>
          <button onClick={() => setShowResults(true)}
            style={{ background: "#0a111e", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 14px", color: "#3b82f6", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            📊 Results
          </button>
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 20, padding: "4px 12px", color: "#475569", fontSize: 11, fontWeight: 600 }}>
            AI · Live Rosters · Injuries
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 65px)" }}>
        <div style={{ width: selectedGame ? 340 : "100%", maxWidth: selectedGame ? 340 : "none", borderRight: "1px solid #0f172a", display: "flex", flexDirection: "column", overflow: "hidden", transition: "max-width 0.3s ease" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #0f172a", display: "flex", gap: 6 }}>
            {sections.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)} style={{ flex: 1, padding: "7px 8px", background: activeSection === s.id ? "#1e293b" : "transparent", border: activeSection === s.id ? "1px solid #334155" : "1px solid transparent", borderRadius: 8, color: activeSection === s.id ? "#f1f5f9" : "#475569", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                {s.label}
                <span style={{ background: activeSection === s.id ? "#3b82f6" : "#1e293b", color: activeSection === s.id ? "#fff" : "#475569", borderRadius: 99, padding: "0 5px", fontSize: 10, fontWeight: 800 }}>{s.count}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {loading && <div style={{ textAlign: "center", padding: "40px 0", color: "#334155" }}>Loading live data...</div>}
            {!loading && activeGames.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: "#334155", fontSize: 13 }}>No {activeSection} games right now</div>}
            {activeGames.map(game => <GameCard key={game.id} game={game} onClick={setSelectedGame} selected={selectedGame?.id === game.id} />)}
          </div>
        </div>
        {selectedGame && (
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <PredictionPanel game={selectedGame} onClose={() => setSelectedGame(null)} />
          </div>
        )}
      </div>
      {showPropsLab && <PropsLab onClose={() => setShowPropsLab(false)} />}
      {showResults && <ResultsDashboard onClose={() => setShowResults(false)} />}
    </div>
  );
}
