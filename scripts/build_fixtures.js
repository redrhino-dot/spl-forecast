/**
 * scripts/build_fixtures.js
 * ---------------------------
 * Pulls the full season from TheSportsDB, finds every event with no score
 * yet (i.e. not played), and writes the earliest such round to fixtures.csv.
 * This is what index.html reads to know "the next unplayed gameweek."
 *
 * Usage:
 *   node scripts/build_fixtures.js fixtures.csv
 */

const fs = require("fs");

const LEAGUE_ID = "4330";
const SEASON = "2026-2027";
const API_KEY = "123";
const API_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsseason.php?id=${LEAGUE_ID}&s=${SEASON}`;

const NAME_MAP = {
  "Dundee Utd": "Dundee United",
  "Dundee FC": "Dundee",
  "St Mirren": "St. Mirren",
  "St Johnstone": "St. Johnstone",
  "Heart of Midlothian": "Hearts",
};
function normalizeTeam(name) {
  return NAME_MAP[name] || name;
}

async function main() {
  const outPath = process.argv[2] || "fixtures.csv";

  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`TheSportsDB request failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const events = data.events || [];

  const unplayed = events.filter(
    (ev) => ev.intHomeScore === null || ev.intHomeScore === undefined
  );

  if (unplayed.length === 0) {
    console.log("No unplayed fixtures found — season may be complete, or API returned no data.");
    return;
  }

  unplayed.sort((a, b) => new Date(a.dateEvent) - new Date(b.dateEvent));
  const nextRound = unplayed[0].intRound;
  const nextGameweek = unplayed.filter((ev) => ev.intRound === nextRound);

  const lines = ["Date,HomeTeam,AwayTeam,Round"];
  nextGameweek.forEach((ev) => {
    lines.push(
      `${ev.dateEvent},${normalizeTeam(ev.strHomeTeam)},${normalizeTeam(ev.strAwayTeam)},${ev.intRound}`
    );
  });

  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`Wrote ${nextGameweek.length} fixture(s) for round ${nextRound} to ${outPath}.`);
}

main().catch((err) => {
  console.error("build_fixtures.js failed:", err.message);
  process.exit(1);
});
