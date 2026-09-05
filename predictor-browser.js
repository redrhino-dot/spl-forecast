/**
 * predictor-browser.js
 * ---------------------
 * Browser-safe port of spfl_predictor.js (no `fs`, no `require`). Powers
 * index.html on GitHub Pages: takes CSV text fetched client-side and runs
 * the identical Form + Home Advantage + Attack/Defense Poisson model used
 * by the Node CLI and the weekly GitHub Action, so the page always matches
 * what the automation computed.
 */

const SPFL = (() => {
  const FORM_WEIGHTS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
  const PTS = { W: 3, D: 1, L: 0 };
  const SAMPLE_TRUST_GAMES = 12;

  function parseCsv(text) {
    const lines = text.trim().split("\n");
    const header = lines[0].split(",");
    return lines.slice(1).map((line) => {
      const cells = line.split(",");
      const row = {};
      header.forEach((h, i) => (row[h] = cells[i]));
      return row;
    });
  }

  function loadTeamStats(csvText) {
    return parseCsv(csvText).map((row) => ({
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
      form6: row.Form6,
    }));
  }

  function loadFixtures(csvText) {
    return parseCsv(csvText).map((row) => ({
      date: row.Date,
      home: row.HomeTeam,
      away: row.AwayTeam,
      round: row.Round,
    }));
  }

  function formPct(form6) {
    const chars = (form6 || "").split("");
    let num = 0, den = 0;
    chars.forEach((c, i) => {
      if (c === "-") return;
      num += FORM_WEIGHTS[i] * PTS[c];
      den += FORM_WEIGHTS[i] * 3;
    });
    return den ? num / den : 0.5;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function shrink(rawRatio, gamesPlayed) {
    const confidence = Math.min(gamesPlayed / SAMPLE_TRUST_GAMES, 1);
    return 1 + (rawRatio - 1) * confidence;
  }

  function buildRatings(teams) {
    const totalGoals = teams.reduce((s, t) => s + t.gf, 0);
    const totalGames = teams.reduce((s, t) => s + t.mp, 0);
    const leagueAvgGoals = totalGoals / totalGames;

    const withForm = teams.map((t) => ({ ...t, formPct: formPct(t.form6) }));
    const leagueAvgForm = withForm.reduce((s, t) => s + t.formPct, 0) / withForm.length;

    return withForm.map((t) => {
      const rawAttack = t.gf / t.mp / leagueAvgGoals;
      const rawDefense = t.ga / t.mp / leagueAvgGoals;
      const rawForm = t.formPct / leagueAvgForm;

      const homeMP = t.homeW + t.homeD + t.homeL;
      const awayMP = t.awayW + t.awayD + t.awayL;
      const homePPG = homeMP ? (t.homeW * 3 + t.homeD) / homeMP : 1.2;
      const awayPPG = awayMP ? (t.awayW * 3 + t.awayD) / awayMP : 1.2;
      const rawHomeAdv = (homePPG + 0.5) / (awayPPG + 0.5);

      return {
        team: t.team,
        gamesPlayed: t.mp,
        attackStrength: clamp(shrink(rawAttack, t.mp), 0.4, 2.2),
        defenseWeakness: clamp(shrink(rawDefense, t.mp), 0.3, 2.5),
        formMultiplier: clamp(shrink(rawForm, t.mp), 0.75, 1.3),
        homeAdvRating: clamp(shrink(rawHomeAdv, t.mp), 0.6, 1.8),
        leagueAvgGoals,
      };
    });
  }

  function poissonPmf(k, lambda) {
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  }
  function factorial(n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
  }

  function predictMatch(homeTeam, awayTeam, ratings, maxGoals = 6) {
    const h = ratings.find((r) => r.team === homeTeam);
    const a = ratings.find((r) => r.team === awayTeam);
    if (!h || !a) return null;

    const lambdaHome = h.leagueAvgGoals * h.attackStrength * a.defenseWeakness * h.formMultiplier * Math.sqrt(h.homeAdvRating);
    const lambdaAway = (a.leagueAvgGoals * a.attackStrength * h.defenseWeakness * a.formMultiplier) / Math.sqrt(h.homeAdvRating);

    let total = 0;
    const matrix = [];
    for (let hg = 0; hg <= maxGoals; hg++) {
      const row = [];
      for (let ag = 0; ag <= maxGoals; ag++) {
        const p = poissonPmf(hg, lambdaHome) * poissonPmf(ag, lambdaAway);
        row.push(p);
        total += p;
      }
      matrix.push(row);
    }

    let homeWin = 0, draw = 0, awayWin = 0, best = { hg: 0, ag: 0, p: -1 };
    for (let hg = 0; hg <= maxGoals; hg++) {
      for (let ag = 0; ag <= maxGoals; ag++) {
        const p = matrix[hg][ag] / total;
        if (hg > ag) homeWin += p;
        else if (hg === ag) draw += p;
        else awayWin += p;
        if (p > best.p) best = { hg, ag, p };
      }
    }

    return {
      homeWinPct: round(homeWin * 100),
      drawPct: round(draw * 100),
      awayWinPct: round(awayWin * 100),
      predictedScore: `${best.hg}-${best.ag}`,
      predictedScoreProb: round(best.p * 100),
    };
  }

  function round(v, dp = 1) {
    const f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  return { parseCsv, loadTeamStats, loadFixtures, buildRatings, predictMatch };
})();
