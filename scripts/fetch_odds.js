/**
 * scripts/fetch_odds.js
 * -----------------------
 * Pulls live 1X2 (h2h) odds for the Scottish Premiership from The Odds API
 * and writes odds.json — an array of {home, away, homeOdds, drawOdds,
 * awayOdds, bookmaker, commenceTime} used by index.html to sit alongside
 * the model's own predictions.
 *
 * Requires a free API key from https://the-odds-api.com (sign up, no
 * credit card needed for the free tier). Store it as a GitHub Actions
 * secret named ODDS_API_KEY — never commit it directly to the repo.
 *
 * Usage:
 *   ODDS_API_KEY=xxxx node scripts/fetch_odds.js odds.json
 */

const fs = require("fs");

const SPORT_KEY = "soccer_spl"; // The Odds API's key for Scottish Premiership
const REGIONS = "uk";
const MARKETS = "h2h";
const API_KEY = process.env.ODDS_API_KEY;
const API_URL = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds?regions=${REGIONS}&markets=${MARKETS}&oddsFormat=decimal&apiKey=${API_KEY}`;

async function main() {
  const outPath = process.argv[2] || "odds.json";

  if (!API_KEY) {
    console.warn("ODDS_API_KEY not set — skipping odds fetch. Add it as a GitHub Actions secret to enable this step.");
    if (!fs.existsSync(outPath)) fs.writeFileSync(outPath, "[]");
    return;
  }

  const res = await fetch(API_URL);
  if (!res.ok) {
    console.error(`The Odds API request failed: ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }
  const events = await res.json();

  const rows = events.map((ev) => {
    const homePrices = [];
    const drawPrices = [];
    const awayPrices = [];
    let bookmakerCount = 0;

    for (const bm of ev.bookmakers || []) {
      const h2h = (bm.markets || []).find((m) => m.key === "h2h");
      if (!h2h) continue;
      bookmakerCount++;
      for (const outcome of h2h.outcomes) {
        if (outcome.name === ev.home_team) homePrices.push(outcome.price);
        else if (outcome.name === ev.away_team) awayPrices.push(outcome.price);
        else drawPrices.push(outcome.price); // "Draw"
      }
    }

    const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

    return {
      home: ev.home_team,
      away: ev.away_team,
      commenceTime: ev.commence_time,
      homeOdds: avg(homePrices) ? Math.round(avg(homePrices) * 100) / 100 : null,
      drawOdds: avg(drawPrices) ? Math.round(avg(drawPrices) * 100) / 100 : null,
      awayOdds: avg(awayPrices) ? Math.round(avg(awayPrices) * 100) / 100 : null,
      bookmaker: `Average (${bookmakerCount} books)`,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`Wrote odds for ${rows.length} fixture(s) to ${outPath}.`);
}

main().catch((err) => {
  console.error("fetch_odds.js failed:", err.message);
  process.exit(1);
});
