#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets");

const ICONS = {
  star: "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z",
  commit:
    "M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z",
  pr: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  issue:
    "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z",
  repo: "M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z",
};

const THEMES = {
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    title: "#58a6ff",
    text: "#c9d1d9",
    icon: "#58a6ff",
    ring: "#58a6ff",
    track: "#30363d",
  },
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    title: "#0969da",
    text: "#24292f",
    icon: "#0969da",
    ring: "#0969da",
    track: "#dbe0e6",
  },
};

async function graphql(query, variables, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "github-stats-card",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  if (body.errors) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data;
}

const PROFILE_QUERY = `
query ($login: String!, $after: String) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    contributionsCollection { contributionYears }
    repositoriesContributedTo(contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes { stargazerCount }
    }
  }
}`;

// One aliased contributionsCollection per year, so commit totals cover the whole
// account lifetime rather than the trailing-year window the API defaults to.
function commitsQuery(years) {
  const fields = years
    .map(
      (y) =>
        `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { totalCommitContributions restrictedContributionsCount }`,
    )
    .join("\n    ");
  return `query ($login: String!) {\n  user(login: $login) {\n    ${fields}\n  }\n}`;
}

async function fetchStats(login, token) {
  let after = null;
  let stars = 0;
  let profile;

  do {
    const data = await graphql(PROFILE_QUERY, { login, after }, token);
    profile = data.user;
    for (const repo of profile.repositories.nodes) stars += repo.stargazerCount;
    after = profile.repositories.pageInfo.hasNextPage
      ? profile.repositories.pageInfo.endCursor
      : null;
  } while (after);

  const years = profile.contributionsCollection.contributionYears;
  const perYear = await graphql(commitsQuery(years), { login }, token);
  const commits = Object.values(perYear.user).reduce(
    (total, y) => total + y.totalCommitContributions + y.restrictedContributionsCount,
    0,
  );

  return {
    name: profile.name || profile.login,
    stars,
    commits,
    prs: profile.pullRequests.totalCount,
    issues: profile.issues.totalCount,
    contributedTo: profile.repositoriesContributedTo.totalCount,
    followers: profile.followers.totalCount,
  };
}

// Percentile model ported from anuraghazra/github-readme-stats: each metric is
// pushed through a CDF against a median, then weighted. Lower percentile = better.
export function calculateRank({ commits, prs, issues, stars, followers, contributedTo }) {
  const exponentialCdf = (x) => 1 - 2 ** -x;
  const logNormalCdf = (x) => x / (1 + x);

  const weights = { commits: 2, contribs: 0.5, issues: 1, stars: 4, prs: 1, followers: 1 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  const percentile =
    (100 *
      (weights.commits * exponentialCdf(commits / 250) +
        weights.contribs * exponentialCdf(contributedTo / 20) +
        weights.issues * exponentialCdf(issues / 25) +
        weights.stars * logNormalCdf(stars / 50) +
        weights.prs * exponentialCdf(prs / 50) +
        weights.followers * logNormalCdf(followers / 10))) /
    total;

  const thresholds = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
  const levels = ["S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C"];
  const inverted = 100 - percentile;

  return { level: levels[thresholds.findIndex((t) => inverted <= t)], percentile: inverted };
}

const formatNumber = (n) => n.toLocaleString("en-US");

const escapeXml = (s) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

export function renderCard(stats, themeName) {
  const t = THEMES[themeName];
  const rank = calculateRank(stats);
  const rows = [
    ["star", "Total Stars Earned", stats.stars],
    ["commit", "Total Commits", stats.commits],
    ["pr", "Total PRs", stats.prs],
    ["issue", "Total Issues", stats.issues],
    ["repo", "Contributed to", stats.contributedTo],
  ];

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  // The ring fills in proportion to how far above the bottom percentile the rank sits.
  const filled = circumference * ((100 - rank.percentile) / 100);

  const statRows = rows
    .map(([icon, label, value], i) => {
      const y = 62 + i * 25;
      return `  <g>
    <svg x="25" y="${y - 12}" width="16" height="16" viewBox="0 0 16 16" fill="${t.icon}"><path d="${ICONS[icon]}"/></svg>
    <text x="50" y="${y}" class="label">${label}</text>
    <text x="270" y="${y}" class="value">${formatNumber(value)}</text>
  </g>`;
    })
    .join("\n");

  return `<svg width="450" height="200" viewBox="0 0 450 200" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(stats.name)}'s GitHub stats">
  <title>${escapeXml(stats.name)}'s GitHub stats</title>
  <style>
    .title { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${t.title}; }
    .label { font: 400 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${t.text}; }
    .value { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${t.text}; text-anchor: end; }
    .rank { font: 700 24px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${t.title}; text-anchor: middle; }
  </style>
  <rect x="0.5" y="0.5" width="449" height="199" rx="6" fill="${t.bg}" stroke="${t.border}"/>
  <text x="25" y="35" class="title">${escapeXml(stats.name)}'s GitHub Stats</text>
${statRows}
  <g transform="translate(365, 110)">
    <circle r="${radius}" fill="none" stroke="${t.track}" stroke-width="6"/>
    <circle r="${radius}" fill="none" stroke="${t.ring}" stroke-width="6" stroke-linecap="round"
      transform="rotate(-90)" stroke-dasharray="${filled.toFixed(2)} ${circumference.toFixed(2)}"/>
    <text y="8" class="rank">${rank.level}</text>
  </g>
</svg>
`;
}

async function main() {
  const login = process.env.STATS_LOGIN || "cmhhelgeson";
  const token = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Set STATS_TOKEN or GITHUB_TOKEN to a token with read:user scope.");

  const stats = await fetchStats(login, token);
  await mkdir(OUT_DIR, { recursive: true });
  for (const theme of Object.keys(THEMES)) {
    await writeFile(resolve(OUT_DIR, `stats-${theme}.svg`), renderCard(stats, theme), "utf8");
  }
  console.log(`Wrote stats cards for ${login}:`, stats);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
