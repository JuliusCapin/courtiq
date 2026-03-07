const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://nba-predictor-five.vercel.app"
  ]
}));
// ESPN numeric team IDs
const ESPN_IDS = {
  ATL: 1, BOS: 2, BKN: 17, CHA: 30, CHI: 4, CLE: 5, DAL: 6, DEN: 7,
  DET: 8, GSW: 9, HOU: 10, IND: 11, LAC: 12, LAL: 13, MEM: 29,
  MIA: 14, MIL: 15, MIN: 16, NOP: 3, NYK: 18, OKC: 25, ORL: 19,
  PHI: 20, PHX: 21, POR: 22, SAC: 23, SAS: 24, TOR: 28, UTA: 26,
  WAS: 27,
};

app.get("/roster/:abbrev", async (req, res) => {
  const abbrev = req.params.abbrev.toUpperCase();
  const teamId = ESPN_IDS[abbrev];

  if (!teamId) {
    return res.status(400).json({ error: `Unknown team: ${abbrev}` });
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`ESPN returned ${response.status}`);
    }

    const data = await response.json();

    const players = (data.athletes || []).map((p) => ({
      name: p.fullName,
      position: p.position?.abbreviation || "?",
      jersey: p.jersey || "?",
      status: p.injuries?.[0]?.status || "Active",
    }));

    res.json({ team: abbrev, players });
  } catch (err) {
    console.error(`Error fetching roster for ${abbrev}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🏀 NBA Roster Proxy running on http://localhost:${PORT}`);
});
