// Farm plans, version 2: a verdict and a sized position first, then concrete steps generated
// from the protocol's own record — category, chains, TVL, age, its 7-day move and the launch
// odds the model read from its peers — never from a hand-written list of protocol names.
//
// The board's top rows (main.ts decides how many) get the detailed plan below: eight steps
// that open with the verdict and its reasoning, size the ticket to the verdict, route the
// entry around the protocol's own week, and set the hold from its age and odds. Every other
// row keeps the six-step plan, which is version 1's generator unchanged in shape: it was
// already concrete, and a board of 178 bespoke essays would be written by no honest program.
//
// Every step states the action, what it costs and how long it takes, in one string. The
// wording is picked from several phrasings by a hash of the protocol's slug, so two runs
// write the same bytes and two neighbouring rows do not read as one stamped template.

import type { LaunchOdds, Protocol } from './model.ts';

/** A small stable hash of a slug: the plan's phrasing seed. */
function seedOf(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pick one phrasing: `pick(seed, salt, variants)` is stable for a given protocol. */
function pick<T>(seed: number, salt: number, variants: readonly T[]): T {
  return variants[Math.abs(seed >> (salt * 3)) % variants.length]!;
}

/** Gas for one ordinary transaction on a chain, in dollars, as a farmer on that chain would meet it. */
const GAS_USD: Record<string, number> = {
  Ethereum: 9, Solana: 0.1, Base: 0.25, Arbitrum: 0.35, BSC: 0.5, Polygon: 0.08, Avalanche: 0.7,
  'OP Mainnet': 0.3, 'zkSync Era': 0.4, Linea: 0.4, Scroll: 0.4, Mantle: 0.2, Gnosis: 0.05,
  Fantom: 0.3, Cronos: 0.2, Sui: 0.05, Aptos: 0.05, Near: 0.05,
};

function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? 1.2;
}

function gasText(chain: string): string {
  const g = gasUsd(chain);
  return g < 1 ? `about $${g.toFixed(2)}` : `about $${Math.round(g)}`;
}

/** Working capital for one farm position, scaled to the protocol's size: bigger pools, bigger ticket. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 75;
  return 50;
}

/** How long a position should rest to count in more than one weekly snapshot, from the protocol's age. */
function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  if (ageDays < 730) return 35;
  return 30;
}

/** The whole cost of a plan: the sized capital plus gas for the setup and the weekly touches. */
export function planCostUsd(chain: string, capital: number, holdDays: number): number {
  const touches = 4 + Math.ceil(holdDays / 7);
  return capital + Math.round(gasUsd(chain) * touches);
}

type Group = 'lending' | 'dex' | 'vault' | 'staking' | 'derivatives' | 'bridge' | 'rwa' | 'chain' | 'plain';

/** The product family a category farms like. */
function groupOf(category: string | null): Group {
  switch (category) {
    case 'Lending': case 'CDP': return 'lending';
    case 'Dexs': case 'Liquidity Manager': case 'Leveraged Farming': case 'Farm': return 'dex';
    case 'Risk Curators': case 'Onchain Capital Allocator': case 'Yield': case 'Yield Aggregator':
    case 'Basis Trading': case 'Indexes': return 'vault';
    case 'Staking Pool': case 'Restaking': return 'staking';
    case 'Derivatives': case 'Options': return 'derivatives';
    case 'Cross Chain Bridge': return 'bridge';
    case 'RWA': return 'rwa';
    case 'Chain': return 'chain';
    default: return 'plain';
  }
}

/** The opening move, per family: the product action a farmer actually performs first. */
function openingMove(g: Group, name: string, chain: string, capital: number): string {
  switch (g) {
    case 'lending': return `Supply $${capital} of USDC as collateral in ${name}'s main market on ${chain}`;
    case 'dex': return `Add $${capital} of liquidity to ${name}'s busiest pool on ${chain}, split evenly across both assets`;
    case 'vault': return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the same wallet`;
    case 'staking': return `Stake $${capital} worth of the chain's staking asset through ${name} on ${chain}`;
    case 'derivatives': return `Deposit $${capital} of USDC as margin on ${name} and open one small position you can hold overnight`;
    case 'bridge': return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then hold the bridged balance there`;
    case 'rwa': return `Subscribe $${capital} to ${name}'s yield asset on ${chain} and hold the issued shares`;
    case 'chain': return `Bridge $${capital} of USDC onto ${chain} and make ${name} the wallet's home chain for the season`;
    default: return `Deposit $${capital} of USDC into ${name}'s main product on ${chain} and leave the position open`;
  }
}

/** The second move: deepening the same position, per family. */
function deepeningMove(g: Group, name: string, chain: string, secondChain: string | null, capital: number): string {
  const half = Math.max(25, Math.round(capital / 2));
  switch (g) {
    case 'lending': return `Borrow about $${half} against the supply, keeping the health factor above 2, and hold the borrowed funds rather than spending them`;
    case 'dex': return `Stake the LP receipt in ${name}'s own farm or gauge on ${chain}, so the position earns in the protocol's own accounting`;
    case 'vault': return `Place a second $${half} into a different ${name} vault, so the wallet shows up in more than one of its strategies`;
    case 'staking': return `Delegate or restake the receipt token once, so the wallet holds both the stake and one downstream position`;
    case 'derivatives': return `Trade a second small position on a different market of ${name}, bringing the account's volume up without raising its risk`;
    case 'bridge': return `Bridge a second, smaller amount on a different day and in the other direction, so both routes carry the wallet's history`;
    case 'rwa': return `Add a second subscription of about $${half} after the first settles, rather than one large mint on a single day`;
    case 'chain': return secondChain !== null
      ? `Make one swap and one lend inside ${name}'s own apps on ${chain}, the activity native users leave behind`
      : `Make one swap and one lend inside the chain's own apps, the activity native users leave behind`;
    default: return secondChain !== null
      ? `Repeat the core action with about $${half} on ${secondChain}, the protocol's next chain, so the wallet is active in two places`
      : `Repeat the core action once with about $${half} more, a week after the first deposit`;
  }
}

/** One step as the gate reads it: action, cost and time in a single string of 20..600 characters. */
function fitStep(text: string, cost: string, time: string): string {
  let s = `${text.replace(/\.+$/, '')}. Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check it weekly.`;
  return s;
}

/** The fields of a protocol record a farm plan is generated from. */
export type FarmSubject = Pick<Protocol, 'slug' | 'name' | 'category' | 'chains' | 'tvl_usd'>;

/* ------------------------------------------------------------------ */
/* The verdict: how hard to farm this one, and at what size            */
/* ------------------------------------------------------------------ */

/** The plan's verdict: a tier, the ticket it sizes, and the reason in one line. */
export interface Verdict {
  tier: 'Priority farm' | 'Standard farm' | 'Light touch';
  capital: number;
  reason: string;
}

/**
 * The tier is read from the launch odds — the share of the protocol's closest peers that
 * already trade a token — and drops one step when the protocol's own TVL fell hard in the
 * last week, because a shrinking protocol is a worse place to park a season's capital. The
 * ticket scales with the protocol's size, then with the tier: full, three quarters, half.
 */
export function verdictFor(odds: LaunchOdds, change7d: number | null, tvl: number): Verdict {
  let step = odds.pct >= 50 ? 0 : odds.pct >= 35 ? 1 : 2;
  const fellHard = change7d !== null && change7d <= -10;
  if (fellHard) step = Math.min(2, step + 1);
  const base = capitalFor(tvl);
  const capital = Math.max(25, Math.round((base * [1, 0.75, 0.5][step]!) / 5) * 5);
  const tier = (['Priority farm', 'Standard farm', 'Light touch'] as const)[step]!;
  const reason =
    `${odds.pct}% of its closest peers already trade a token` +
    (fellHard ? `, and its TVL fell ${Math.abs(change7d!).toFixed(1)}% this week, so the tier drops one step` : '');
  return { tier, capital, reason };
}

/* ------------------------------------------------------------------ */
/* The detailed plan: the board's top rows                             */
/* ------------------------------------------------------------------ */

/** What the detailed plan needs beyond a farm subject: its rank, value, odds and week. */
export interface DetailedSubject extends FarmSubject {
  rank: number;
  implied_value_usd: number;
  change_7d: number | null;
  odds: LaunchOdds;
  verdict: Verdict;
  hold_days: number;
}

/** An 8-step plan written for this protocol alone: verdict first, then the work. */
export function detailedPlan(s: DetailedSubject): string[] {
  const seed = seedOf(s.slug);
  const group = groupOf(s.category);
  const chain = s.chains[0] ?? 'its main chain';
  const secondChain = s.chains.length > 1 ? s.chains[1]! : null;
  const capital = s.verdict.capital;
  const gas = gasText(chain);
  const hold = s.hold_days;
  const name = s.name;
  const basis = s.odds.basis.charAt(0).toUpperCase() + s.odds.basis.slice(1);

  const verdictStep =
    `Verdict: ${s.verdict.tier} — rank ${s.rank} on the board at an implied launch value of ` +
    `$${s.implied_value_usd.toLocaleString('en-US')}. ${basis}, and the verdict follows from that record: ` +
    `${s.verdict.reason}. Size the position at $${capital} and start this week`;
  const setup = pick(seed, 0, [
    `Start from a fresh wallet funded only with the $${capital} you mean to farm ${name} with, its seed phrase written down offline`,
    `Prepare one wallet for ${name} alone, funded with the $${capital} position and a little ${chain} gas, and no other protocol's funds in it`,
    `Open a clean wallet for this farm, move in $${capital} plus gas money for ${chain}, and keep every other farm out of it`,
  ]);
  const week = s.change_7d;
  const momentumStep =
    week === null
      ? `Its 7-day TVL change is unreported, so split the entry: half the $${capital} now and half in 7 days, so one bad week cannot take the whole ticket in at the top`
      : week <= -5
        ? `Its TVL fell ${Math.abs(week).toFixed(1)}% in the last 7 days: do not enter in one go — place half the $${capital} now and the other half in 7 days, and skip the second half if TVL falls another 5%`
        : week >= 10
          ? `Its TVL rose ${week.toFixed(1)}% in the last 7 days: hot weeks pull in mercenary deposits that leave again, so cap the total at $${capital} and add nothing more until a weekly change prints below +5%`
          : `Its TVL moved ${week >= 0 ? '+' : ''}${week.toFixed(1)}% in the last 7 days, a calm week by this board's standards: enter the full $${capital} in one go rather than dribbling it in`;
  const weekly = pick(seed, 1, [
    `Return once a week and make one small qualifying action — a top-up, a partial borrow or repay, a claim — so the wallet never looks parked`,
    `Touch the position weekly with one real action, such as compounding the yield or adjusting the amount, rather than letting it sit untouched`,
    `Every week, do one genuine transaction in the app — deposit a few dollars, repay a slice, or vote where the protocol holds votes`,
  ]);
  const holdStep =
    s.odds.pct >= 50
      ? `Hold for at least ${hold} days and stay claim-ready: most of ${name}'s peer group already trades, so check the protocol's own announcements every week and keep the position open until a snapshot or claim is announced`
      : `Hold for at least ${hold} days as a patient position: most of ${name}'s peer group is still waiting alongside it, so the wait is the farm — do not churn the wallet chasing a date nobody has announced`;
  const watch = pick(seed, 2, [
    `Open ${name}'s own points or rewards page from the link in its app and confirm the wallet's activity is being counted there`,
    `Check ${name}'s rewards or points dashboard inside its own app and screenshot the wallet's standing for your records`,
    `Look for ${name}'s points page in its app; if the wallet's actions are not reflected after a week, adjust the position until they are`,
  ]);
  const close = pick(seed, 3, [
    `Keep a farm log — wallet, dates, amounts, transaction hashes — and withdraw only after checking the protocol's own announcements for a snapshot or claim date`,
    `Record every step in a simple log with dates and hashes, so the position can be unwound or repeated without guessing`,
    `Note the wallet, the entry dates and each hash in a farm log; when a claim is announced, use only the link the protocol itself publishes`,
  ]);

  return [
    fitStep(verdictStep, `the full plan below runs about $${planCostUsd(chain, capital, hold)} all-in`, '5 minutes to read and size'),
    fitStep(setup, `${gas} of gas for the first funding transaction`, 'about 10 minutes'),
    fitStep(`${openingMove(group, name, chain, capital)}.`, `$${capital} of capital, plus ${gas} of gas`, 'about 15 minutes'),
    fitStep(momentumStep, `no extra capital beyond the $${capital} already sized`, 'about 10 minutes'),
    fitStep(`${deepeningMove(group, name, chain, secondChain, capital)}.`, `up to $${Math.max(25, Math.round(capital / 2))} more capital, plus ${gas} of gas`, 'about 15 minutes'),
    fitStep(weekly, `${gas} of gas a week`, '10 minutes a week'),
    fitStep(holdStep, `the capital stays in the position for the ${hold} days`, `${hold} days`),
    fitStep(`${watch}. ${close}`, 'nothing to check; never pay a fee to claim', 'about 10 minutes'),
  ];
}

/* ------------------------------------------------------------------ */
/* The standard plan: every other row                                  */
/* ------------------------------------------------------------------ */

/**
 * The six-step plan for one protocol. `ageDays` is its listed age in the snapshot (null when
 * the snapshot reports none), used only to set the holding period. `capitalOverride` is the
 * verdict's sized ticket, passed by main.ts so the plan spends exactly what the row's
 * verdict states; without it the plan sizes from TVL alone, as version 1 did.
 */
export function farmPlan(p: FarmSubject, ageDays: number | null, capitalOverride?: number): string[] {
  const seed = seedOf(p.slug);
  const group = groupOf(p.category);
  const chain = p.chains[0] ?? 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalOverride ?? capitalFor(p.tvl_usd);
  const gas = gasText(chain);
  const hold = holdDaysFor(ageDays);
  const name = p.name;

  const setup = pick(seed, 0, [
    `Start from a fresh wallet funded only with the $${capital} you mean to farm ${name} with, its seed phrase written down offline`,
    `Prepare one wallet for ${name} alone, funded with the $${capital} position and a little ${chain} gas, and no other protocol's funds in it`,
    `Open a clean wallet for this farm, move in $${capital} plus gas money for ${chain}, and keep every other farm out of it`,
  ]);
  const weekly = pick(seed, 1, [
    `Return once a week and make one small qualifying action — a top-up, a partial borrow or repay, a claim — so the wallet never looks parked`,
    `Touch the position weekly with one real action, such as compounding the yield or adjusting the amount, rather than letting it sit untouched`,
    `Every week, do one genuine transaction in the app — deposit a few dollars, repay a slice, or vote where the protocol holds votes`,
  ]);
  const watch = pick(seed, 2, [
    `Open ${name}'s own points or rewards page from the link in its app and confirm the wallet's activity is being counted there`,
    `Check ${name}'s rewards or points dashboard inside its own app and screenshot the wallet's standing for your records`,
    `Look for ${name}'s points page in its app; if the wallet's actions are not reflected after a week, adjust the position until they are`,
  ]);
  const close = pick(seed, 3, [
    `Keep a farm log — wallet, dates, amounts, transaction hashes — and withdraw only after checking the protocol's own announcements for a snapshot or claim date`,
    `Record every step in a simple log with dates and hashes, so the position can be unwound or repeated without guessing`,
    `Note the wallet, the entry dates and each hash in a farm log; when a claim is announced, use only the link the protocol itself publishes`,
  ]);

  return [
    fitStep(setup, `${gas} of gas for the first funding transaction`, 'about 10 minutes'),
    fitStep(`${openingMove(group, name, chain, capital)}.`, `$${capital} of capital, plus ${gas} of gas`, 'about 15 minutes'),
    fitStep(`${deepeningMove(group, name, chain, secondChain, capital)}.`, `up to $${Math.max(25, Math.round(capital / 2))} more capital, plus ${gas} of gas`, 'about 15 minutes'),
    fitStep(weekly, `${gas} of gas a week`, '10 minutes a week'),
    fitStep(`Hold the position for at least ${hold} days, so the activity spans several weekly snapshots instead of a single spike`, `the capital stays in the position for the ${hold} days`, `${hold} days`),
    fitStep(`${watch}. ${close}`, 'nothing to check; never pay a fee to claim', 'about 10 minutes'),
  ];
}

/** The hold a detailed plan sets, exported so main.ts prices the same plan it prints. */
export function holdDays(ageDays: number | null): number {
  return holdDaysFor(ageDays);
}
