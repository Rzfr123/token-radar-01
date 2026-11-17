// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol detail view with the model's own
// inputs, and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', early: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(4);
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. Category multiple comes from the live market of the same category.
  function readinessOf(age, model) {
    if (age <= model.readiness_peak_days) return model.readiness_floor + (1 - model.readiness_floor) * (age / model.readiness_peak_days);
    if (age <= model.readiness_plateau_days) return 1;
    return Math.max(model.readiness_old_floor, 1 - (1 - model.readiness_old_floor) * (Math.min(age - model.readiness_plateau_days, model.readiness_old_days) / model.readiness_old_days));
  }
  function readinessLabel(row, model) {
    var age = row.age_days;
    if (age === null || age === undefined) return 'Unknown age';
    if (age <= model.readiness_peak_days) return age < 180 ? 'Early' : 'Building';
    if (age <= model.readiness_plateau_days) return 'Peak window';
    return 'Seasoned';
  }
  function impliedOf(row, model) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * (growth < 0 ? model.growth_weight_down : model.growth_weight_up);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var readiness = readinessOf(age, model);
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max(0, (row.chains || []).length - 1), model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * readiness * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time. No name
  // is special-cased, and a step always says what it costs and how long it takes.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and keep the shares.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'a swap or a liquidity top-up';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'a deposit, a borrow or a repayment';
    if (c.indexOf('bridge') >= 0) return 'a bridge transfer';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'a small trade or a funding check';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'a stake top-up or a reward claim';
    if (c.indexOf('prediction') >= 0) return 'a market position';
    return 'a deposit, a swap or a vote';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var half = Math.max(25, Math.round(capital / 2));
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Open a second position of $' + half + ' in a different ' + name + ' pool on ' + chain + ', so the wallet is not a one-pool farmer.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply on ' + name + ' and repay it within the week, so the wallet shows both sides of the market.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Place one limit order of $' + half + ' on ' + name + ' beside the open trade, so the wallet shows maker activity too.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + half + ' into a second ' + name + ' vault on ' + chain + ' with a different strategy, so the wallet is not a one-vault farmer.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake a further $' + half + ' through ' + name + ' on a second validator or pool, so the wallet is not tied to one receipt.';
    return 'Make a second, smaller deposit of $' + half + ' into ' + name + ' on ' + chain + ' a week after the first, so the wallet shows repeated use.';
  }
  function secondChainOf(p) { return p.chains && p.chains.length >= 2 ? p.chains[1] : null; }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Check the borrow rate, the collateral factor and the liquidation threshold on ' + name + ' before you supply, and keep the loan-to-value well below the liquidation line.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return "Check the pool's fee tier and the price range of the pair on " + name + ' before you provide liquidity, and size the position so impermanent loss cannot take the whole deposit.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Check the funding rate and the liquidation price on ' + name + ' before you open the trade, and keep the margin small enough that one move cannot liquidate it.';
    if (c.indexOf('bridge') >= 0) return "Check the bridge's finality time and its fee on both chains before you bridge through " + name + ', and send a small test transfer first.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Check the unstaking delay and any slashing terms on ' + name + ' before you stake, so the position is not locked past the point you need it.';
    if (c.indexOf('prediction') >= 0) return "Check the market's resolution rule and its expiry on " + name + ' before you place a position, so a win cannot be voided by the fine print.';
    if (c.indexOf('stable') >= 0) return 'Check what backs the stable asset on ' + name + ' and where its reserves are published before you mint or deposit.';
    if (c.indexOf('rwa') >= 0) return "Check the issuer, the redemption terms and the audit record of " + name + "'s yield-bearing asset before you mint it.";
    if (c.indexOf('insurance') >= 0) return 'Check what the cover excludes and how a claim is paid on ' + name + ' before you buy the policy.';
    if (c.indexOf('basis') >= 0) return "Check the funding history and the basis vault's drawdown on " + name + ' before you deposit, so a negative funding stretch cannot eat the yield.';
    return "Check the protocol's audit record and the size of its largest pool on " + name + ' before you deposit, and keep the position small enough to lose.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var secondChain = secondChainOf(p);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as ' + weeklyFor(p) + ', so the wallet stays active and any points program sees it.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: "Before you send anything, open " + p.name + "'s own site from the link DefiLlama lists for it and check the contract address and the points page match; never connect a wallet from a link in a reply, an ad or a direct message.", cost: 'nothing to check', time: '5 minutes' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + Math.max(25, Math.round(capital / 2)) + ' of capital and about $3 of gas', time: '15 minutes' },
      { text: riskFor(p), cost: 'nothing to check', time: '10 minutes' }
    ];
    if (secondChain) {
      steps.push({ text: 'Repeat the position on ' + secondChain + ' with a smaller amount, so the wallet is active on more than one chain ' + p.name + ' counts.', cost: 'about $' + Math.max(25, Math.round(capital / 2)) + ' of capital and about $3 of gas', time: '15 minutes' });
    }
    steps.push(
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    );
    return steps.map(stepText);
  }

  // The live-token protocols in the same category, biggest market cap first: the names
  // the row's category multiple is priced from.
  function peersOf(row) {
    return DATA.live.filter(function (r) { return (r.category || 'Other') === (row.category || 'Other'); }).slice(0, 3);
  }

  // The protocols ranked nearest to this one in its own category: the reader's
  // comparison set on the board itself, so a rank is judged against its own kind.
  function boardPeersOf(row) {
    var same = DATA.rows.filter(function (r) { return (r.category || 'Other') === (row.category || 'Other') && r.slug !== row.slug; });
    same.sort(function (a, b) { return Math.abs(a.rank - row.rank) - Math.abs(b.rank - row.rank); });
    return same.slice(0, 3);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('early') === '1') state.early = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1') state.dir = 1;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.early) params.set('early', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir === 1) params.set('dir', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.early && r.on_watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'TOKEN RADAR' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Every pre-token protocol, ranked by what its launch would be worth' }),
        el('p', { text: 'The watchlist is the floor: ' + DATA.watchlist_size + ' protocols with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more below that floor, so a launch is found early. Implied value is this entry\u2019s model, not a promise, and no token on record is not proof a token does not exist.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var early = el('input', { type: 'checkbox', id: 'early', checked: state.early ? 'checked' : null });
    early.addEventListener('change', function () { state.early = early.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('label', { class: 'check', for: 'early' }, early, 'Early only (below the floor)'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.early = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var badge = r.on_watchlist ? el('span', { class: 'badge watch', text: 'WATCHLIST' }) : el('span', { class: 'badge early', text: 'EARLY' });
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, badge),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-per-TVL is what prices each pre-token category.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mkt / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var catBody = el('tbody');
    DATA.categories.forEach(function (c) {
      catBody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.sample) }),
        el('td', { class: 'num', text: fmtMult(c.median) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) })
      ));
    });
    var catTable = el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'What each category is priced at: the geometric median market-cap-per-TVL of its live-token protocols, shrunk toward the global median ' + fmtMult(DATA.global_multiple) + ' by sample size. Categories with fewer than ' + m.min_category_sample + ' live protocols are priced at the global median and are not listed.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live names' }), el('th', { scope: 'col', text: 'Raw median' }), el('th', { scope: 'col', text: 'Multiple used' }))),
        catBody
      )
    );
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x growth x readiness(age_days) x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) ), where growth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight_up + ' when up and x ' + m.growth_weight_down + ' when down'
      ),
      el('p', { class: 'sub', text: 'Category multiple: the geometric median market-cap-per-TVL of the live-token protocols in the same category, shrunk toward the global median ' + fmtMult(DATA.global_multiple) + ' with weight n / (n + ' + m.shrinkage_prior + ') for a category with n live names, clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. A multiple is a ratio, so its centre is geometric: for an even sample it is the geometric mean of the two middle ratios, not the arithmetic mean the larger one dominates. A category with fewer than ' + m.min_category_sample + ' live names uses the global median outright: a median of one or two names is not a market. Growth is asymmetric: a fall discounts harder than a rise of the same size rewards, because a protocol losing TVL is losing the market that would buy its token. Readiness is the launch window: it rises from ' + m.readiness_floor + ' at listing to 1.00 at ' + m.readiness_peak_days + ' days, holds to ' + m.readiness_plateau_days + ' days, then falls to ' + m.readiness_old_floor + ' — a protocol that has run five years with no token has shown it can live without one. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth rewards protocols live on more chains.' }),
      catTable,
      el('p', { class: 'note', text: 'A protocol on this board records no token in the snapshot. That is DefiLlama\u2019s record, not proof: it may still have a token the record does not carry. Implied value is this entry\u2019s own claim, never make.fun\u2019s.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var peers = peersOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? '  ·  Watchlist' : '  ·  Early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Live names behind it' }), el('b', { class: 'num', text: row.category_sample > 0 ? String(row.category_sample) + ' in category' : 'global median' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: 'x' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Readiness multiplier' }), el('b', { class: 'num', text: 'x' + row.readiness_multiplier })),
        el('div', null, el('span', { text: 'Launch window' }), el('b', { class: 'num', text: readinessLabel(row, DATA.model) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: 'x' + row.breadth_multiplier })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    if (peers.length > 0) {
      var peerBody = el('tbody');
      peers.forEach(function (p) {
        peerBody.appendChild(el('tr', null,
          el('td', null, el('b', { text: p.name })),
          el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
          el('td', { class: 'num', text: fmtMult(p.multiple) })
        ));
      });
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Where the multiple comes from' }),
        el('p', { class: 'sub', text: 'The largest live-token protocols in ' + (row.category || 'Other') + '. Their market-cap-per-TVL is the market this row is priced against; the multiple used is the category geometric median of all of them, shrunk toward the global median by sample size.' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Live protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mkt / TVL' }))),
            peerBody
          )
        )
      ));
    }
    var boardPeers = boardPeersOf(row);
    if (boardPeers.length > 0) {
      var boardPeerBody = el('tbody');
      boardPeers.forEach(function (p) {
        boardPeerBody.appendChild(el('tr', {
          tabindex: '0',
          onclick: function () { openDetail(p.slug); },
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(p.slug); } }
        },
          el('td', { class: 'num', text: String(p.rank) }),
          el('td', null, el('b', { text: p.name })),
          el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(p.implied_value_usd) })
        ));
      });
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Peers on the board' }),
        el('p', { class: 'sub', text: 'The ' + (row.category || 'Other') + ' protocols ranked nearest to this one. A rank is judged against its own kind: select a peer to open its model and farm plan.' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Rank' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Implied value' }))),
            boardPeerBody
          )
        )
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
