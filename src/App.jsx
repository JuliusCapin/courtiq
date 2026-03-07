import { useState, useEffect, useCallback } from "react";
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
};

async function fetchRosterWithInjuries(teamAbbrev) {
  try {
    const res = await fetch(`${API}/roster/${teamAbbrev}`);    const data = await res.json();
    return data.players || [];
  } catch (err) {
    console.error(`Error fetching roster for ${teamAbbrev}:`, err.message);
    return [];
  }
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
  const roleColor = isStarter ? tc?.accent || "#60a5fa" : "#334155";

  return (
    <div style={{ background: "#0a111e", borderRadius: 8, padding: "9px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {/* Position badge */}
        <div style={{ minWidth: 28, height: 20, borderRadius: 4, background: isStarter ? (tc?.primary || "#1e293b") : "#0f172a", border: `1px solid ${isStarter ? (tc?.accent || "#334155") + "66" : "#1e293b"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: isStarter ? (tc?.accent || "#94a3b8") : "#475569" }}>
          {player.position}
        </div>
        {/* Name */}
        <span style={{ color: isStarter ? "#f1f5f9" : "#94a3b8", fontWeight: isStarter ? 700 : 400, fontSize: 13, flex: 1 }}>
          {player.player}
        </span>
        {/* Minutes */}
        <span style={{ color: isStarter ? "#f1f5f9" : "#64748b", fontWeight: 700, fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", minWidth: 28, textAlign: "right" }}>
          {player.minutes}
        </span>
        {/* Usage */}
        <span style={{ color: "#475569", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", minWidth: 32, textAlign: "right" }}>
          {player.usage}%
        </span>
      </div>
      {/* Minutes bar */}
      <div style={{ height: 3, borderRadius: 99, background: "#0f172a", overflow: "hidden" }}>
        <div style={{ width: `${minPct}%`, height: "100%", background: isStarter ? (tc?.accent || "#3b82f6") : "#1e293b", borderRadius: 99, transition: "width 0.6s ease" }} />
      </div>
      {/* Note */}
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

function PredictionPanel({ game, onClose }) {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rosters, setRosters] = useState({ home: [], away: [] });
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

      const [homePlayers, awayPlayers] = await Promise.all([
        fetchRosterWithInjuries(game.home),
        fetchRosterWithInjuries(game.away),
      ]);
      setRosters({ home: homePlayers, away: awayPlayers });

      const formatForPrompt = (players) =>
        players.length > 0
          ? players.map(p => `${p.name} (${p.position})${p.status !== "Active" ? ` [${p.status}]` : ""}`).join(", ")
          : "unknown (use your knowledge)";

      const homeInjured = homePlayers.filter(p => p.status !== "Active").map(p => `${p.name} (${p.status})`);
      const awayInjured = awayPlayers.filter(p => p.status !== "Active").map(p => `${p.name} (${p.status})`);

      const prompt = `You are an NBA analytics expert AI. Generate detailed predictions using LIVE rosters and injury data from ESPN.

Game: ${awayTeam} @ ${homeTeam}
Status: ${game.status}
${game.score ? `Current Score: ${game.away} ${awayScore} - ${homeScore} ${game.home}` : ""}
${game.quarter ? `Quarter: ${game.quarter}, Clock: ${game.clock}` : ""}
${homeProb ? `Win Probability: ${game.home} ${homeProb?.toFixed(1)}% / ${game.away} ${awayProb?.toFixed(1)}%` : ""}
${isClosed ? `Final: ${game.away} ${awayScore} - ${homeScore} ${game.home}` : ""}

CURRENT ${game.home} ROSTER: ${formatForPrompt(homePlayers)}
CURRENT ${game.away} ROSTER: ${formatForPrompt(awayPlayers)}

INJURY REPORT:
${game.home}: ${homeInjured.length > 0 ? homeInjured.join(", ") : "None"}
${game.away}: ${awayInjured.length > 0 ? awayInjured.join(", ") : "None"}

RULES:
- Use ONLY players from rosters above
- Do NOT include Out/Doubtful players in player props
- Factor injuries into confidence score and analysis
- If a star player is Out, adjust win probability accordingly

Respond ONLY with a JSON object (no markdown):
{
  "winner": "${game.home} or ${game.away} abbreviation",
  "winnerName": "full team name",
  "predictedScore": { "${game.home}": number, "${game.away}": number },
  "confidence": number (50-95),
  "analysis": "2-3 sentence breakdown referencing current roster and injury impacts",
  "keyFactor": "single most important factor",
  "injuryImpact": "1 sentence on injury impact, or 'No significant injury impact'",
  "playerProps": [
    { "player": "name", "team": "abbrev", "points": number, "rebounds": number, "assists": number, "plusMinus": number, "confidence": number }
  ],
  "plusMinusLeaders": [
    { "player": "name", "team": "abbrev", "plusMinus": number, "reason": "brief reason" }
  ],
  "depthChart": {
    "${game.home}": [
      { "player": "name", "position": "PG/SG/SF/PF/C", "minutes": number, "role": "Starter|Rotation|Bench", "usage": number, "note": "brief note on role/matchup" }
    ],
    "${game.away}": [
      { "player": "name", "position": "PG/SG/SF/PF/C", "minutes": number, "role": "Starter|Rotation|Bench", "usage": number, "note": "brief note on role/matchup" }
    ]
  }
}

4 player props (2 per team, healthy only), 3 plus/minus leaders. For depthChart include 8 players per team (5 starters + 3 rotation players), sorted by projected minutes descending. Minutes should be realistic (starters 28-36 min, rotation 10-22 min, bench 5-12 min). Usage % is share of team possessions used (starters 18-32%, role players 8-16%). Skip Out/Doubtful players. ${isClosed ? "Game is final — provide post-game analysis." : ""}`;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      const clean = text.replace(/```json|```/g, "").trim();
      setPrediction(JSON.parse(clean));
    } catch {
      setPrediction({ error: "Failed to load prediction. Please try again." });
    }
    setLoading(false);
  }, [game]);

  useEffect(() => { fetchPrediction(); }, [fetchPrediction]);

  const homeInjured = rosters.home.filter(p => p.status !== "Active");
  const awayInjured = rosters.away.filter(p => p.status !== "Active");
  const totalInjuries = homeInjured.length + awayInjured.length;

  const tabs = ["game", "depth", "injuries", "props", "plus-minus"];
  const tabLabels = { game: "Prediction", depth: "⏱ Minutes", injuries: "🩹 Injuries", props: "Props", "plus-minus": "+/−" };

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
                {/* Team header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: tc?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: tc?.accent || "#fff" }}>{teamAbbrev}</div>
                  <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{teamName}</span>
                  <span style={{ color: "#334155", fontSize: 11, marginLeft: "auto" }}>MIN · USG%</span>
                </div>

                {/* Starters */}
                {starters.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ color: "#475569", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>STARTERS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {starters.map((p, i) => (
                        <DepthRow key={i} player={p} tc={tc} maxMinutes={maxMinutes} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Rotation */}
                {rotation.length > 0 && (
                  <div>
                    <div style={{ color: "#334155", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>ROTATION</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {rotation.map((p, i) => (
                        <DepthRow key={i} player={p} tc={tc} maxMinutes={maxMinutes} />
                      ))}
                    </div>
                  </div>
                )}

                {players.length === 0 && (
                  <div style={{ color: "#334155", fontSize: 12, padding: "12px 0" }}>No depth data available</div>
                )}
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
          <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Projected stat lines — healthy players only</div>
          {(prediction.playerProps || []).map((p, i) => {
            const tc = TEAM_COLORS[p.team];
            return (
              <div key={i} style={{ background: "#0a111e", borderRadius: 12, padding: 16, border: `1px solid ${tc?.primary || "#1e293b"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: tc?.primary || "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: tc?.accent || "#fff" }}>{p.team}</div>
                  <div>
                    <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{p.player}</div>
                    <ConfidenceBadge pct={p.confidence} />
                  </div>
                </div>
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
    </div>
  );
}

export default function App() {
  const [gamesData, setGamesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState(null);
  const [activeSection, setActiveSection] = useState("upcoming");

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
    // Refresh every 60 seconds for live score updates
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
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 20, padding: "4px 12px", color: "#475569", fontSize: 11, fontWeight: 600 }}>
          AI · Live Rosters · Injuries
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
    </div>
  );
} 