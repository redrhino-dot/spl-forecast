/**
 * scripts/fetch_all_rounds.js
 * -----------------------------
 * Pulls every round (1-40, to be safe — the Premiership split format runs
 * to 38) individually via eventsround.php, since eventsseason.php on the
 * free/registered key only returns a preview (round 1). Loops round by
 * round with a small delay between calls, merges everything into one
 * dataset, and writes data/all_events.json.
 *
 * This is the "once a day" pull — run it, then derive_results_fixtures.js
 * turns the raw dataset into results.csv and fixtures.csv.
 *
 * Usage:
 *   THESPORTSDB_KEY=xxxx node scripts/fetch_all_rounds.js data/all_events.json
 */

const fs = require("fs");
const path = require("path");

const LEAGUE_ID = "4330";
const SEASON = "2026-2027";
const API_KEY = process.env.THESPORTSDB_KEY || "123";
const MAX_ROUND = 40;
const DELAY_MS = 350; // be polite to the free tier

function roundUrl(round) {
  return `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsround.php?id=${LEAGUE_ID}&r=${round}&s=${SEASON}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRound(round) {
  const res = await fetch(roundUrl(round));
  if (!res.ok) {
    console.warn(`Round ${round}: HTTP ${res.status} — skipping.`);
    return [];
  }
  const data = await res.json();
  return data.events || [];
}

async function main() {
  const outPath = process.argv[2] || "data/all_events.json";
  const outDir = path.dirname(outPath);
  if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const allEvents = [];
  let emptyStreak = 0;

  for (let round = 1; round <= MAX_ROUND; round++) {
    const events = await fetchRound(round);
    if (events.length === 0) {
      emptyStreak++;
      // Stop early once we hit several consecutive empty rounds past round 10 —
      // avoids hammering the API once we're past the real end of the season.
      if (round > 10 && emptyStreak >= 4) {
        console.log(`Stopping at round ${round} after ${emptyStreak} consecutive empty rounds.`);
        break;
      }
    } else {
      emptyStreak = 0;
      allEvents.push(...events);
    }
    await sleep(DELAY_MS);
  }

  // Dedupe by idEvent in case a round is returned more than once
  const byId = new Map();
  for (const ev of allEvents) byId.set(ev.idEvent, ev);
  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(a.dateEvent) - new Date(b.dateEvent)
  );

  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`Wrote ${merged.length} events across the season to ${outPath}.`);
}

main().catch((err) => {
  console.error("fetch_all_rounds.js failed:", err.message);
  process.exit(1);
});
