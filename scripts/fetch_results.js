/**
 * scripts/fetch_results.js
 * -------------------------
 * Pulls the full 2026-2027 Scottish Premiership season from TheSportsDB's
 * free API (league id 4330), filters to finished matches, normalizes team
 * names to match team_stats.csv conventions, and appends any results not
 * already present in results.csv.
 *
 * Requires Node 18+ (built-in global fetch). No external dependencies.
 *
 * Usage:
 *   node scripts/fetch_results.js results.csv
 */

const fs = require("fs");

const LEAGUE_ID = "4330"; // Scottish Premier League on TheSportsDB
const SEASON = "2026-2027";
const API_KEY = "123"; // TheSportsDB's published free/test key
const API_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsseason.php?id=${LEAGUE_ID}&s=${SEASON}`;

// Map TheSportsDB's team name spellings onto the names used in team_stats.csv
const NAME_MAP = {
  "Dundee Utd": "Dundee United",
  "Dundee United": "Dundee United",
  "Dundee FC": "Dundee",
  "Dundee": "Dundee",
  "St Mirren": "St. Mirren",
  "St. Mirren": "St. Mirren",
  "St Johnstone": "St. Johnstone",
  "St. Johnstone": "St. Johnstone",
  "Heart of Midlothian": "Hearts",
  "Hearts": "Hearts",
  "Hibernian": "Hibernian",
  "Rangers": "Rangers",
  "Celtic": "Celtic",
  "Aberdeen": "Aberdeen",
  "Motherwell": "Motherwell",
  "Falkirk": "Falkirk",
  "Kilmarnock": "Kilmarnock",
};

function normalizeTeam(name) {
  return NAME_MAP[name] || name;
}

function loadExistingResults(path) {
  if (!fs.existsSync(path)) return { header: "Date,HomeTeam,AwayTeam,HomeGoals,AwayGoals", rows: [], keys: new Set() };
  const lines = fs.readFileSync(path, "utf8").trim().split("\n");
  const header = lines[0];
  const rows = lines.slice(1);
  const keys = new Set(
    rows.map((line) => {
      const [date, home, away] = line.split(",");
      return `${date}|${home}|${away}`;
    })
  );
  return { header, rows, keys };
}

async function main() {
  const outPath = process.argv[2] || "results.csv";
  const { header, rows, keys } = loadExistingResults(outPath);

  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`TheSportsDB request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const events = data.events || [];

  const newRows = [];
  for (const ev of events) {
    const homeScore = ev.intHomeScore;
    const awayScore = ev.intAwayScore;
    if (homeScore === null || awayScore === null || homeScore === undefined || awayScore === undefined) {
      continue; // not played yet (or postponed with no score)
    }
    const home = normalizeTeam(ev.strHomeTeam);
    const away = normalizeTeam(ev.strAwayTeam);
    const date = ev.dateEvent; // YYYY-MM-DD
    const key = `${date}|${home}|${away}`;
    if (keys.has(key)) continue;
    newRows.push(`${date},${home},${away},${homeScore},${awayScore}`);
    keys.add(key);
  }

  if (newRows.length === 0) {
    console.log("No new finished results found — results.csv is already up to date.");
    return;
  }

  const allRows = rows.concat(newRows).sort((a, b) => a.split(",")[0].localeCompare(b.split(",")[0]));
  fs.writeFileSync(outPath, [header, ...allRows].join("\n") + "\n");
  console.log(`Appended ${newRows.length} new result(s) to ${outPath}.`);
}

main().catch((err) => {
  console.error("fetch_results.js failed:", err.message);
  process.exit(1);
});
