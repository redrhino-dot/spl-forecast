/**
 * scripts/build_team_stats.js
 * ----------------------------
 * Rebuilds team_stats.csv from results.csv (one row per full-time result).
 * This is the piece that lets the predictor scorecard "evolve" automatically:
 * append new results each week, run this script, and every derived stat
 * (MP, W/D/L, GF/GA, home/away splits, and the rolling Form6 string) is
 * recalculated with zero manual arithmetic.
 *
 * results.csv format (append one row after each full-time result):
 *   Date,HomeTeam,AwayTeam,HomeGoals,AwayGoals
 *   2026-08-01,Aberdeen,Hearts,1,2
 *
 * Usage:
 *   node scripts/build_team_stats.js results.csv team_stats.csv
 */

const fs = require("fs");

function parseCsv(path) {
  const lines = fs.readFileSync(path, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

function buildTeamStats(resultsPath) {
  const results = parseCsv(resultsPath)
    .map((r) => ({
      date: r.Date,
      home: r.HomeTeam,
      away: r.AwayTeam,
      hg: +r.HomeGoals,
      ag: +r.AwayGoals,
    }))
    // chronological order matters for the Form6 rolling window
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const teams = {};
  function ensure(team) {
    if (!teams[team]) {
      teams[team] = {
        team,
        mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0,
        homeW: 0, homeD: 0, homeL: 0,
        awayW: 0, awayD: 0, awayL: 0,
        formHistory: [], // chronological W/D/L, oldest first
      };
    }
    return teams[team];
  }

  for (const r of results) {
    const h = ensure(r.home);
    const a = ensure(r.away);

    h.mp++; a.mp++;
    h.gf += r.hg; h.ga += r.ag;
    a.gf += r.ag; a.ga += r.hg;

    if (r.hg > r.ag) {
      h.w++; a.l++;
      h.homeW++; a.awayL++;
      h.formHistory.push("W"); a.formHistory.push("L");
    } else if (r.hg < r.ag) {
      h.l++; a.w++;
      h.homeL++; a.awayW++;
      h.formHistory.push("L"); a.formHistory.push("W");
    } else {
      h.d++; a.d++;
      h.homeD++; a.awayD++;
      h.formHistory.push("D"); a.formHistory.push("D");
    }
  }

  return Object.values(teams).map((t) => {
    const last6 = t.formHistory.slice(-6);
    const padded = Array(6 - last6.length).fill("-").concat(last6);
    return { ...t, form6: padded.join("") };
  });
}

function writeTeamStatsCsv(teamRows, outPath) {
  const header = [
    "Team","MP","W","D","L","GF","GA",
    "HomeW","HomeD","HomeL","AwayW","AwayD","AwayL","Form6",
  ];
  const lines = [header.join(",")];
  for (const t of teamRows) {
    lines.push(
      [t.team, t.mp, t.w, t.d, t.l, t.gf, t.ga,
       t.homeW, t.homeD, t.homeL, t.awayW, t.awayD, t.awayL, t.form6].join(",")
    );
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
}

if (require.main === module) {
  const [, , resultsPath = "results.csv", outPath = "team_stats.csv"] = process.argv;
  if (!fs.existsSync(resultsPath)) {
    console.error(`No ${resultsPath} found — nothing to rebuild. Seed it with this season's results first.`);
    process.exit(1);
  }
  const rows = buildTeamStats(resultsPath);
  writeTeamStatsCsv(rows, outPath);
  console.log(`Rebuilt ${outPath} from ${rows.reduce((s, t) => s + t.mp, 0) / 2} results across ${rows.length} teams.`);
}

module.exports = { buildTeamStats, writeTeamStatsCsv };
