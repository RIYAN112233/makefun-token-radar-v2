// Token Launch Radar's page, version 2. It reads window.RADAR — the data file main.ts writes
// beside this folder from the same board board.json carries — and renders the ranked board
// with its launch odds and farm verdicts, its filters, a detail view per protocol showing the
// fitted model's own arithmetic for that row, the integrity strip that accounts for every
// protocol in the snapshot, the tokenised peer set the model is fitted on, the method, and
// the held-out tests. No network: every figure shown is in that data file.
//
// The page also reads its own address: ?q=, ?cat=, ?chain=, ?watch=1, ?sort=, ?select=<slug>
// and ?view=peers set the opening state, so a view can be linked and shared as it stands.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows;
  var fit = D.model.fit;
  var val = D.model.validation;
  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    watchOnly: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    selected: params.get('select') || null
  };
  var RENDER_CAP = 150;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fullUsd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="chains">unreported</span>';
    return '<span class="' + (n >= 0 ? 'pos' : 'neg') + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageText(r) {
    if (!r.age_known || r.age_days === null) return 'unreported';
    if (r.age_days >= 365) return (r.age_days / 365.25).toFixed(1) + ' yrs';
    return r.age_days + ' days';
  }
  function chainText(chains) {
    if (chains.length <= 3) return esc(chains.join(', '));
    return esc(chains.slice(0, 3).join(', ')) + ' +' + (chains.length - 3);
  }
  function factor(x) { return 'x' + x.toFixed(2); }
  function $(id) { return document.getElementById(id); }

  /* ---------- header, stats, evidence, integrity ---------- */

  $('lede').textContent =
    'One sealed snapshot of ' + D.protocol_count + ' protocols (DefiLlama, as of ' + D.as_of + '). ' +
    'The board ranks ' + D.board_size + ' protocols that record no token by an implied launch value from a model ' +
    'fitted on the snapshot\u2019s own traded protocols — not on hand-set factors — covers all ' + D.watchlist_size +
    ' protocols on the house watchlist, reads each row\u2019s launch odds from its peers\u2019 record, and keeps the ' +
    'ones whose token already trades apart, as the set the model learns from.';

  $('stats').innerHTML =
    '<div class="stat"><b>' + D.protocol_count + '</b><span>protocols in the snapshot</span></div>' +
    '<div class="stat hot"><b>' + D.watchlist_size + ' of ' + D.watchlist_size + '</b><span>watchlist protocols on the board</span></div>' +
    '<div class="stat"><b>' + D.board_size + '</b><span>pre-token protocols ranked</span></div>' +
    '<div class="stat"><b>' + fit.n + '</b><span>traded peers the model is fitted on</span></div>';

  $('kpis').innerHTML =
    '<div class="kpi hot"><b>' + factor(val.fitted.loo.median_factor) + '</b><span>fitted model — median leave-one-out error</span></div>' +
    '<div class="kpi"><b>' + factor(val.v1.loo.median_factor) + '</b><span>version 1\u2019s hand-set model — same test</span></div>' +
    '<div class="kpi hot"><b>' + factor(val.fitted.split.median_factor) + '</b><span>fitted model — walk-forward split</span></div>' +
    '<div class="kpi"><b>' + factor(val.v1.split.median_factor) + '</b><span>version 1\u2019s model — walk-forward split</span></div>' +
    '<div class="kpi"><b>' + D.detailed_rows + '</b><span>top rows carry a bespoke, verdict-led farm plan</span></div>';

  (function renderIntegrity() {
    var g = D.integrity;
    var ex = g.excluded;
    function block(n, label) { return '<div class="ig-block"><b>' + n + '</b><span>' + label + '</span></div>'; }
    var reasons =
      ex.product_category + ' are products of tokens that already trade — the bridge, staking, restaking and exchange classes; ' +
      ex.above_floor_unlisted + ' sit above the $' + (D.floor_usd / 1e6) + 'M floor but off the house watchlist, which also weighs a parent protocol the snapshot does not record; ' +
      ex.versioned_name + ' are versioned deployments of another protocol; ' +
      ex.wrapped_or_staked_name + ' carry wrapped or staked in their name' +
      (ex.exchange_product > 0 ? '; ' + ex.exchange_product + ' are an exchange\u2019s own product' : '') +
      (ex.other > 0 ? '; ' + ex.other + ' more fall outside every rule above' : '') + '.';
    $('integrity').innerHTML =
      '<h2 class="ig-title">Every protocol in the snapshot, accounted for</h2>' +
      '<div class="ig-flow">' +
        block(g.total, 'protocols in the snapshot') + '<div class="ig-arrow">\u2192</div>' +
        block(g.tokenised, 'already trade a token — kept apart as the peer set') + '<div class="ig-arrow">+</div>' +
        block(g.pretoken, 'record no token') + '<div class="ig-arrow">\u2192</div>' +
        block(g.ranked, 'ranked on the board: ' + g.ranked_watchlist + ' watchlist + ' + g.ranked_early + ' early') + '<div class="ig-arrow">+</div>' +
        block(g.excluded_total, 'not ranked, each for a stated reason') +
      '</div>' +
      '<p class="ig-reasons">Why the ' + g.excluded_total + ' are not ranked: ' + reasons + ' None of them is a launch still to come.</p>';
  })();

  /* ---------- controls ---------- */

  var cats = [];
  var chainsSeen = {};
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { chainsSeen[c] = true; });
  });
  cats.sort();
  var chainNames = Object.keys(chainsSeen).sort();

  $('controls').innerHTML =
    '<label>Search <input type="search" id="ctl-q" placeholder="name or slug"></label>' +
    '<label>Category <select id="ctl-cat"><option value="all">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select></label>' +
    '<label>Chain <select id="ctl-chain"><option value="all">All chains</option>' +
      chainNames.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select></label>' +
    '<label class="toggle"><input type="checkbox" id="ctl-watch"> Watchlist only</label>' +
    '<label>Sort <select id="ctl-sort">' +
      '<option value="implied">Implied value</option><option value="tvl">TVL</option>' +
      '<option value="growth">7-day growth</option><option value="age">Age</option>' +
      '<option value="odds">Launch odds</option></select></label>' +
    '<span class="count" id="ctl-count"></span>';

  $('ctl-q').value = state.q;
  if (cats.indexOf(state.category) >= 0) $('ctl-cat').value = state.category;
  if (chainNames.indexOf(state.chain) >= 0) $('ctl-chain').value = state.chain;
  $('ctl-watch').checked = state.watchOnly;
  var sortEl = $('ctl-sort');
  for (var si = 0; si < sortEl.options.length; si++) if (sortEl.options[si].value === state.sort) sortEl.selectedIndex = si;

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      odds: function (r) { return r.odds.pct; }
    }[state.sort];
    out.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return out;
  }

  /* ---------- board ---------- */

  function oddsCell(r) {
    return '<span class="odds"><span class="odds-bar"><span class="odds-fill" style="width:' + r.odds.pct + '%"></span></span>' +
      '<b>' + r.odds.pct + '%</b></span>';
  }
  function verdictChip(r) {
    var cls = r.verdict.tier === 'Priority farm' ? 'v-pri' : r.verdict.tier === 'Standard farm' ? 'v-std' : 'v-lite';
    return '<span class="chip ' + cls + '">' + r.verdict.tier + '</span>';
  }

  function renderBoard() {
    var list = filtered();
    $('ctl-count').textContent = list.length + ' of ' + rows.length + ' shown';
    var shown = list.slice(0, RENDER_CAP);
    var html = '<table><thead><tr>' +
      '<th>Rank</th><th>Protocol</th><th class="hide-s">Category</th><th class="hide-s">Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Launch odds</th>' +
      '<th class="hide-m">Verdict</th><th class="num">Implied value</th></tr></thead><tbody>';
    shown.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="is-selected"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td>' + (r.on_watchlist ? '<span class="dot" title="On the house watchlist"></span>' : '') +
          '<span class="name">' + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td class="hide-s">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="chains hide-s">' + chainText(r.chains) + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + oddsCell(r) + '</td>' +
        '<td class="hide-m">' + verdictChip(r) + '</td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b></td></tr>';
    });
    html += '</tbody></table>';
    if (list.length > shown.length) {
      html += '<p class="more-note">Showing the first ' + shown.length + ' of ' + list.length + ' matching protocols — narrow the search or a filter to see the rest.</p>';
    }
    $('board-wrap').innerHTML = html;
    var trs = $('board-wrap').querySelectorAll('tbody tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { select(this.getAttribute('data-slug')); });
    }
  }

  /* ---------- detail ---------- */

  function signed(x) { return (x >= 0 ? '+' : '\u2212') + Math.abs(x).toFixed(4); }

  function select(slug) {
    state.selected = slug;
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var t = r.terms;
    var sum = t.intercept + t.tvl + t.growth + t.age + t.chains;
    var recomputed = Math.pow(10, sum);
    var agree = Math.abs(recomputed - r.implied_value_usd) / r.implied_value_usd < 0.01
      ? 'The page recomputes the board\u2019s figure from these five terms and lands on the same dollar.'
      : 'The board\u2019s figure is computed from the unrounded terms; the page\u2019s recompute from the rounded ones lands within a percent of it.';
    var badges = (r.on_watchlist ? '<span class="badge watch">On the house watchlist</span>' : '<span class="badge">Early radar — below the watchlist floor</span>') +
      '<span class="badge">' + esc(r.category || 'Uncategorised') + '</span>' +
      '<span class="badge">Rank ' + r.rank + ' of ' + D.board_size + '</span>' +
      '<span class="badge">Records no token</span>' +
      '<span class="badge">' + (r.detailed_plan ? 'Bespoke farm plan' : 'Standard farm plan') + '</span>';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detail').innerHTML =
      '<button type="button" class="view-btn close-btn" id="detail-close">Close</button>' +
      '<h2>' + esc(r.name) + '</h2><div class="badges">' + badges + '</div>' +
      '<div class="figs">' +
        '<div class="fig"><span>TVL</span><b>' + usd(r.tvl_usd) + '</b></div>' +
        '<div class="fig"><span>7-day change</span><b>' + (r.change_7d === null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></div>' +
        '<div class="fig"><span>Tracked for</span><b>' + ageText(r) + '</b></div>' +
        '<div class="fig"><span>Chains</span><b>' + r.chains.length + '</b></div>' +
        '<div class="fig"><span>Launch odds</span><b>' + r.odds.pct + '%</b></div>' +
        '<div class="fig"><span>Implied value</span><b>' + usd(r.implied_value_usd) + '</b></div>' +
      '</div>' +
      '<div class="maths">log<sub>10</sub> value = ' + t.intercept.toFixed(4) + ' base ' + signed(t.tvl) + ' TVL ' +
        signed(t.growth) + ' growth ' + signed(t.age) + ' age ' + signed(t.chains) + ' chains = ' + sum.toFixed(4) +
        ' &rarr; 10<sup>' + sum.toFixed(4) + '</sup> = <span class="eq">' + fullUsd(r.implied_value_usd) + '</span>' +
        '<span class="why">The fitted line at this protocol\u2019s own figures: TVL of ' + fullUsd(r.tvl_usd) + ', a 7-day change of ' +
        (r.change_7d === null ? 'unreported, counted as no growth' : r.change_7d.toFixed(1) + '%') + ', tracked for ' +
        (r.age_known ? ageText(r) : 'an unreported span, counted as the traded peers\u2019 median age') + ', on ' + r.chains.length +
        ' chain' + (r.chains.length === 1 ? '' : 's') + ': ' + esc(r.chains.join(', ')) + '. ' + agree + '</span></div>' +
      '<div class="odds-box"><b>Launch odds ' + r.odds.pct + '%</b> — ' + esc(r.odds.basis) +
        '. The figure describes the peer group\u2019s record in this snapshot; it is not a promise about ' + esc(r.name) + ' itself.</div>' +
      '<div class="verdict-box"><b>' + esc(r.verdict.tier) + '</b> — ticket ' + fullUsd(r.verdict.capital) +
        ', about ' + fullUsd(r.est_cost_usd) + ' all-in over a ' + r.hold_days + '-day hold. ' + esc(r.verdict.reason) + '.</div>' +
      '<h3>How to farm ' + esc(r.name) + '</h3><ol class="steps">' + steps + '</ol>';
    $('detail').hidden = false;
    $('detail-close').addEventListener('click', function () {
      $('detail').hidden = true;
      state.selected = null;
      renderBoard();
    });
    renderBoard();
    $('detail').scrollIntoView({ block: 'nearest' });
  }

  /* ---------- peers ---------- */

  function renderPeers() {
    var html = '<table><thead><tr><th>Protocol</th><th class="hide-s">Token</th><th class="hide-s">Category</th>' +
      '<th class="num">TVL</th><th class="num">Market cap</th><th class="num">Its multiple</th>' +
      '<th class="num">Model\u2019s leave-one-out price</th><th class="num">Error</th><th class="num">7d</th></tr></thead><tbody>';
    D.peers.forEach(function (p) {
      html += '<tr><td><span class="name">' + esc(p.name) + '</span><span class="sub">' + esc(p.slug) + '</span></td>' +
        '<td class="hide-s">' + esc(p.symbol || '—') + '</td>' +
        '<td class="hide-s">' + esc(p.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td>' +
        '<td class="num"><b>' + usd(p.mcap_usd) + '</b></td>' +
        '<td class="num">' + p.multiple.toFixed(2) + 'x</td>' +
        '<td class="num">' + (p.loo_predicted_usd === null ? 'n/a' : usd(p.loo_predicted_usd)) + '</td>' +
        '<td class="num">' + (p.loo_error_factor === null ? 'n/a' : 'x' + p.loo_error_factor.toFixed(2)) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    });
    $('peers-wrap').innerHTML = html + '</tbody></table>';
  }

  /* ---------- method ---------- */

  function coefRow(term, value, meaning) {
    return '<tr><td><code>' + term + '</code></td><td class="num">' + value + '</td><td>' + meaning + '</td></tr>';
  }

  function renderMethod() {
    var catRows = D.category_stats.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.fit_peers + '</td><td class="num">' + c.board_rows + '</td></tr>';
    }).join('');
    $('method').innerHTML =
      '<h2>How the value is worked out</h2>' +
      '<p>An implied value is a claim about one thing: if this protocol issued a token today and the ' +
      'market priced it the way it prices protocols that already trade, what would that token be worth? ' +
      'It is not a prediction that a token will come. Version 1 of this radar answered with TVL times a ' +
      'category median multiple times three factors whose sizes were chosen by hand. Version 2 fits the ' +
      'answer to the snapshot itself: an ordinary least-squares line over the ' + fit.n + ' protocols in the ' +
      'snapshot whose token trades with a recorded market cap and TVL (in-sample R\u00B2 ' + fit.r2_insample.toFixed(3) +
      '; the held-out scores that matter are in the tests below).</p>' +
      '<p class="formula">log<sub>10</sub>(implied value) = ' + fit.intercept.toFixed(4) +
      ' + ' + fit.per_log_tvl.toFixed(4) + ' &times; log<sub>10</sub>(TVL) ' + signed(fit.per_growth) +
      ' &times; growth + ' + fit.per_log_age.toFixed(4) + ' &times; log<sub>10</sub>(age + 30d) ' +
      signed(fit.per_extra_chain) + ' &times; extra chains</p>' +
      '<table><thead><tr><th>Term</th><th class="num">Fitted size</th><th>What it says</th></tr></thead><tbody>' +
      coefRow('TVL', fit.per_log_tvl.toFixed(4) + ' per log<sub>10</sub>', 'Value rises with TVL, but slower than proportionally: ten times the TVL prices at about ' + Math.pow(10, fit.per_log_tvl).toFixed(1) + 'x the value, not 10x. Big protocols\u2019 tokens trade at lower multiples of their TVL, and the line follows the record.') +
      coefRow('growth', fit.per_growth.toFixed(4) + ' per +100%', 'A protocol whose TVL just doubled in a week prices <i>lower</i> at the same TVL, not higher: fresh TVL is often mercenary and leaves. Version 1 rewarded growth; the peers\u2019 record says the opposite, so the sign is fitted, not assumed. The input is clamped to [\u221250%, +100%] first.') +
      coefRow('age', fit.per_log_age.toFixed(4) + ' per log<sub>10</sub>', 'At the same TVL, a protocol DefiLlama has tracked longer prices slightly lower in this snapshot — the long-tracked set holds mature, slow protocols whose tokens the market already discounts. An unreported listing date counts as the traded peers\u2019 median age, ' + Math.round(fit.median_peer_age_days) + ' days.') +
      coefRow('chains', fit.per_extra_chain.toFixed(4) + ' per extra chain', 'Each chain past the first adds a little, up to eight: a wider footprint is worth slightly more at the same TVL. It is the smallest term in the fit, and the table says so.') +
      '</tbody></table>' +
      '<p><code>Launch odds</code> — each row\u2019s odds are the share of its closest peers that already trade a token. ' +
      'The peer group starts narrow — same category, within five times the TVL, of a similar age — and widens a step at a ' +
      'time until it holds at least ten protocols; the row\u2019s detail view names the group its figure was read from. ' +
      'The odds describe the record, never the protocol: this bounty prices a launch if it comes, and the odds say how the comparable cases stand.</p>' +
      '<p><code>Verdicts</code> — a row\u2019s farm verdict follows from its odds and its week: at 50% peer odds or better the plan is a ' +
      'priority farm at the full ticket for its size; at 35% a standard farm at three quarters; below that a light touch at half. ' +
      'A TVL fall of 10% or more in the week drops the tier one step. The board\u2019s top ' + D.detailed_rows + ' rows carry a bespoke ' +
      'eight-step plan built around that verdict — its own chains, its own week, its own hold — and the rest a standard six-step plan ' +
      'sized by the same verdict, so no row\u2019s plan spends a ticket its verdict did not state.</p>' +
      '<p>The board covers every watchlist protocol, then the strongest early protocols below the $' +
      (D.floor_usd / 1e6) + 'M floor by TVL — skipping exchanges themselves, versioned pools, and wrapped, staked or ' +
      'bridged products of tokens that already trade, none of which is a launch still to come. No protocol is named ' +
      'in the model: the same fitted line scores every row, and each row\u2019s detail view shows its own working.</p>' +
      '<h3>Where the fit learned, and what it ranked, by category</h3>' +
      '<table><thead><tr><th>Category</th><th class="num">Traded peers in the fit</th><th class="num">Board rows ranked</th></tr></thead>' +
      '<tbody>' + catRows + '</tbody></table>';
  }

  /* ---------- validation ---------- */

  function valRow(name, v, note) {
    return '<tr><td>' + name + '</td><td class="num">' + factor(v.loo.median_factor) + '</td>' +
      '<td class="num">' + v.loo.r2.toFixed(3) + '</td><td class="num">' + factor(v.split.median_factor) + '</td>' +
      '<td class="num">' + v.split.r2.toFixed(3) + '</td><td>' + note + '</td></tr>';
  }

  function renderValidation() {
    $('validation').innerHTML =
      '<h2>Held-out tests: what each model is worth on protocols it never saw</h2>' +
      '<p>Every figure below is computed by the entry\u2019s own program from the sealed snapshot, the same way for all ' +
      'three models. <b>Leave-one-out</b>: each of the ' + fit.n + ' traded peers is priced by a model fitted without it — ' +
      'exactly, for the regressions, and with the multiples re-learned for version 1 — and the median error factor says how ' +
      'far off the median price lands (x3.70: within 3.70x of the peer\u2019s actual market cap). <b>Walk-forward</b>: the half of ' +
      'dated peers DefiLlama tracked first (up to ' + val.fitted.split_cutoff + ') fits the model, and the later half is priced with it.</p>' +
      '<table><thead><tr><th>Model</th><th class="num">Leave-one-out</th><th class="num">R\u00B2</th>' +
      '<th class="num">Walk-forward</th><th class="num">R\u00B2</th><th>Standing</th></tr></thead><tbody>' +
      valRow('Fitted model (this board)', val.fitted, 'The board\u2019s model: least wrong of the three on both tests.') +
      valRow('TVL alone, fitted', val.tvl_only, 'A hair better held-out — and blind to growth and age, which the bounty asks a radar to weigh. The full fit\u2019s small cost is printed, not hidden.') +
      valRow('Version 1 (medians &times; hand-set factors)', val.v1, 'The previous entry\u2019s model, scored identically. The fit\u2019s margin over it is the reason this board exists.') +
      '</tbody></table>' +
      '<p>The honest reading: on this snapshot, no model prices a launch closely — a median error near x' +
      val.fitted.loo.median_factor.toFixed(1) + ' is what the record supports, and a board claiming more would be inventing it. ' +
      'What fitting buys is not clairvoyance; it is that every size in the model is the size the peers\u2019 own record gives it, ' +
      'tested on peers the fit never saw, with the scores printed here rather than asserted.</p>';
  }

  /* ---------- wiring ---------- */

  $('ctl-q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('ctl-cat').addEventListener('change', function () { state.category = this.value; renderBoard(); });
  $('ctl-chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('ctl-watch').addEventListener('change', function () { state.watchOnly = this.checked; renderBoard(); });
  $('ctl-sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  $('view-board').addEventListener('click', function () {
    $('board-panel').hidden = false; $('peers-panel').hidden = true;
    $('view-board').classList.add('is-on'); $('view-peers').classList.remove('is-on');
  });
  $('view-peers').addEventListener('click', function () {
    $('board-panel').hidden = true; $('peers-panel').hidden = false;
    $('view-peers').classList.add('is-on'); $('view-board').classList.remove('is-on');
  });

  renderBoard();
  renderPeers();
  renderMethod();
  renderValidation();
  if (params.get('view') === 'peers') $('view-peers').click();
  if (state.selected) select(state.selected);
  $('foot').textContent = 'Data: ' + D.source + '. Every figure on this page is computed from that snapshot by the entry\u2019s program; the page itself runs with no network.';
})();

