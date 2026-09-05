/**
 * app.js
 * -------
 * Client-side glue for index.html on GitHub Pages. Fetches team_stats.csv,
 * fixtures.csv and odds.json (all served as static files from the repo
 * root), runs the SPFL predictor model on each fixture, merges in
 * bookmaker odds where available, and renders the comparison table.
 */

async function fetchText(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.text();
}

async function fetchJson(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\bfc\b/g, "")
    .replace(/heart of midlothian/g, "hearts")
    .replace(/dundee utd/g, "dundee united")
    .replace(/[^a-z ]/g, "")
    .trim();
}

function findOdds(oddsList, home, away) {
  if (!oddsList) return null;
  const nh = normalizeName(home);
  const na = normalizeName(away);
  return (
    oddsList.find((o) => normalizeName(o.home) === nh && normalizeName(o.away) === na) ||
    oddsList.find(
      (o) => normalizeName(o.home).includes(nh.split(" ")[0]) && normalizeName(o.away).includes(na.split(" ")[0])
    ) ||
    null
  );
}

function impliedPct(decimalOdds) {
  if (!decimalOdds) return null;
  return Math.round((1 / decimalOdds) * 1000) / 10;
}

// Underdog value flag: only fires when (a) the market already prices this
// outcome as a genuine underdog (decimal odds >= UNDERDOG_ODDS_THRESHOLD,
// i.e. market implied probability below ~40%), AND (b) the model rates
// that same outcome meaningfully more likely than the market does. This is
// the only signal a professional would actually consider staking on —
// a model liking an already-short favorite a little more than the market
// isn't an edge, it's noise.
const UNDERDOG_ODDS_THRESHOLD = 2.5;
const MIN_EDGE_PCT = 6;

function underdogEdge(oddsVal, modelPct, marketPct) {
  if (!oddsVal || modelPct == null || marketPct == null) return false;
  if (oddsVal < UNDERDOG_ODDS_THRESHOLD) return false;
  return modelPct - marketPct >= MIN_EDGE_PCT;
}

function renderCell(oddsVal, modelPct) {
  const implied = impliedPct(oddsVal);
  const oddsStr = oddsVal ? oddsVal.toFixed(2) : "—";
  const impliedStr = implied != null ? `${implied}%` : "—";
  const hasEdge = underdogEdge(oddsVal, modelPct, implied);
  const cls = hasEdge ? "value-underdog" : "";
  const flag = hasEdge ? ' <span class="value-tag">VALUE</span>' : "";
  return `<span class="odds-val">${oddsStr}</span><span class="implied ${cls}">${impliedStr}${flag}</span>`;
}

async function main() {
  const statusEl = document.getElementById("status");
  const tbody = document.querySelector("#fixtures-table tbody");
  const meta = document.getElementById("meta");

  try {
    const [statsCsv, fixturesCsv, odds] = await Promise.all([
      fetchText("team_stats.csv"),
      fetchText("fixtures.csv"),
      fetchJson("odds.json"),
    ]);

    const teams = SPFL.loadTeamStats(statsCsv);
    const ratings = SPFL.buildRatings(teams);
    const fixtures = SPFL.loadFixtures(fixturesCsv);

    if (fixtures.length === 0) {
      statusEl.textContent = "No upcoming fixtures found in fixtures.csv.";
      return;
    }

    const round = fixtures[0].round || "?";
    const firstDate = fixtures[0].date;
    meta.textContent = `Gameweek ${round} — kicking off ${firstDate}${odds ? "" : " (odds feed unavailable — showing model only)"}`;

    tbody.innerHTML = "";
    fixtures.forEach((fx) => {
      const pred = SPFL.predictMatch(fx.home, fx.away, ratings);
      const match = findOdds(odds, fx.home, fx.away);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fx.date}</td>
        <td class="fixture-cell"><strong>${fx.home}</strong> v ${fx.away}</td>
        <td class="score-cell">${pred ? pred.predictedScore : "—"}<span class="prob">${pred ? pred.predictedScoreProb + "%" : ""}</span></td>
        <td>${pred ? pred.homeWinPct + "%" : "—"}</td>
        <td>${pred ? pred.drawPct + "%" : "—"}</td>
        <td>${pred ? pred.awayWinPct + "%" : "—"}</td>
        <td>${renderCell(match && match.homeOdds, pred && pred.homeWinPct)}</td>
        <td>${renderCell(match && match.drawOdds, pred && pred.drawPct)}</td>
        <td>${renderCell(match && match.awayOdds, pred && pred.awayWinPct)}</td>
        <td>${match ? match.bookmaker : "—"}</td>
      `;
      tbody.appendChild(tr);
    });

    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = `Error loading data: ${err.message}`;
  }
}

main();
