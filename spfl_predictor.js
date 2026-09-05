/**
 * SPFL 2026/27 Predictor Scorecard
 * ---------------------------------
 * A self-contained, evolving match predictor for the Scottish Premiership.
 * Ranks every team on three axes — Form, Home/Away split, and Attack/Defense
 * strength (an xG proxy until a real xG feed is wired in) — then runs a
 * Poisson scoreline model to produce a full probability matrix per fixture.
 *
 * Usage:
 *   node spfl_predictor.js team_stats.csv "Motherwell" "Dundee United"
 *   node spfl_predictor.js team_stats.csv --all fixtures.csv
 *
 * No external dependencies — designed to slot into a GitHub Actions
 * workflow alongside your existing ESPN / football-data.org fetchers.
 */

const fs = require("fs");

// ---------- CSV loading ----------

function loadTeamStats(csvPath) {
  const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    return {
      team: row.Team,
      mp: +row.MP,
      w: +row.W,
      d: +row.D,
      l: +row.L,
      gf: +row.GF,
      ga: +row.GA,
      homeW: +row.HomeW,
      homeD: +row.HomeD,
      homeL: +row.HomeL,
      awayW: +row.AwayW,
      awayD: +row.AwayD,
      awayL: +row.AwayL,
      form6: row.Form6, // string oldest->newest, "-" = not played, W/D/L
    };
  });
}

// ---------- Rating engine ----------

// Recency-weighted form (oldest game weight 1.0, most recent weight 2.0)
const FORM_WEIGHTS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
const PTS = { W: 3, D: 1, L: 0 };

function formPct(form6) {
  const chars = form6.split("");
  let num = 0,
    den = 0;
  chars.forEach((c, i) => {
    if (c === "-") return;
    num += FORM_WEIGHTS[i] * PTS[c];
    den += FORM_WEIGHTS[i] * 3;
  });
  return den ? num / den : 0.5;
}

// Shrinks noisy early-season ratings toward league-average (1.0) until a
// team has played SAMPLE_TRUST_GAMES games. Prevents a 4-0 start (or a
// 0-4 start) from producing absurd Poisson lambdas in September.
const SAMPLE_TRUST_GAMES = 12;
function shrink(rawRatio, gamesPlayed) {
  const confidence = Math.min(gamesPlayed / SAMPLE_TRUST_GAMES, 1);
  return 1 + (rawRatio - 1) * confidence;
}

function buildRatings(teams) {
  const totalGoals = teams.reduce((s, t) => s + t.gf, 0);
  const totalGames = teams.reduce((s, t) => s + t.mp, 0);
  const leagueAvgGoals = totalGoals / totalGames; // goals per team per game

  const withForm = teams.map((t) => ({ ...t, formPct: formPct(t.form6) }));
  const leagueAvgForm =
    withForm.reduce((s, t) => s + t.formPct, 0) / withForm.length;

  return withForm.map((t) => {
    const rawAttack = t.gf / t.mp / leagueAvgGoals;
    const rawDefense = t.ga / t.mp / leagueAvgGoals; // >1 = leaky, <1 = solid
    const rawForm = t.formPct / leagueAvgForm;

    const homeMP = t.homeW + t.homeD + t.homeL;
    const awayMP = t.awayW + t.awayD + t.awayL;
    const homePPG = homeMP ? (t.homeW * 3 + t.homeD) / homeMP : 1.2;
    const awayPPG = awayMP ? (t.awayW * 3 + t.awayD) / awayMP : 1.2;
    // +0.5 smoothing avoids divide-by-zero / infinite ratios on 0-game splits
    const rawHomeAdv = (homePPG + 0.5) / (awayPPG + 0.5);

    return {
      team: t.team,
      gamesPlayed: t.mp,
      attackStrength: clamp(shrink(rawAttack, t.mp), 0.4, 2.2),
      defenseWeakness: clamp(shrink(rawDefense, t.mp), 0.3, 2.5),
      formMultiplier: clamp(shrink(rawForm, t.mp), 0.75, 1.3),
      homeAdvRating: clamp(shrink(rawHomeAdv, t.mp), 0.6, 1.8),
      leagueAvgGoals,
      pointsPerGame: (t.w * 3 + t.d) / t.mp,
      homePPG,
      awayPPG,
    };
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- Poisson scoreline model ----------

function poissonPmf(k, lambda) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}
function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function predictMatch(homeTeam, awayTeam, ratings, maxGoals = 6) {
  const h = ratings.find((r) => r.team === homeTeam);
  const a = ratings.find((r) => r.team === awayTeam);
  if (!h || !a) throw new Error(`Unknown team: ${!h ? homeTeam : awayTeam}`);

  const lambdaHome =
    h.leagueAvgGoals *
    h.attackStrength *
    a.defenseWeakness *
    h.formMultiplier *
    Math.sqrt(h.homeAdvRating);
  const lambdaAway =
    (a.leagueAvgGoals *
      a.attackStrength *
      h.defenseWeakness *
      a.formMultiplier) /
    Math.sqrt(h.homeAdvRating);

  const matrix = [];
  let total = 0;
  for (let hg = 0; hg <= maxGoals; hg++) {
    const row = [];
    for (let ag = 0; ag <= maxGoals; ag++) {
      const p = poissonPmf(hg, lambdaHome) * poissonPmf(ag, lambdaAway);
      row.push(p);
      total += p;
    }
    matrix.push(row);
  }

  let homeWin = 0,
    draw = 0,
    awayWin = 0;
  let best = { hg: 0, ag: 0, p: -1 };
  const scoreProbs = [];
  for (let hg = 0; hg <= maxGoals; hg++) {
    for (let ag = 0; ag <= maxGoals; ag++) {
      const p = matrix[hg][ag] / total;
      scoreProbs.push({ score: `${hg}-${ag}`, p });
      if (hg > ag) homeWin += p;
      else if (hg === ag) draw += p;
      else awayWin += p;
      if (p > best.p) best = { hg, ag, p };
    }
  }
  scoreProbs.sort((x, y) => y.p - x.p);

  return {
    fixture: `${homeTeam} vs ${awayTeam}`,
    lambdaHome: round(lambdaHome),
    lambdaAway: round(lambdaAway),
    homeWinPct: round(homeWin * 100, 1),
    drawPct: round(draw * 100, 1),
    awayWinPct: round(awayWin * 100, 1),
    predictedScore: `${best.hg}-${best.ag}`,
    predictedScoreProb: round(best.p * 100, 1),
    top3Scorelines: scoreProbs.slice(0, 3).map((s) => ({
      score: s.score,
      pct: round(s.p * 100, 1),
    })),
  };
}

function round(v, dp = 2) {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

// ---------- Scorecard ranking (for a league-wide power ranking view) ----------

function buildScorecard(ratings) {
  return ratings
    .map((r) => ({
      team: r.team,
      powerScore: round(
        (0.35 * r.attackStrength +
          0.35 * (2 - r.defenseWeakness) + // invert: lower conceded = higher score
          0.3 * r.formMultiplier) *
          33.3,
        1
      ),
      attackStrength: round(r.attackStrength),
      defenseWeakness: round(r.defenseWeakness),
      formMultiplier: round(r.formMultiplier),
      homeAdvRating: round(r.homeAdvRating),
    }))
    .sort((a, b) => b.powerScore - a.powerScore);
}

// ---------- CLI ----------

if (require.main === module) {
  const [, , csvPath, arg1, arg2] = process.argv;
  if (!csvPath) {
    console.error(
      "Usage: node spfl_predictor.js team_stats.csv <Home> <Away>\n" +
        "       node spfl_predictor.js team_stats.csv --scorecard"
    );
    process.exit(1);
  }
  const teams = loadTeamStats(csvPath);
  const ratings = buildRatings(teams);

  if (arg1 === "--scorecard") {
    console.table(buildScorecard(ratings));
  } else if (arg1 && arg2) {
    console.log(JSON.stringify(predictMatch(arg1, arg2, ratings), null, 2));
  } else {
    console.table(buildScorecard(ratings));
  }
}

module.exports = { loadTeamStats, buildRatings, predictMatch, buildScorecard };
