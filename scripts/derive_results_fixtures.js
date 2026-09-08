/**
 * scripts/derive_results_fixtures.js
 * -------------------------------------
 * Splits data/all_events.json (produced by fetch_all_rounds.js) into:
 *   - results.csv   — every finished match (both scores present)
 *   - fixtures.csv   — the next unplayed date's fixture(s)
 *
 * A match counts as "finished" if it has both scores. A match with no
 * score but a kickoff more than STALE_HOURS in the past is treated as
 * "assume played, data not yet posted" and excluded from fixtures.csv too
 * — otherwise the app gets stuck re-showing an already-played gameweek
 * forever if TheSportsDB is slow to post that particular score (this is
 * exactly the bug that happened with gameweek 6). Anything caught by that
 * rule is logged as a gap so it's easy to spot and backfill results.csv
 * manually if TheSportsDB never posts it.
 *
 * Usage:
 *   node scripts/derive_results_fixtures.js data/all_events.json results.csv fixtures.csv
 */

const fs = require("fs");

const STALE_HOURS = 48;

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

function hasScore(ev) {
  const h = ev.intHomeScore;
  const a = ev.intAwayScore;
  return h !== null && h !== undefined && h !== "" && a !== null && a !== undefined && a !== "";
}

function hoursSince(dateStr) {
  const then = new Date(dateStr).getTime();
  return (Date.now() - then) / (1000 * 60 * 60);
}

function main() {
  const [, , inPath = "data/all_events.json", resultsPath = "results.csv", fixturesPath = "fixtures.csv"] = process.argv;

  const events = JSON.parse(fs.readFileSync(inPath, "utf8"));

  const finished = [];
  const unplayed = [];
  const staleGaps = [];

  for (const ev of events) {
    if (hasScore(ev)) {
      finished.push(ev);
    } else if (hoursSince(ev.dateEvent) > STALE_HOURS) {
      staleGaps.push(ev);
    } else {
      unplayed.push(ev);
    }
  }

  // --- results.csv ---
  const resultLines = ["Date,HomeTeam,AwayTeam,HomeGoals,AwayGoals"];
  finished
    .sort((a, b) => new Date(a.dateEvent) - new Date(b.dateEvent))
    .forEach((ev) => {
      resultLines.push(
        `${ev.dateEvent},${normalizeTeam(ev.strHomeTeam)},${normalizeTeam(ev.strAwayTeam)},${ev.intHomeScore},${ev.intAwayScore}`
      );
    });
  fs.writeFileSync(resultsPath, resultLines.join("\n") + "\n");
  console.log(`Wrote ${finished.length} finished result(s) to ${resultsPath}.`);

  // --- fixtures.csv: earliest remaining unplayed date, all matches that day ---
  if (unplayed.length === 0) {
    console.log("No upcoming unplayed fixtures found (season may be finished, or all remaining fixtures are stale/unposted).");
  } else {
    unplayed.sort((a, b) => new Date(a.dateEvent) - new Date(b.dateEvent));
    const nextDate = unplayed[0].dateEvent;
    const nextFixtures = unplayed.filter((ev) => ev.dateEvent === nextDate);

    const fixtureLines = ["Date,HomeTeam,AwayTeam,Round"];
    nextFixtures.forEach((ev) => {
      fixtureLines.push(
        `${ev.dateEvent},${normalizeTeam(ev.strHomeTeam)},${normalizeTeam(ev.strAwayTeam)},${ev.intRound}`
      );
    });
    fs.writeFileSync(fixturesPath, fixtureLines.join("\n") + "\n");
    console.log(`Wrote ${nextFixtures.length} fixture(s) for ${nextDate} to ${fixturesPath}.`);
  }

  // --- surface any results TheSportsDB hasn't posted yet ---
  if (staleGaps.length > 0) {
    console.warn(`\nWARNING: ${staleGaps.length} match(es) kicked off >${STALE_HOURS}h ago with no score posted yet:`);
    staleGaps.forEach((ev) => {
      console.warn(`  - ${ev.dateEvent}: ${normalizeTeam(ev.strHomeTeam)} v ${normalizeTeam(ev.strAwayTeam)} (round ${ev.intRound})`);
    });
    console.warn("These are excluded from both results.csv and fixtures.csv until TheSportsDB posts a score. Consider adding them to results.csv manually if this persists.\n");
  }
}

main();
