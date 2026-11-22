// Token Launch Radar — the value model, version 2.
//
// One sealed DefiLlama snapshot in, one ranked board of pre-token protocols out. Every number on
// the board is computed from the snapshot's own figures at run time; no protocol is named or
// special-cased anywhere in this file, and the same code scores every row.
//
// WHAT CHANGED FROM VERSION 1
// Version 1 priced a launch as TVL x a category median multiple x three hand-set factors
// (momentum, maturity, breadth). The factors' sizes were chosen, not measured. Version 2 fits
// the model to the snapshot's own traded protocols instead, and prints the fit's held-out
// scores next to version 1's, computed the same way on the same peers, so the reader can see
// what the change bought:
//
//   log10(market cap) = b0 + b1*log10(TVL) + b2*growth + b3*log10(age in days + 30)
//                       + b4*extra chains
//
// fitted by ordinary least squares over every protocol in the snapshot whose token trades
// with a recorded market cap and TVL (128 of them here). growth is the 7-day TVL change in
// hundreds of a per cent, clamped to [-50, +100] first; age is the days DefiLlama has tracked
// the protocol, with the peer median standing in where a listing date is unreported; extra
// chains is the chain count past the first, up to eight. The board's implied value for a
// pre-token protocol is 10 raised to the fitted line at that protocol's own figures.
//
// THE VALIDATION (all of it computed below, at run time, and printed on the dashboard)
//   - leave-one-out: every traded peer is priced by a model that never saw it — exactly, via
//     the hat matrix for the regressions, and by re-learning the multiples without it for
//     version 1 — and the errors are summarised as a median error factor (x3.70 reads: the
//     median peer is priced within 3.70x of its actual market cap) and a log-scale R2.
//   - walk-forward split: peers DefiLlama tracked first are fitted, peers tracked later are
//     priced. The model is honest about the result: on this snapshot no model prices a launch
//     closely, and the fitted one is simply the least wrong of the ones tested, version 1
//     included by a wide margin.
//
// LAUNCH ODDS
// Each board row also carries a launch-odds figure read straight from the peers' record: of
// the protocols most like this one — same category where the snapshot has enough of them,
// within five times its TVL, of a similar age — how many already trade a token. It is a
// description of the record, not a forecast: the bounty asks what a token would be worth if
// it came, and the odds say how the comparable cases stand.
//
// The board covers every watchlist slug (the house's floor, never a ceiling) and then the
// strongest early protocols below the floor by TVL, skipping the same ground the watchlist
// rule skips: an exchange itself, a versioned pool of another protocol, and wrapped / staked /
// bridged products of a token that already trades — none of those is a launch still to come.
// The integrity accounting at the bottom of this file counts every one of the snapshot's
// protocols exactly once, so the dashboard can show where all 758 went.

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The fitted model's fixed choices, stated on the dashboard's method section as they are here. */
export const FIT = {
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  age_pad_days: 30,
  extra_chain_cap: 8,
  /** Watchlist rows plus this many early rows below the floor. */
  early_rows: 200,
  /** Tokenised protocols the dashboard's peer view carries, by market cap. */
  peer_rows: 24,
  /** The smallest peer group a launch-odds figure may be read from. */
  odds_min_group: 10,
  /** Launch-odds peer group: within this many days of the subject's age, either way. */
  odds_age_band_days: 550,
  /** Launch-odds peer group: within this factor of the subject's TVL, either way. */
  odds_tvl_factor: 5,
} as const;

/** Version 1's constants, kept so the program can score version 1's model on the same peers. */
export const V1 = {
  ratio_clamp_lo: 0.01,
  ratio_clamp_hi: 10,
  multiple_clamp_lo: 0.02,
  multiple_clamp_hi: 3,
  min_category_peers: 3,
  momentum_per_pct: 0.004,
  maturity_base: 0.78,
  maturity_span: 0.22,
  maturity_full_years: 5,
  unknown_age_years: 1,
  breadth_per_chain: 0.025,
} as const;

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The middle value of a non-empty list of numbers. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Records no token: every token field of the record is empty. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whole days from listed_at to the snapshot's as_of day; null when either date is missing or bad. */
export function listedAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/* ------------------------------------------------------------------ */
/* The fitted model                                                    */
/* ------------------------------------------------------------------ */

/** One traded peer as the regression sees it: the response and the four terms. */
export interface FitPeer {
  slug: string;
  category: string | null;
  listed_at: string | null;
  age_days: number;
  age_imputed: boolean;
  x: [number, number, number, number, number]; // 1, log10 TVL, growth, log10 age, extra chains
  y: number; // log10 market cap
}

/** The four fitted terms of one protocol, from its own snapshot figures. */
export function termsOf(p: Protocol, asOf: string, medianAgeDays: number): {
  growth: number; logage: number; extra: number; ageDays: number; ageKnown: boolean;
} {
  const growthPct = clamp(p.change_7d ?? 0, FIT.growth_floor_pct, FIT.growth_cap_pct);
  const age = listedAgeDays(asOf, p.listed_at);
  const ageDays = age === null ? medianAgeDays : age;
  return {
    growth: growthPct / 100,
    logage: Math.log10(ageDays + FIT.age_pad_days),
    extra: Math.min(Math.max(p.chains.length - 1, 0), FIT.extra_chain_cap),
    ageDays,
    ageKnown: age !== null,
  };
}

/** The traded peers the model is fitted on, and the median age that stands in for missing dates. */
export function fitPeersOf(snapshot: Snapshot): { peers: FitPeer[]; medianAgeDays: number } {
  const traded = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const knownAges = traded
    .map((p) => listedAgeDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const medianAgeDays = knownAges.length > 0 ? median(knownAges) : 365;
  const peers = traded.map((p) => {
    const t = termsOf(p, snapshot.as_of, medianAgeDays);
    return {
      slug: p.slug,
      category: p.category,
      listed_at: p.listed_at,
      age_days: t.ageDays,
      age_imputed: !t.ageKnown,
      x: [1, Math.log10(p.tvl_usd), t.growth, t.logage, t.extra] as [number, number, number, number, number],
      y: Math.log10(p.mcap_usd!),
    };
  });
  return { peers, medianAgeDays };
}

/** Solve a small linear system by Gauss-Jordan with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    const d = m[col]![col]!;
    for (let j = col; j <= n; j++) m[col]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      for (let j = col; j <= n; j++) m[r]![j]! -= f * m[col]![j]!;
    }
  }
  return m.map((row) => row[n]!);
}

/** Invert a small matrix by Gauss-Jordan; null when singular. */
function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    const d = m[col]![col]!;
    for (let j = 0; j < 2 * n; j++) m[col]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r]![j]! -= f * m[col]![j]!;
    }
  }
  return m.map((row) => row.slice(n));
}

/** Ordinary least squares over the given rows and columns, with a whisper of ridge for stability. */
function ols(rows: FitPeer[], cols: number[]): { beta: number[]; xtxInv: number[][] } | null {
  const k = cols.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (const r of rows) {
    for (let i = 0; i < k; i++) {
      xty[i]! += r.x[cols[i]!]! * r.y;
      for (let j = 0; j < k; j++) xtx[i]![j]! += r.x[cols[i]!]! * r.x[cols[j]!]!;
    }
  }
  for (let i = 0; i < k; i++) xtx[i]![i]! += 1e-9;
  const beta = solve(xtx.map((row) => [...row]), [...xty]);
  const xtxInv = invert(xtx);
  if (beta === null || xtxInv === null) return null;
  return { beta, xtxInv };
}

const ALL_COLS = [0, 1, 2, 3, 4];
const TVL_COLS = [0, 1];

/** A fitted regression: its coefficients, named for the dashboard. */
export interface FittedModel {
  n: number;
  intercept: number;
  per_log_tvl: number;
  per_growth: number;
  per_log_age: number;
  per_extra_chain: number;
  r2: number;
}

/** Fit the board's model on the traded peers. */
export function fitModel(peers: FitPeer[]): FittedModel {
  const fit = ols(peers, ALL_COLS)!;
  const meanY = peers.reduce((s, p) => s + p.y, 0) / peers.length;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of peers) {
    const pred = fit.beta.reduce((s, b, i) => s + b * p.x[ALL_COLS[i]!]!, 0);
    ssRes += (p.y - pred) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  return {
    n: peers.length,
    intercept: fit.beta[0]!,
    per_log_tvl: fit.beta[1]!,
    per_growth: fit.beta[2]!,
    per_log_age: fit.beta[3]!,
    per_extra_chain: fit.beta[4]!,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
  };
}

/** The fitted line at one protocol's figures, in log10 dollars, term by term. */
export function predictTerms(fit: FittedModel, p: Protocol, asOf: string, medianAgeDays: number): {
  intercept: number; tvl: number; growth: number; age: number; chains: number; total: number;
  ageDays: number; ageKnown: boolean;
} {
  const t = termsOf(p, asOf, medianAgeDays);
  const tvl = fit.per_log_tvl * Math.log10(p.tvl_usd);
  const growth = fit.per_growth * t.growth;
  const age = fit.per_log_age * t.logage;
  const chains = fit.per_extra_chain * t.extra;
  return {
    intercept: fit.intercept, tvl, growth, age, chains,
    total: fit.intercept + tvl + growth + age + chains,
    ageDays: t.ageDays, ageKnown: t.ageKnown,
  };
}

/* ------------------------------------------------------------------ */
/* Validation: leave-one-out and the walk-forward split                */
/* ------------------------------------------------------------------ */

/** Held-out scores for one model: log-scale R2 and the median error factor, on n peers. */
export interface HeldOut {
  n: number;
  r2: number;
  median_factor: number;
  median_ape_pct: number;
}

function summarise(peers: FitPeer[], errors: number[]): HeldOut {
  const meanY = peers.reduce((s, p) => s + p.y, 0) / peers.length;
  const ssTot = peers.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = errors.reduce((s, e) => s + e * e, 0);
  const factors = errors.map((e) => Math.max(10 ** -e, 10 ** e)).sort((a, b) => a - b);
  const apes = errors.map((e) => Math.abs(10 ** -e - 1) * 100).sort((a, b) => a - b);
  const mid = factors.length >> 1;
  const medF = factors.length % 2 === 1 ? factors[mid]! : (factors[mid - 1]! + factors[mid]!) / 2;
  const medA = apes.length % 2 === 1 ? apes[mid]! : (apes[mid - 1]! + apes[mid]!) / 2;
  return { n: peers.length, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, median_factor: medF, median_ape_pct: medA };
}

/** Exact leave-one-out errors of an OLS fit, via the hat matrix: e_loo = e / (1 - h). */
function looErrors(peers: FitPeer[], cols: number[]): number[] {
  const fit = ols(peers, cols)!;
  return peers.map((p) => {
    const pred = fit.beta.reduce((s, b, i) => s + b * p.x[cols[i]!]!, 0);
    let h = 0;
    for (let i = 0; i < cols.length; i++) {
      for (let j = 0; j < cols.length; j++) h += p.x[cols[i]!]! * fit.xtxInv[i]![j]! * p.x[cols[j]!]!;
    }
    return (p.y - pred) / Math.max(1e-9, 1 - h);
  });
}

/** Fit on one set of peers, errors on another: the walk-forward split's engine. */
function splitErrors(train: FitPeer[], test: FitPeer[], cols: number[]): number[] {
  const fit = ols(train, cols)!;
  return test.map((p) => p.y - fit.beta.reduce((s, b, i) => s + b * p.x[cols[i]!]!, 0));
}

/**
 * Each traded peer's leave-one-out price under the fitted model, in dollars: what the model
 * says the peer is worth when the peer itself was left out of the fit. The dashboard's peer
 * view prints these beside the market's own values, so the fit's accuracy is shown peer by
 * peer and not only as a summary statistic.
 */
export function fittedLooPredictions(peers: FitPeer[]): Map<string, number> {
  const errors = looErrors(peers, ALL_COLS);
  const out = new Map<string, number>();
  peers.forEach((p, i) => out.set(p.slug, 10 ** (p.y - errors[i]!)));
  return out;
}

/** Version 1's multiples, learned from a set of traded peers: a median per category, and global. */
function v1Multiples(peers: FitPeer[], bySlug: Map<string, Protocol>): { global: number; byCategory: Map<string, number> } {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const fp of peers) {
    const p = bySlug.get(fp.slug)!;
    const ratio = clamp(p.mcap_usd! / p.tvl_usd, V1.ratio_clamp_lo, V1.ratio_clamp_hi);
    all.push(ratio);
    if (p.category !== null) {
      const g = groups.get(p.category);
      if (g === undefined) groups.set(p.category, [ratio]);
      else g.push(ratio);
    }
  }
  const byCategory = new Map<string, number>();
  for (const [category, ratios] of groups) {
    if (ratios.length >= V1.min_category_peers) byCategory.set(category, clamp(median(ratios), V1.multiple_clamp_lo, V1.multiple_clamp_hi));
  }
  return { global: clamp(median(all), V1.multiple_clamp_lo, V1.multiple_clamp_hi), byCategory };
}

/** Version 1's price for one protocol under multiples learned elsewhere. */
function v1Price(p: Protocol, asOf: string, mults: { global: number; byCategory: Map<string, number> }): number {
  const multiple = (p.category !== null ? mults.byCategory.get(p.category) : undefined) ?? mults.global;
  const momentum = 1 + V1.momentum_per_pct * clamp(p.change_7d ?? 0, -50, 100);
  const age = listedAgeDays(asOf, p.listed_at);
  const years = age === null ? V1.unknown_age_years : age / 365.25;
  const maturity = V1.maturity_base + V1.maturity_span * (Math.min(years, 5) / 5);
  const breadth = 1 + V1.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), 8);
  return p.tvl_usd * multiple * momentum * maturity * breadth;
}

/** Every model's held-out scores, computed on the same peers the same way. */
export interface Validation {
  fitted: { loo: HeldOut; split: HeldOut; split_cutoff: string };
  tvl_only: { loo: HeldOut; split: HeldOut };
  v1: { loo: HeldOut; split: HeldOut };
}

export function validateModels(snapshot: Snapshot, peers: FitPeer[]): Validation {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  // Walk-forward split: the half of dated peers DefiLlama tracked first trains, the rest test.
  const dated = peers.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const cutoff = train.length > 0 ? train[train.length - 1]!.listed_at! : snapshot.as_of;

  const fittedLoo = summarise(peers, looErrors(peers, ALL_COLS));
  const fittedSplit = summarise(test, splitErrors(train, test, ALL_COLS));
  const tvlLoo = summarise(peers, looErrors(peers, TVL_COLS));
  const tvlSplit = summarise(test, splitErrors(train, test, TVL_COLS));

  // Version 1, leave-one-out: multiples re-learned without the peer being priced.
  const v1LooErrors = peers.map((fp) => {
    const rest = peers.filter((q) => q.slug !== fp.slug);
    return fp.y - Math.log10(v1Price(bySlug.get(fp.slug)!, snapshot.as_of, v1Multiples(rest, bySlug)));
  });
  const v1SplitErrors = test.map((fp) => fp.y - Math.log10(v1Price(bySlug.get(fp.slug)!, snapshot.as_of, v1Multiples(train, bySlug))));

  return {
    fitted: { loo: fittedLoo, split: fittedSplit, split_cutoff: cutoff },
    tvl_only: { loo: tvlLoo, split: tvlSplit },
    v1: { loo: summarise(peers, v1LooErrors), split: summarise(test, v1SplitErrors) },
  };
}

/* ------------------------------------------------------------------ */
/* Launch odds, read from the peers' record                            */
/* ------------------------------------------------------------------ */

/** One protocol's launch odds: the share of its closest peers that already trade a token. */
export interface LaunchOdds {
  pct: number;
  group_n: number;
  group_tokenised: number;
  basis: string;
}

/**
 * The peer group is widened a step at a time until it holds at least FIT.odds_min_group
 * protocols: same category, similar age and within 5x the TVL first; then the same category
 * and TVL band; then the whole category; then similar age and TVL across categories; then
 * the whole snapshot. The basis string says which group the figure was read from.
 */
export function launchOdds(subject: Protocol, snapshot: Snapshot): LaunchOdds {
  const subjectAge = listedAgeDays(snapshot.as_of, subject.listed_at);
  const inTvl = (q: Protocol): boolean =>
    q.tvl_usd >= subject.tvl_usd / FIT.odds_tvl_factor && q.tvl_usd <= subject.tvl_usd * FIT.odds_tvl_factor;
  const inAge = (q: Protocol): boolean => {
    if (subjectAge === null) return true;
    const qa = listedAgeDays(snapshot.as_of, q.listed_at);
    return qa !== null && Math.abs(qa - subjectAge) <= FIT.odds_age_band_days;
  };
  const sameCat = (q: Protocol): boolean => subject.category !== null && q.category === subject.category;
  const levels: { keep: (q: Protocol) => boolean; basis: (n: number, t: number) => string }[] = [
    {
      keep: (q) => sameCat(q) && inAge(q) && inTvl(q),
      basis: (n, t) => `of the ${n} ${subject.category} protocols within 5x its TVL and a similar age, ${t} already trade a token`,
    },
    {
      keep: (q) => sameCat(q) && inTvl(q),
      basis: (n, t) => `of the ${n} ${subject.category} protocols within 5x its TVL, ${t} already trade a token`,
    },
    {
      keep: (q) => sameCat(q),
      basis: (n, t) => `of the ${n} ${subject.category} protocols in the snapshot, ${t} already trade a token`,
    },
    {
      keep: (q) => inAge(q) && inTvl(q),
      basis: (n, t) => `of the ${n} protocols within 5x its TVL and a similar age, ${t} already trade a token`,
    },
    {
      keep: () => true,
      basis: (n, t) => `of all ${n} protocols in the snapshot, ${t} already trade a token`,
    },
  ];
  for (const level of levels) {
    const group = snapshot.protocols.filter(level.keep);
    if (group.length >= FIT.odds_min_group) {
      const tokenised = group.filter((q) => !recordsNoToken(q)).length;
      return {
        pct: Math.round((100 * tokenised) / group.length),
        group_n: group.length,
        group_tokenised: tokenised,
        basis: level.basis(group.length, tokenised),
      };
    }
  }
  const all = snapshot.protocols;
  const tokenised = all.filter((q) => !recordsNoToken(q)).length;
  return { pct: Math.round((100 * tokenised) / all.length), group_n: all.length, group_tokenised: tokenised, basis: levels[levels.length - 1]!.basis(all.length, tokenised) };
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

/** One scored protocol: the board row and the dashboard's row are two spellings of this. */
export interface Scored {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  age_known: boolean;
  on_watchlist: boolean;
  /** The fitted line's terms at this protocol, in log10 dollars, each rounded for display. */
  terms: { intercept: number; tvl: number; growth: number; age: number; chains: number };
  implied_value_usd: number;
  odds: LaunchOdds;
}

/** Score one pre-token protocol under the fitted model. */
export function score(p: Protocol, snapshot: Snapshot, fit: FittedModel, medianAgeDays: number, onWatchlist: boolean): Scored {
  const t = predictTerms(fit, p, snapshot.as_of, medianAgeDays);
  const implied = Math.round(clamp(10 ** t.total, 1, 1e14));
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: listedAgeDays(snapshot.as_of, p.listed_at),
    age_known: t.ageKnown,
    on_watchlist: onWatchlist,
    terms: {
      intercept: round4(t.intercept), tvl: round4(t.tvl), growth: round4(t.growth),
      age: round4(t.age), chains: round4(t.chains),
    },
    implied_value_usd: implied,
    odds: launchOdds(p, snapshot),
  };
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * May the radar rank this protocol below the floor? Only a launch still to come: it records no
 * token, and it is not an exchange, a versioned pool, or a wrapped / staked / bridged product of
 * a token that already trades — the same ground the house's watchlist rule skips.
 */
export function rankableBelowFloor(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Why a pre-token protocol is not ranked, in the order the integrity strip checks. */
export function exclusionReason(p: Protocol, floorUsd: number): string {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return 'product_category';
  if (VERSIONED_NAME.test(p.name)) return 'versioned_name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped_or_staked_name';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange_product';
  // At or above the floor yet off the house watchlist: the house also weighs each protocol's
  // parent, a DefiLlama record the snapshot does not carry, so the reason is not in the data.
  if (p.tvl_usd >= floorUsd) return 'above_floor_unlisted';
  return 'other';
}

/** The board's subjects: every watchlist protocol, then the strongest early ones below the floor. */
export function boardSubjects(snapshot: Snapshot): { chosen: Protocol[]; onWatchlist: Set<string> } {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const onWatchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && rankableBelowFloor(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, FIT.early_rows);
  for (const p of early) chosen.set(p.slug, p);
  return { chosen: [...chosen.values()], onWatchlist };
}

/** Score and rank the board: implied value descending, then TVL, then slug — ranks 1..N. */
export function buildBoard(snapshot: Snapshot, fit: FittedModel, medianAgeDays: number): Scored[] {
  const { chosen, onWatchlist } = boardSubjects(snapshot);
  const scored = chosen.map((p) => score(p, snapshot, fit, medianAgeDays, onWatchlist.has(p.slug)));
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  return scored;
}

/* ------------------------------------------------------------------ */
/* Integrity: every protocol in the snapshot, accounted for once       */
/* ------------------------------------------------------------------ */

/** The whole snapshot accounted for: where each of its protocols went, and why. */
export interface Integrity {
  total: number;
  tokenised: number;
  pretoken: number;
  ranked: number;
  ranked_watchlist: number;
  ranked_early: number;
  excluded_total: number;
  excluded: { product_category: number; versioned_name: number; wrapped_or_staked_name: number; exchange_product: number; above_floor_unlisted: number; other: number };
}

export function integrityOf(snapshot: Snapshot): Integrity {
  const { chosen } = boardSubjects(snapshot);
  const chosenSlugs = new Set(chosen.map((p) => p.slug));
  const excluded = { product_category: 0, versioned_name: 0, wrapped_or_staked_name: 0, exchange_product: 0, above_floor_unlisted: 0, other: 0 };
  let tokenised = 0;
  let pretoken = 0;
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      tokenised++;
      continue;
    }
    pretoken++;
    if (!chosenSlugs.has(p.slug)) excluded[exclusionReason(p, snapshot.floor_usd) as keyof typeof excluded]++;
  }
  const rankedWatchlist = chosen.filter((p) => snapshot.watchlist.includes(p.slug)).length;
  return {
    total: snapshot.protocols.length,
    tokenised,
    pretoken,
    ranked: chosen.length,
    ranked_watchlist: rankedWatchlist,
    ranked_early: chosen.length - rankedWatchlist,
    excluded_total: pretoken - chosen.length,
    excluded,
  };
}

/** A tokenised protocol, shown at the market's own value in the dashboard's peer view. */
export interface PeerRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
  symbol: string | null;
}

/** The tokenised peer set for the dashboard: the largest by market cap, at the market's own values. */
export function buildPeers(snapshot: Snapshot): PeerRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, FIT.peer_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0),
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** The snapshot out of a file's text, refused unless it carries the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
