// squeezeScore.js — ES module for Chrome extensions / web
// Nothing hits 100; scores capped at 99.

/** ---------- Utilities ---------- */
const clamp99 = (x) => Math.min(x, 99);
const asFloat = (v) => {
  if (v == null) return 0;
  const s = String(v).trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const asBool = (v) => {
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "t" || s === "yes" || s === "y";
};

/** ---------- Tunable thresholds / weights ---------- */
const FLOAT_BUCKETS = [
  [5_000_000, 35],
  [10_000_000, 30],
  [20_000_000, 25],
  [50_000_000, 15],
  [Infinity, 5],
];

const REGSHO_BONUS = 4;

/** Guardrails (minimum baseline rules) */
function applyMinimumsAdditive(score, floatShares, ctb, siPct) {
  if (floatShares < 10_000_000 && ctb > 300) score = Math.max(score, 91);
  if (floatShares < 5_000_000 && ctb > 100) score = Math.max(score, 88);
  if (floatShares < 30_000_000 && ctb > 50 && siPct >= 20) score = Math.max(score, 85);
  return score;
}
function applyMinimumsMultiplicative(score, floatShares, ctb, siPct) {
  if (floatShares < 10_000_000 && ctb > 300) score = Math.max(score, 91);
  if (floatShares < 5_000_000 && ctb > 100) score = Math.max(score, 88);
  if (floatShares < 30_000_000 && ctb > 50 && siPct >= 20) score = Math.max(score, 85);
  return score;
}

/** ---------- Multipliers for multiplicative model ---------- */
function floatMultiplier(floatShares) {
  if (floatShares < 5_000_000) return 3.0;
  if (floatShares < 10_000_000) return 2.5;
  if (floatShares < 20_000_000) return 2.0;
  if (floatShares < 50_000_000) return 1.5;
  return 1.0;
}
function ctbMultiplier(ctb) {
  if (ctb >= 500) return 3.0;
  if (ctb >= 300) return 2.7;
  if (ctb >= 100) return 2.0;
  if (ctb >= 50)  return 1.6;
  if (ctb >= 25)  return 1.3;
  return 1.0;
}
function siMultiplier(siPct) {
  if (siPct >= 50) return 2.5;
  if (siPct >= 20) return 2.0;
  if (siPct >= 10) return 1.5;
  if (siPct >= 5)  return 1.2;
  return 1.0;
}
function ftdMultiplier(ftdVal) {
  if (ftdVal >= 10_000_000) return 1.3;
  if (ftdVal >= 5_000_000)  return 1.2;
  if (ftdVal >= 1_000_000)  return 1.1;
  return 1.0;
}
const regshoMultiplier = (regsho) => (regsho ? 1.05 : 1.0);

/** ---------- Additive model ---------- */
export function scoreAdditive({ float_shares, si_pct, ctb, ftd_val, regsho }) {
  let score = 0;

  // Float
  const floatPts = FLOAT_BUCKETS.find(([thr]) => float_shares < thr)?.[1] ?? 5;
  score += floatPts;

  // CTB
  if (ctb >= 500) score += 24;
  else if (ctb >= 300) score += 23;
  else if (ctb >= 100) score += 19;
  else if (ctb >= 50)  score += 14;
  else if (ctb >= 25)  score += 10;
  else if (ctb >= 10)  score += 5;

  // SI%
  if (si_pct >= 50) score += 25;
  else if (si_pct >= 20) score += 19;
  else if (si_pct >= 10) score += 14;
  else if (si_pct >= 5)  score += 10;

  // Bonuses
  if (float_shares < 10_000_000 && si_pct >= 20) score += 8;
  if (float_shares < 5_000_000 && ctb > 100)     score += 12;
  if (float_shares < 10_000_000 && ctb > 300)    score += 8;

  // FTDs ($)
  if (ftd_val >= 10_000_000)      score += 9;
  else if (ftd_val >= 5_000_000)   score += 7;
  else if (ftd_val >= 1_000_000)   score += 5;

  // RegSHO bonus only
  if (regsho) score += REGSHO_BONUS;

  // Guardrails & cap
  score = applyMinimumsAdditive(score, float_shares, ctb, si_pct);
  return clamp99(score);
}

/** ---------- Multiplicative model ---------- */
export function scoreMultiplicative({ float_shares, si_pct, ctb, ftd_val, regsho }) {
  const raw =
    floatMultiplier(float_shares) *
    ctbMultiplier(ctb) *
    siMultiplier(si_pct) *
    ftdMultiplier(ftd_val) *
    regshoMultiplier(regsho);

  // Normalize to ~0–100; 45 is empirical “max” anchor
  let score = (raw / 45) * 100;

  // Guardrails & cap
  score = applyMinimumsMultiplicative(score, float_shares, ctb, si_pct);
  return clamp99(score);
}

/** ---------- Consensus ---------- */
export function scoreConsensus({ float_shares, os_shares = 0, si_pct, ctb, ftd_val, regsho }) {
  const add = scoreAdditive({ float_shares, si_pct, ctb, ftd_val, regsho });
  const mul = scoreMultiplicative({ float_shares, si_pct, ctb, ftd_val, regsho });
  return Math.round(((add + mul) / 2) * 10) / 10;
}

/** ---------- Breakdown (for debugging) ---------- */
export function scoreBreakdown({ float_shares, os_shares = 0, si_pct, ctb, ftd_val, regsho }) {
  // Additive component points
  const floatPts = FLOAT_BUCKETS.find(([thr]) => float_shares < thr)?.[1] ?? 5;
  const ctbPts =
    ctb >= 500 ? 24 :
    ctb >= 300 ? 23 :
    ctb >= 100 ? 19 :
    ctb >= 50  ? 14 :
    ctb >= 25  ? 10 :
    ctb >= 10  ? 5  : 0;
  const siPts =
    si_pct >= 50 ? 25 :
    si_pct >= 20 ? 19 :
    si_pct >= 10 ? 14 :
    si_pct >= 5  ? 10 : 0;

  let bonuses = 0;
  if (float_shares < 10_000_000 && si_pct >= 20) bonuses += 8;
  if (float_shares < 5_000_000 && ctb > 100)     bonuses += 12;
  if (float_shares < 10_000_000 && ctb > 300)    bonuses += 8;

  const ftdPts =
    ftd_val >= 10_000_000 ? 9 :
    ftd_val >= 5_000_000  ? 7 :
    ftd_val >= 1_000_000  ? 5 : 0;

  const regPts = regsho ? REGSHO_BONUS : 0;

  let additiveTotal = floatPts + ctbPts + siPts + bonuses + ftdPts + regPts;
  additiveTotal = applyMinimumsAdditive(additiveTotal, float_shares, ctb, si_pct);
  additiveTotal = clamp99(additiveTotal);

  const multiplicativeTotal = scoreMultiplicative({ float_shares, si_pct, ctb, ftd_val, regsho });
  const consensus = Math.round(((additiveTotal + multiplicativeTotal) / 2) * 10) / 10;

  return {
    Float: floatPts,
    CTB: ctbPts,
    "SI%": siPts,
    Bonuses: bonuses,
    FTD: ftdPts,
    RegSHO: regPts,
    "Additive Total": Number(additiveTotal.toFixed(1)),
    "Multiplicative Total": Number(multiplicativeTotal.toFixed(1)),
    Consensus: consensus,
  };
}

/** ---------- Batch helpers ---------- */
export function scoreMany(rows) {
  return rows.map((r) =>
    Object.assign(
      { ticker: r.ticker ?? "" },
      scoreBreakdown({
        float_shares: asFloat(r.float_shares),
        os_shares: asFloat(r.os_shares),
        si_pct: asFloat(r.si_pct),
        ctb: asFloat(r.ctb),
        ftd_val: asFloat(r.ftd_val),
        regsho: asBool(r.regsho),
      })
    )
  );
}

/** ---------- CSV parsing (robust) ---------- */
const HEADER_ALIASES = {
  ticker: new Set(["ticker", "symbol"]),
  float_shares: new Set(["float_shares", "free float", "float", "free_float"]),
  os_shares: new Set(["os_shares", "shares outstanding", "outstanding", "os", "shares_outstanding"]),
  si_pct: new Set(["si_pct", "short float %", "short %", "short_percent", "short_float_pct"]),
  ctb: new Set(["ctb", "cost to borrow", "borrow cost", "ctb%", "cost_to_borrow"]),
  ftd_val: new Set(["ftd_val", "ftd $", "ftd value", "ftd", "ftd_usd"]),
  regsho: new Set(["regsho", "reg sho", "threshold", "on_regsho"]),
};

function normalizeHeaders(headers) {
  const lower = headers.map((h) => h.trim()).map((h) => [h.toLowerCase(), h]);
  const map = {};
  for (const [canon, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const [low, raw] of lower) {
      if (aliases.has(low)) { map[canon] = raw; break; }
    }
  }
  return map;
}

function sniffDelimiter(firstLine) {
  if ((firstLine.match(/,/g) || []).length >= 1) return ",";
  if ((firstLine.match(/;/g) || []).length >= 1) return ";";
  if ((firstLine.match(/\t/g) || []).length >= 1) return "\t";
  return ","; // default
}

/**
 * Parse CSV text and return breakdown rows.
 * @param {string} csvText
 * @param {{debug?: boolean}=} opts
 * @returns {Array<object>}
 */
export function scoreFromCSV(csvText, opts = {}) {
  // Strip BOM if present
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
  const lines = csvText.split(/\r\n|\r|\n/);
  if (!lines.length) return [];
  const delim = sniffDelimiter(lines[0]);

  // Simple CSV splitter (no embedded quotes support). For robust CSVs use PapaParse.
  const split = (line) => line.split(delim).map((s) => s.trim());

  const header = split(lines[0]);
  const map = normalizeHeaders(header);
  const idx = (canon) => header.indexOf(map[canon] ?? "__missing__");

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row.trim()) continue;
    const cols = split(row);
    try {
      const payload = {
        ticker: cols[idx("ticker")] ?? "",
        float_shares: asFloat(cols[idx("float_shares")]),
        os_shares: asFloat(cols[idx("os_shares")]),
        si_pct: asFloat(cols[idx("si_pct")]),
        ctb: asFloat(cols[idx("ctb")]),
        ftd_val: asFloat(cols[idx("ftd_val")]),
        regsho: asBool(cols[idx("regsho")]),
      };
      out.push(Object.assign({ ticker: payload.ticker }, scoreBreakdown(payload)));
    } catch (e) {
      if (opts.debug) console.warn(`[row ${i}] parse error:`, e, row);
    }
  }
  return out;
}

/** ---------- Example usage (in extension background or content script) ----------
import { scoreConsensus, scoreBreakdown, scoreMany, scoreFromCSV } from './squeezeScore.js';

// Single
const zone = scoreConsensus({ float_shares: 7_150_000, si_pct: 0.83, ctb: 755, ftd_val: 10_000_000, regsho: true });
console.log('ZONE consensus:', zone);

// Breakdown
console.log(scoreBreakdown({ float_shares: 3_540_000, si_pct: 37.67, ctb: 400, ftd_val: 1_620_000, regsho: true }));

// Batch
const rows = [
  { ticker: 'ZONE', float_shares: 7150000, si_pct: 0.83, ctb: 755, ftd_val: 10000000, regsho: true },
  { ticker: 'CWD',  float_shares: 3540000, si_pct: 37.67, ctb: 400, ftd_val: 1620000,  regsho: true },
];
console.table(scoreMany(rows));

// CSV
// const result = scoreFromCSV(csvText, { debug: true });
// console.table(result);
--------------------------------------------------------------------------- */
