// Token Radar dashboard (radar-3). It reads window.RADAR — the data.js that main.ts writes
// beside dashboard/ — and renders the ranked board: a filterable table plus a per-protocol
// detail drawer showing the model's own inputs and the protocol's farm plan. No network
// is involved: every byte on screen comes from data.js.
//
// The page recomputes each row from the snapshot figures with the same arithmetic main.ts
// runs, so the page's code and the board's data visibly agree. The farm plan is the same
// derivation main.ts writes into board.json. No protocol name is special-cased anywhere.
(function () {
  'use strict';

  // The data main.ts wrote, and the mount point the page renders into.
  var RADAR = window.RADAR;
  if (!RADAR) return;
  var mount = document.getElementById('board');
  var ON_WATCH = {};
  (RADAR.watchlist || []).forEach(function (slug) { ON_WATCH[slug] = true; });
  var view = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, page: 0 };
  var PAGE_LEN = 50;

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function missing(n) { return n === null || n === undefined || !isFinite(n); }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function pctText(n) {
    if (missing(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function money(n) {
    if (missing(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }

  // radar-3, the model in one place. Age is a hump: it climbs to a peak at 2.5 years and then
  // decays, because a protocol that has run for years with no token has had its window to
  // launch. Reach rewards the number of chains; standing rewards the protocol's TVL
  // percentile within its own category.
  function ageCurve(age, model) {
    var days = age === null || age === undefined ? model.unknown_age_days : age;
    if (days <= model.age_rise_days) return model.age_base + ((model.age_peak - model.age_base) * days) / model.age_rise_days;
    var past = Math.min(days - model.age_rise_days, model.age_decay_days);
    return model.age_peak - ((model.age_peak - model.age_floor) * past) / model.age_decay_days;
  }
  function recomputeImplied(row, model) {
    var weekly = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var clamped = Math.min(model.growth_cap, Math.max(model.growth_floor, weekly));
    var growthMult = 1 + (clamped / 100) * model.growth_weight;
    var ageMult = ageCurve(row.age_days, model);
    var chainCount = Math.min(Math.max((row.chains || []).length, 0), model.reach_chains);
    var reach = model.reach_base + (model.reach_range * chainCount) / model.reach_chains;
    var pct = row.standing_pct === null || row.standing_pct === undefined ? 0.5 : row.standing_pct;
    var standing = model.standing_base + model.standing_range * Math.min(Math.max(pct, 0), 1);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * ageMult * reach * standing));
  }

  // The model sandbox: null means the board's stored model (RADAR.model, the defaults main.ts
  // scored with); a set of constants means the reader moved a slider and the board re-scores
  // live with those. When the sliders return to the defaults the sandbox clears itself, so the
  // default state is bit-identical to board.json.
  var sandbox = null;
  function activeModel() { return sandbox || RADAR.model; }
  function displayImplied(row) { return sandbox ? recomputeImplied(row, sandbox) : row.implied_value_usd; }

  // A tiny element builder: h('div', {class: 'x', text: 'hi'}, child, ...) — attributes are
  // class/text/html/on* handlers, everything else becomes a DOM attribute.
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function firstChain(proto) { return proto.chains && proto.chains.length > 0 ? proto.chains[0] : 'its main chain'; }
  function chainSummary(proto) {
    if (!proto.chains || proto.chains.length === 0) return 'its main chain';
    if (proto.chains.length === 1) return proto.chains[0];
    var shown = proto.chains.slice(0, 3);
    return shown.join(', ') + (proto.chains.length > 3 ? ' and ' + (proto.chains.length - 3) + ' more' : '');
  }
  function suggestedCapital(proto) {
    if (proto.tvl_usd >= 5e9) return 250;
    if (proto.tvl_usd >= 1e9) return 150;
    if (proto.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdWindow(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function planAction(proto, capital, chain) {
    var cat = (proto.category || '').toLowerCase();
    var name = proto.name;
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0 || cat.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (cat.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (cat.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (cat.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (cat.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield asset on " + chain + ' and hold it.';
    if (cat.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (cat.indexOf('option') >= 0) return 'Deposit $' + capital + ' of USDC as collateral on ' + name + ' and write one small covered position.';
    if (cat.indexOf('nft') >= 0 || cat.indexOf('gaming') >= 0 || cat.indexOf('game') >= 0) return 'Buy or mint $' + capital + ' of the in-app asset on ' + name + ' and use it in one session.';
    if (cat.indexOf('ai') >= 0 || cat.indexOf('compute') >= 0 || cat.indexOf('depin') >= 0) return 'Spend $' + capital + " on " + name + "'s compute or service credits on " + chain + ' and run one job.';
    if (cat.indexOf('aggregator') >= 0) return 'Route $' + capital + ' of swaps through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (cat.indexOf('farm') >= 0 || cat.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (cat.indexOf('liquid') >= 0) return 'Mint $' + capital + ' of the liquid receipt token through ' + name + ' on ' + chain + ' and hold it.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function finishStep(step) {
    var text = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (text.length > 600) text = text.slice(0, 596) + '...';
    if (text.length < 20) text = text + " Hold the position and check the protocol's own page.";
    return text;
  }
  // The category's own risk, in one clause: what can go wrong farming this kind of protocol.
  function riskFor(proto) {
    var cat = (proto.category || '').toLowerCase();
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) return 'a borrow can be liquidated if collateral falls — keep the health factor above 2';
    if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0 || cat.indexOf('leveraged farm') >= 0) return 'a pool can lose value to impermanent loss — check the position weekly';
    if (cat.indexOf('liquidity') >= 0) return 'a managed position can be rebalanced into a loss — check the range weekly';
    if (cat.indexOf('bridge') >= 0) return 'a bridge can pause mid-transfer — never farm with funds you need this week';
    if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) return 'staking can lock funds and slashing can cut them — check the unstaking delay first';
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) return 'funding can turn against an open hedge — close it if the rate flips';
    if (cat.indexOf('prediction') >= 0) return 'a market can resolve against you — never bet more than the farm capital';
    if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) return 'a vault can change strategy or cap deposits — re-check its allocation before adding funds';
    if (cat.indexOf('stable') >= 0 || cat.indexOf('anchor') >= 0 || cat.indexOf('btc') >= 0) return "a peg can slip — watch the wrapped asset's price before you mint or deposit";
    if (cat.indexOf('rwa') >= 0) return 'an issuer can pause redemptions — keep the farm capital small enough to wait';
    if (cat.indexOf('insurance') >= 0) return 'cover has exclusions — read the terms before you rely on a claim';
    if (cat.indexOf('option') >= 0) return 'an option can expire worthless — size the position so a loss is only the farm capital';
    if (cat.indexOf('nft') >= 0 || cat.indexOf('gaming') >= 0 || cat.indexOf('game') >= 0) return 'an in-app asset can lose its market — buy only what you would use anyway';
    if (cat.indexOf('ai') >= 0 || cat.indexOf('compute') >= 0 || cat.indexOf('depin') >= 0) return 'service credits can expire — spend them before the farm window ends';
    if (cat.indexOf('aggregator') >= 0) return 'a route can slip on a thin pair — check the quoted price before you sign';
    if (cat.indexOf('farm') >= 0 || cat.indexOf('vault') >= 0) return 'a vault can change strategy or cap deposits — re-check its allocation before adding funds';
    if (cat.indexOf('liquid') >= 0) return 'a liquid receipt token can depeg from the underlying — watch the ratio weekly';
    if (cat.indexOf('chain') >= 0) return 'a chain can halt or upgrade — keep a way out that does not depend on one network';
    if (cat.indexOf('payments') >= 0) return 'a payment flow can be frozen by a counterparty — never farm with funds you need to spend';
    return 'the protocol can pause or change its points rules — re-check its own page before you act';
  }
  function planFor(proto) {
    var chain = firstChain(proto);
    var chains = chainSummary(proto);
    var capital = suggestedCapital(proto);
    var hold = holdWindow(proto.age_days);
    var gas = capital >= 150 ? 8 : 4;
    var repeat = (proto.chains || []).length <= 1
      ? 'Repeat the qualifying action on ' + chain + ', the only chain ' + proto.name + ' runs on, so the activity is not a one-off.'
      : 'Repeat the qualifying action on every chain ' + proto.name + ' runs on (' + chains + '), one transaction per chain, so the activity is visible on each of them.';
    return [
      { text: 'Use a fresh wallet on ' + chain + ' for ' + proto.name + ' that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: planAction(proto, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: repeat, cost: 'about $' + gas + ' of gas per chain', time: '10 minutes per chain' },
      { text: 'Make one qualifying action each week on ' + proto.name + ', such as a deposit, a borrow, a swap or a vote, and vary the action so the activity reads as real use.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the ' + proto.name + ' position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Once a month open " + proto.name + "'s own points or rewards page, check that the wallet and its actions are counted, and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes a month' },
      { text: "Never connect a wallet to a link from a direct message, a reply or a search ad: airdrop scams copy " + proto.name + "'s own page and drain the wallet that signs.", cost: 'nothing, and it saves the whole position', time: '5 minutes to verify the link' },
      { text: "Watch " + proto.name + "'s own risk: " + riskFor(proto) + '.', cost: 'nothing but the habit', time: '5 minutes a week' },
      { text: 'Write the wallet, the dates and every ' + proto.name + ' transaction in a farm log, then plan the exit: withdraw in tranches once the snapshot window has passed.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(finishStep);
  }

  // The view lives in the URL hash, so a filtered board or an open detail can be shared.
  function loadFromHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('watch') === '1') view.watchOnly = true;
  }
  function saveToHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.watchOnly) params.set('watch', '1');
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The rows the current filters leave, in board order; sorting happens on top of this.
  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return RADAR.rows.filter(function (row) {
      if (view.category !== 'all' && row.category !== view.category) return false;
      if (view.chain !== 'all' && !(row.chains || []).includes(view.chain)) return false;
      if (view.watchOnly && !ON_WATCH[row.slug]) return false;
      if (!q) return true;
      var hay = [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function orderedRows(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = displayImplied(a); bv = displayImplied(b); }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function pageHeader() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + RADAR.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: RADAR.model_version + ' model' })
      )
    );
  }

  function introStrip() {
    var totalTvl = RADAR.rows.reduce(function (sum, row) { return sum + row.tvl_usd; }, 0);
    var ordered = RADAR.rows.slice().sort(function (a, b) { return displayImplied(a) - displayImplied(b); });
    var med = ordered[Math.floor(RADAR.rows.length / 2)];
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: RADAR.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(RADAR.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar ranks every other genuine pre-token protocol too — ' + RADAR.early_size + ' of them — so the board covers the whole pre-token universe the snapshot can see. Implied value is a model, not a promise.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: RADAR.watchlist_size + ' / ' + RADAR.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(RADAR.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Board TVL' }), h('b', { text: money(totalTvl) })),
        h('div', { class: 'fact' }, h('span', { text: 'Median implied value' }), h('b', { text: money(med ? displayImplied(med) : 0) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(RADAR.live_size) }))
      )
    );
  }

  function topMovers() {
    // Moves over 500% in a week are set aside as likely data artefacts: the strip's first entry
    // in radar-2 was a +4448% row, a re-listing, not a protocol growing. The rest is the fastest
    // genuine weekly growth on the board.
    var list = RADAR.rows.filter(function (row) { return row.change_7d !== null && row.change_7d <= 500; }).sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 5);
    if (list.length === 0) return null;
    return h('section', { class: 'movers', 'aria-label': 'Fastest growing this week' },
      h('span', { class: 'movers-label', text: 'Fastest 7d growth' }),
      list.map(function (row) {
        return h('button', { class: 'mover', type: 'button', onclick: function () { showDetail(row.slug); } },
          h('b', { text: row.name }), h('span', { class: 'pos', text: pctText(row.change_7d) }), h('span', { class: 'sub', text: 'rank ' + row.rank })
        );
      }),
      h('span', { class: 'sub', text: 'Moves over 500% set aside as likely data artefacts.' })
    );
  }

  function filterControls() {
    var categories = Array.from(new Set(RADAR.rows.map(function (row) { return row.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(RADAR.rows.reduce(function (all, row) { return all.concat(row.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; view.page = 0; saveToHash(); paint(); });
    var select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; view.page = 0; saveToHash(); paint(); });
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; view.page = 0; saveToHash(); paint(); });
    var watchBtn = h('button', { class: 'button toggle', type: 'button', 'aria-pressed': view.watchOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { view.watchOnly = !view.watchOnly; view.page = 0; saveToHash(); paint(); } });
    var pre = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; paint(); } });
    var live = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; paint(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Scope' }), watchBtn),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : RADAR.live.length + ' live-token protocols' })
    );
  }

  // A sortable column head: clicking flips direction on the active column, else selects it.
  function sortHead(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); } },
        label,
        view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function pager(list) {
    var pages = Math.max(1, Math.ceil(list.length / PAGE_LEN));
    if (view.page >= pages) view.page = pages - 1;
    if (view.page < 0) view.page = 0;
    var start = view.page * PAGE_LEN;
    var prev = h('button', { class: 'button', type: 'button', text: 'Previous', disabled: view.page === 0 ? 'disabled' : null, onclick: function () { view.page--; paint(); } });
    var next = h('button', { class: 'button', type: 'button', text: 'Next', disabled: view.page >= pages - 1 ? 'disabled' : null, onclick: function () { view.page++; paint(); } });
    return h('div', { class: 'pager' },
      h('span', { class: 'sub', text: 'Showing ' + (list.length === 0 ? 0 : start + 1) + '–' + Math.min(start + PAGE_LEN, list.length) + ' of ' + list.length }),
      h('span', { class: 'pager-pages', text: 'Page ' + (view.page + 1) + ' of ' + pages }),
      prev, next
    );
  }

  // One row of the board: rank, protocol, TVL, 7d growth, age, implied value, token status.
  // liveRank is the row's position in the re-scored order when the sandbox is active and the
  // board is sorted by implied value; otherwise the stored board rank is shown.
  function boardRow(row, maxImplied, liveRank) {
    var growth = row.change_7d === null ? 'n/a' : pctText(row.change_7d);
    var growthClass = row.change_7d === null ? '' : row.change_7d >= 0 ? 'pos' : 'neg';
    var shownRank = liveRank || row.rank;
    var rankClass = shownRank <= 3 ? 'rank-top' : '';
    var implied = displayImplied(row);
    return h('tr', {
      'data-selected': view.selected === row.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { showDetail(row.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(row.slug); } }
    },
      h('td', { class: 'num ' + rankClass, text: String(shownRank) }),
      h('td', null, h('div', { class: 'name' },
        h('b', { text: row.name }),
        h('span', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
        ON_WATCH[row.slug] ? h('span', { class: 'badge', text: 'Watchlist' }) : null
      )),
      h('td', { class: 'num', text: money(row.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: ageText(row.age_days) }),
      h('td', null, h('div', { class: 'implied' },
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((implied / maxImplied) * 100)) + '%' })),
        h('span', { class: 'num', text: money(implied) })
      )),
      h('td', null, h('span', { class: 'status', text: 'no token' }))
    );
  }

  function boardTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.watchOnly = false; view.page = 0; saveToHash(); paint(); } })
      ));
    }
    var max = RADAR.rows.reduce(function (m, row) { return Math.max(m, displayImplied(row)); }, 1);
    var pages = Math.max(1, Math.ceil(list.length / PAGE_LEN));
    if (view.page >= pages) view.page = pages - 1;
    if (view.page < 0) view.page = 0;
    var page = list.slice(view.page * PAGE_LEN, view.page * PAGE_LEN + PAGE_LEN);
    var tbody = h('tbody');
    page.forEach(function (row, i) {
      var liveRank = sandbox && view.sort === 'implied' ? view.page * PAGE_LEN + i + 1 : null;
      tbody.appendChild(boardRow(row, max, liveRank));
    });
    return h('div', null,
      h('div', { class: 'panel' },
        h('div', { class: 'table-wrap' },
          h('table', null,
            h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' + (sandbox ? ' Sandbox values in use: the table is re-scored with your settings, not the board’s stored values.' : '') }),
            h('thead', null, h('tr', null,
              sortHead('implied', 'Rank'),
              sortHead('name', 'Protocol'),
              sortHead('tvl', 'TVL'),
              sortHead('growth', '7d'),
              sortHead('age', 'Age'),
              sortHead('implied', 'Implied value'),
              h('th', { scope: 'col', text: 'Token' })
            )),
            tbody
          )
        )
      ),
      pager(list)
    );
  }

  function liveTable() {
    var tbody = h('tbody');
    RADAR.live.forEach(function (row) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: row.name }), h('span', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: money(row.tvl_usd) }),
        h('td', { class: 'num ' + (row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg'), text: pctText(row.change_7d) }),
        h('td', { class: 'num', text: money(row.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The model sandbox: four sliders re-score the whole board live, and reset restores the
  // model's defaults. A slider's input updates its value label at once; the board re-renders
  // when the slider is released (change), so dragging stays smooth. When every slider sits on
  // its default the sandbox clears itself, so the default state is the board's stored model.
  var SANDBOX_SLIDERS = [
    { key: 'base_multiple', label: 'Base multiple', min: 0.10, max: 0.50, step: 0.01, fmt: function (v) { return v.toFixed(2); } },
    { key: 'growth_weight', label: 'Growth weight', min: 0, max: 1, step: 0.05, fmt: function (v) { return v.toFixed(2); } },
    { key: 'growth_cap', label: 'Growth cap (%)', min: 50, max: 200, step: 10, fmt: function (v) { return String(v); } },
    { key: 'age_peak', label: 'Age peak', min: 0.8, max: 1.2, step: 0.05, fmt: function (v) { return v.toFixed(2); } },
  ];
  function setSandbox(key, value) {
    var m = sandbox ? Object.assign({}, sandbox) : Object.assign({}, RADAR.model);
    m[key] = value;
    var atDefaults = SANDBOX_SLIDERS.every(function (s) { return m[s.key] === RADAR.model[s.key]; });
    sandbox = atDefaults ? null : m;
  }
  function sandboxPanel() {
    var active = activeModel();
    var rows = SANDBOX_SLIDERS.map(function (s) {
      var out = h('output', { class: 'num', text: s.fmt(active[s.key]) });
      var input = h('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step), value: String(active[s.key]), 'aria-label': s.label });
      input.addEventListener('input', function () { out.textContent = s.fmt(parseFloat(input.value)); });
      input.addEventListener('change', function () { setSandbox(s.key, parseFloat(input.value)); paint(); });
      return h('div', { class: 'sandbox-row' },
        h('label', { text: s.label }),
        input,
        out
      );
    });
    return h('div', { class: 'sandbox' },
      h('h3', { text: 'Model sandbox' }),
      h('p', { class: 'sub', text: sandbox ? 'Sandbox active: the table is re-scored with these settings. Reset restores the model defaults — the values board.json carries.' : 'Move a constant to re-score the whole board live. The board’s stored values use the defaults above; the sandbox never changes board.json.' }),
      rows,
      h('button', { class: 'button', type: 'button', text: 'Reset to the model defaults', onclick: function () { sandbox = null; paint(); } })
    );
  }

  function modelSection() {
    var m = RADAR.model;
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x age_factor x reach x standing )'
      ),
      h('p', { class: 'sub', text: 'Age is a hump, not a ladder: the factor rises from ' + m.age_base + ' at launch to ' + m.age_peak + ' at ' + Math.round(m.age_rise_days / 365 * 10) / 10 + ' years, then decays toward ' + m.age_floor + ' over ' + Math.round(m.age_decay_days / 365 * 10) / 10 + ' more years — a protocol that has run years with no token has had its window to launch. Reach is ' + m.reach_base + ' + ' + m.reach_range + ' x min(chains, ' + m.reach_chains + ') / ' + m.reach_chains + '. Standing is ' + m.standing_base + ' + ' + m.standing_range + ' x the protocol’s TVL percentile within its own category. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. Wrapped, staked and bridged products of a token that already trades are never ranked as pre-token rows.' }),
      sandboxPanel()
    );
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; saveToHash(); });

  // One labelled bar in the detail drawer: the factor's value against its plausible max.
  function factorRow(label, value, max) {
    return h('div', { class: 'factor' },
      h('span', { text: label }),
      h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((value / max) * 100)) + '%' })),
      h('b', { class: 'num', text: String(value) })
    );
  }

  function showDetail(slug) {
    var row = RADAR.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    saveToHash();
    dialog.textContent = '';
    var steps = planFor(row);
    var recomputed = recomputeImplied(row, activeModel());
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + RADAR.board_size + (ON_WATCH[row.slug] ? ' · Watchlist' : '') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pctText(row.change_7d) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageText(row.age_days) })),
        h('div', null, h('span', { text: 'Chains' }), h('b', { class: 'num', text: String((row.chains || []).length) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Age factor' }), h('b', { class: 'num', text: String(row.age_factor) })),
        h('div', null, h('span', { text: 'Reach' }), h('b', { class: 'num', text: String(row.reach_multiplier) })),
        h('div', null, h('span', { text: 'Category standing' }), h('b', { class: 'num', text: String(row.standing_multiplier) })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      h('div', { class: 'factors' },
        factorRow('Growth', row.growth_multiplier, 2.2),
        factorRow('Age', row.age_factor, 1),
        factorRow('Reach', row.reach_multiplier, 1),
        factorRow('Standing', row.standing_multiplier, 1.1)
      ),
      h('p', { class: 'sub', text: 'Model ' + RADAR.model_version + ': the same function scores every protocol. ' + (sandbox ? 'The sandbox is active, so this row recomputes as ' + money(recomputed) + ' with your settings, against ' + money(row.implied_value_usd) + ' in board.json.' : 'The page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.')) + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // Rebuild the whole page from the current view: header, lede, movers, controls, table.
  function paint() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(pageHeader());
    shell.appendChild(introStrip());
    shell.appendChild(topMovers());
    shell.appendChild(filterControls());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    if (view.tab === 'pre-token') shell.appendChild(modelSection());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) showDetail(view.selected);
  }

  loadFromHash();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
