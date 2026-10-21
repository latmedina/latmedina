// Genera dist/streak.svg y dist/langs.svg con datos de la API GraphQL de GitHub.
// Uso: GITHUB_TOKEN=... GH_USER=latmedina node scripts/stats.mjs
// Con MOCK=1 usa datos de ejemplo (para probar el diseño sin red).
import { mkdirSync, writeFileSync } from 'node:fs';

const USER = process.env.GH_USER || 'latmedina';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || 'dist';

const C = {
  bg: '#0D1117', border: '#30363D', text: '#E6EDF3', muted: '#8B949E',
  accent: '#00E5A0', accent2: '#00B4D8',
};
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'Fira Code', 'JetBrains Mono', Consolas, monospace";

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchData() {
  const base = await gql(
    `query($login:String!){ user(login:$login){
        createdAt
        contributionsCollection { contributionYears }
        repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
          nodes { name languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges { size node { name color } } } }
        }
     } }`,
    { login: USER },
  );
  const u = base.user;
  const days = [];
  for (const year of u.contributionsCollection.contributionYears) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    const d = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
          contributionsCollection(from:$from,to:$to){ contributionCalendar {
            weeks { contributionDays { date contributionCount } } } } } }`,
      { login: USER, from, to },
    );
    for (const w of d.user.contributionsCollection.contributionCalendar.weeks)
      for (const day of w.contributionDays) days.push(day);
  }
  const langs = {};
  for (const repo of u.repositories.nodes)
    for (const e of repo.languages.edges) {
      const l = (langs[e.node.name] ||= { size: 0, color: e.node.color || C.muted });
      l.size += e.size;
    }
  return { days, langs };
}

function mockData() {
  const days = [];
  const start = new Date('2024-01-01');
  const today = new Date();
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const n = Math.random() < 0.55 ? Math.floor(Math.random() * 9) : 0;
    days.push({ date: d.toISOString().slice(0, 10), contributionCount: n });
  }
  const langs = {
    Python: { size: 52000, color: '#3572A5' }, JavaScript: { size: 41000, color: '#f1e05a' },
    HTML: { size: 30000, color: '#e34c26' }, Ruby: { size: 22000, color: '#701516' },
    PLpgSQL: { size: 19000, color: '#336790' }, Vue: { size: 9000, color: '#41b883' },
    Java: { size: 8000, color: '#b07219' },
  };
  return { days, langs };
}

// ---------- cálculo de rachas ----------
function streaks(days) {
  const map = new Map();
  for (const d of days) map.set(d.date, (map.get(d.date) || 0) + d.contributionCount);
  const dates = [...map.keys()].sort();
  const todayStr = new Date().toISOString().slice(0, 10);
  const valid = dates.filter((d) => d <= todayStr);
  let total = 0, longest = 0, run = 0, runStart = null, longestRange = [null, null];
  for (const d of valid) {
    const n = map.get(d);
    total += n;
    if (n > 0) {
      if (run === 0) runStart = d;
      run++;
      if (run > longest) { longest = run; longestRange = [runStart, d]; }
    } else run = 0;
  }
  // racha actual: si hoy todavía no hay contribuciones, se cuenta desde ayer
  let i = valid.length - 1;
  if (i >= 0 && map.get(valid[i]) === 0) i--;
  let current = 0, curEnd = valid[i], curStart = null;
  for (; i >= 0 && map.get(valid[i]) > 0; i--) { current++; curStart = valid[i]; }
  const firstActive = valid.find((d) => map.get(d) > 0) || valid[0];
  return { total, current, currentRange: [curStart, curEnd], longest, longestRange, since: firstActive };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmt = (s, withYear = true) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MESES[m - 1]}${withYear ? ` ${y}` : ''}`;
};
const range = ([a, b]) => (a ? (a === b ? fmt(a) : `${fmt(a, a.slice(0, 4) !== b.slice(0, 4))} – ${fmt(b)}`) : 'sin racha activa');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function streakSvg(s) {
  const W = 495, H = 195;
  const col = (x, value, label, sub, color, big) => `
    <g transform="translate(${x},0)">
      <text x="0" y="${big ? 79 : 88}" text-anchor="middle" style="font:700 ${big ? 30 : 28}px ${FONT};fill:${color}" class="fade">${esc(value)}</text>
      <text x="0" y="128" text-anchor="middle" style="font:600 14px ${FONT};fill:${big ? color : C.text}">${esc(label)}</text>
      <text x="0" y="150" text-anchor="middle" style="font:400 11px ${FONT};fill:${C.muted}">${esc(sub)}</text>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Racha de contribuciones de ${USER}">
  <style>
    .fade { animation: in .8s ease-out both; }
    .ring { stroke-dasharray: 208; animation: draw 1.2s ease-out .2s both; }
    @keyframes in { from { opacity: 0; } }
    @keyframes draw { from { stroke-dashoffset: 208; } }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
  <text x="20" y="28" style="font:600 13px ${MONO};fill:${C.accent}">&gt; git log --streak</text>
  <line x1="165" y1="45" x2="165" y2="165" stroke="${C.border}"/>
  <line x1="330" y1="45" x2="330" y2="165" stroke="${C.border}"/>
  ${col(82, s.total.toLocaleString('es-VE'), 'Contribuciones', `desde ${fmt(s.since)}`, C.text)}
  <circle cx="247" cy="68" r="33" fill="none" stroke="${C.border}" stroke-width="5"/>
  <circle cx="247" cy="68" r="33" fill="none" stroke="${C.accent}" stroke-width="5" class="ring" transform="rotate(-90 247 68)"/>
  <g>${col(247, s.current, 'Racha actual', range(s.currentRange), C.accent, true)}</g>
  ${col(412, s.longest, 'Racha más larga', range(s.longestRange), C.text)}
  <text x="${W - 14}" y="${H - 10}" text-anchor="end" style="font:400 9px ${FONT};fill:${C.muted}">actualizado ${fmt(new Date().toISOString().slice(0, 10))}</text>
</svg>`;
}

function langsSvg(langs) {
  const sorted = Object.entries(langs).sort((a, b) => b[1].size - a[1].size);
  const top = sorted.slice(0, 6);
  const totalAll = sorted.reduce((a, [, v]) => a + v.size, 0) || 1;
  const W = 495, H = 195, barX = 20, barW = W - 40, barY = 48;
  let x = barX;
  const segs = top.map(([name, v], i) => {
    const w = Math.max(2, (v.size / totalAll) * barW);
    const seg = `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="10" fill="${v.color}" class="grow" style="animation-delay:${i * 0.12}s"/>`;
    x += w;
    return seg;
  }).join('');
  const items = top.map(([name, v], i) => {
    const colX = i % 2 === 0 ? 24 : 260;
    const rowY = 92 + Math.floor(i / 2) * 30;
    const pct = ((v.size / totalAll) * 100).toFixed(1);
    return `<g transform="translate(${colX},${rowY})" class="fade" style="animation-delay:${0.3 + i * 0.1}s">
      <circle cx="6" cy="-4" r="6" fill="${v.color}"/>
      <text x="20" y="0" style="font:600 13px ${FONT};fill:${C.text}">${esc(name)}</text>
      <text x="200" y="0" text-anchor="end" style="font:400 12px ${MONO};fill:${C.muted}">${pct}%</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lenguajes más usados por ${USER}">
  <style>
    .fade { animation: in .6s ease-out both; }
    .grow { transform-origin: left; transform-box: fill-box; animation: grow .8s ease-out both; }
    @keyframes in { from { opacity: 0; } }
    @keyframes grow { from { transform: scaleX(0); } }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
  <text x="20" y="28" style="font:600 13px ${MONO};fill:${C.accent}">&gt; lenguajes --top</text>
  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5"/></clipPath>
  <rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5" fill="${C.border}"/>
  <g clip-path="url(#bar)">${segs}</g>
  ${items}
  <text x="${W - 14}" y="${H - 10}" text-anchor="end" style="font:400 9px ${FONT};fill:${C.muted}">repos públicos · actualizado ${fmt(new Date().toISOString().slice(0, 10))}</text>
</svg>`;
}

const data = process.env.MOCK ? mockData() : await fetchData();
mkdirSync(OUT, { recursive: true });
const s = streaks(data.days);
writeFileSync(`${OUT}/streak.svg`, streakSvg(s));
writeFileSync(`${OUT}/langs.svg`, langsSvg(data.langs));
console.log('racha', s, 'lenguajes', Object.keys(data.langs).length);
