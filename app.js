(function () {
  'use strict';
  var L = window.BoardLib;
  var DATA_URL = './status.public.json';
  var REFRESH_MS = 5 * 60 * 1000;
  var STATUS_CLASS = { '已交付': 's-ok', '进行中': 's-warn', '逾期': 's-bad', '不适用': 's-na' };
  var $ = function (id) { return document.getElementById(id); };
  var data = null, state = L.parseState(location.hash), lastFocus = null;

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function outText(b) {
    if (!b.outputs_count) return '今日暂无产出';
    var t = Object.keys(b.output_types || {}).map(function (k) { return k + ' ' + b.output_types[k]; }).join('、');
    return t || (b.outputs_count + ' 件');
  }

  function setState(patch, replace) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    var hash = L.serializeState(state);
    var url = location.pathname + location.search + hash;
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    if ('bot' in patch && patch.bot) return openDetail(patch.bot);
    if (document.startViewTransition && !reduce && !('bot' in patch)) document.startViewTransition(render); else render();
  }

  function renderStates(kind, msg) {
    var list = clear($('list'));
    if (kind === 'loading') { list.setAttribute('aria-busy', 'true'); for (var i = 0; i < 6; i++) list.appendChild(h('div', { class: 'skel', 'aria-hidden': 'true' })); return; }
    list.removeAttribute('aria-busy');
    list.appendChild(h('div', { class: 'state', role: kind === 'error' ? 'alert' : null }, [
      h('h3', { text: kind === 'error' ? '数据加载失败' : '还没有 bot 数据' }),
      h('p', { text: msg }),
      h('button', { type: 'button', class: 'btn', text: '重试', onclick: load })
    ]));
  }

  function hash(str) { var x = 2166136261; for (var i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function slug(name) { return 'a' + hash(String(name)).toString(36); }
  var AVATARS = {};
  function avatar(b, size) {
    var hsh = hash(b.name), hue = hsh % 360, el = h('span', { class: 'av av-' + size, 'aria-hidden': 'true', style: '--h:' + hue });
    var initial = (String(b.name).match(/[A-Za-z\u4e00-\u9fff]/) || ['?'])[0].toUpperCase();
    if (AVATARS[slug(b.name)]) {
      var img = h('img', { src: './avatars/' + slug(b.name) + '.webp', alt: '', width: 64, height: 64, loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', function () { img.remove(); el.classList.remove('has-img'); });
      el.classList.add('has-img'); el.appendChild(img);
    }
    el.appendChild(h('span', { class: 'av-i', text: initial }));
    return el;
  }
  var maxOut = 1;
  function xpBar(b) {
    var pct = Math.round(100 * (b.outputs_count || 0) / maxOut);
    return h('span', { class: 'xp', title: '条长 = 今日产出件数 ÷ 全员当日最高件数（' + maxOut + '）。不是升级进度，等级只由 bot manager 调整。' }, [
      h('span', { class: 'xp-track' }, [h('span', { class: 'xp-fill', style: '--p:' + pct / 100 })]),
      h('span', { class: 'xp-n num', text: (b.outputs_count || 0) + ' 件' })]);
  }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(el, to) {
    var from = +el.textContent || 0;
    if (reduce || from === to) { el.textContent = to; return; }
    var t0 = performance.now(), d = 900;
    (function step(t) { var k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); })(t0);
  }
  function renderSummary(agg) {
    countUp($('k-total'), agg.total);
    var no = L.ops(data.bots).length; countUp($('ops-n'), no); $('ops-n2').textContent = no; countUp($('up-n'), agg.levels[0] || 0);
    var applicable = agg.total - (agg.statuses['不适用'] || 0), done = agg.statuses['已交付'] || 0;
    var rate = applicable ? Math.round(100 * done / applicable) : 0;
    countUp($('rate'), rate);
    $('rate-note').textContent = '已交付 ' + done + ' / 适用 ' + applicable + ' 个';
    requestAnimationFrame(function () { $('rate-ring').setAttribute('stroke-dasharray', rate + ' 100'); });
    var ks = clear($('k-status'));
    L.STATUSES.forEach(function (s) {
      if (s === '不适用' && !agg.statuses[s]) return;
      ks.appendChild(h('button', { type: 'button', class: 'chip ' + STATUS_CLASS[s], 'aria-pressed': String(state.status === s),
        onclick: function () { setState({ status: state.status === s ? '' : s }); } },
        [h('span', { class: 'mark', 'aria-hidden': 'true' }), s + ' ', h('b', { text: String(agg.statuses[s] || 0) })]));
    });
    var kl = clear($('k-level')), lvKeys = Object.keys(agg.levels).sort(function (a, b) { return a - b; });
    var maxLv = Math.max(3, +lvKeys[lvKeys.length - 1] || 0);
    for (var lv = 0; lv <= maxLv; lv++) (function (lv) {
      var n = agg.levels[lv] || 0, key = String(lv);
      var kids = [h('span', { class: 'lvb-l', text: 'L' + lv }), h('span', { class: 'lvb-t' }, [h('span', { class: 'lvb-f', style: '--p:' + (n / agg.total) })])];
      if (n) kl.appendChild(h('button', { type: 'button', class: 'chip lvb', 'aria-pressed': String(state.level === key), title: '点击筛选 Level ' + lv,
        onclick: function () { setState({ level: state.level === key ? '' : key }); } }, kids.concat([h('b', { class: 'num', text: String(n) })])));
      else kl.appendChild(h('div', { class: 'lvb empty' }, kids.concat([h('span', { class: 'num muted', text: '0' })])));
    })(lv);
    var fl = $('f-level');
    while (fl.options.length > 1) fl.remove(1);
    lvKeys.forEach(function (lv) { fl.add(new Option('Level ' + lv, lv)); });
    fl.value = state.level;
    var fs = $('f-status');
    if (fs.options.length === 1) L.STATUSES.forEach(function (s) { fs.add(new Option(s, s)); });
    fs.value = state.status;
  }
  function renderRank() {
    var arr = L.content(data.bots).sort(function (a, b) { return b.level - a.level || (b.outputs_count || 0) - (a.outputs_count || 0) || a.name.localeCompare(b.name, 'zh'); });
    var ol = clear($('rank')), rank = 0;
    arr.forEach(function (b, i) {
      var p = arr[i - 1];
      if (!p || p.level !== b.level || (p.outputs_count || 0) !== (b.outputs_count || 0)) rank = i + 1;
      if (i >= 8) return;
      ol.appendChild(h('li', null, [h('button', { type: 'button', 'data-bot': b.name, class: 'rk' + (rank <= 3 ? ' top top' + rank : ''), onclick: function () { setState({ bot: b.name }); } }, [
        h('span', { class: 'rk-n num', text: String(rank) }), avatar(b, 's'),
        h('span', { class: 'rk-name' }, [b.name, h('small', { text: b.role || '—' })]),
        h('span', { class: 'lvl', text: 'L' + b.level }), h('span', { class: 'rk-o num', text: (b.outputs_count || 0) + ' 件' })])]));
    });
  }

  function renderBaseline() {
    var el = $('baseline'), d = data.baseline_date;
    el.hidden = !d;
    if (!d) return;
    $('b-date').textContent = d.slice(5);
    $('b-days').textContent = String((data.history || []).length || 1);
  }

  function renderTrajectory() {
    var hist = (data.history || []).slice(-30), box = clear($('traj-chart'));
    var note = $('traj-note');
    if (!hist.length) { note.textContent = '暂无历史快照'; return; }
    var avg = hist.map(function (x) {
      var lv = x.levels || {}, ks = Object.keys(lv), s = 0;
      ks.forEach(function (k) { s += lv[k]; });
      return { date: x.date, kind: x.kind, avg: ks.length ? s / ks.length : 0, max: ks.reduce(function (m, k) { return Math.max(m, lv[k]); }, 0) };
    });
    var maxL = Math.max(3, Math.max.apply(null, avg.map(function (a) { return a.max; })));
    note.textContent = hist.length === 1 ? '目前只有基线日一个点，之后每天追加一个快照。' : '平均等级，近 ' + hist.length + ' 天';
    var W = Math.max(280, Math.round(box.clientWidth || 1000)), H = 150, pl = 44, pr = 16, pt = 12, pb = 28;
    var x = function (i) { return avg.length === 1 ? pl + 12 : pl + i * (W - pl - pr) / (avg.length - 1); };
    var y = function (v) { return pt + (1 - v / maxL) * (H - pt - pb); };
    var NS = 'http://www.w3.org/2000/svg';
    var s = function (tag, a, txt) { var e = document.createElementNS(NS, tag); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); if (txt) e.textContent = txt; return e; };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '平均等级趋势：' + avg.map(function (a) { return a.date.slice(5) + ' 平均 Level ' + a.avg.toFixed(1); }).join('；') });
    for (var lv = 0; lv <= maxL; lv++) {
      svg.appendChild(s('line', { class: 'grid', x1: pl, x2: W - pr, y1: y(lv), y2: y(lv) }));
      svg.appendChild(s('text', { class: 'axis', x: pl - 10, y: y(lv) + 4, 'text-anchor': 'end' }, 'L' + lv));
    }
    if (avg.length > 1) svg.appendChild(s('polyline', { class: 'line', points: avg.map(function (a, i) { return x(i) + ',' + y(a.avg); }).join(' ') }));
    avg.forEach(function (a, i) {
      if (a.kind === 'baseline') svg.appendChild(s('circle', { class: 'base', cx: x(i), cy: y(a.avg), r: 9 }));
      svg.appendChild(s('circle', { class: 'dot', cx: x(i), cy: y(a.avg), r: 4 }));
      svg.appendChild(s('text', { class: 'axis', x: x(i), y: H - 8, 'text-anchor': avg.length === 1 ? 'start' : 'middle' }, a.date.slice(5) + (a.kind === 'baseline' ? ' 基线' : '')));
    });
    box.appendChild(svg);
  }

  // v2.1: milestones are derived only from real history snapshots; with no change they render a compact "lights up when" row.
  function renderMilestones() {
    var hist = data.history || [], ups = [], downs = [];
    if (hist.length > 1) {
      var a = hist[hist.length - 2].levels || {}, z = hist[hist.length - 1].levels || {};
      Object.keys(z).forEach(function (k) { if (a[k] == null) return; if (z[k] > a[k]) ups.push(k + ' L' + a[k] + '→L' + z[k]); else if (z[k] < a[k]) downs.push(k + ' L' + a[k] + '→L' + z[k]); });
    }
    var rows = [
      { k: 'up', t: '晋级', v: ups, when: '有 bot 被 bot manager 依据已核实产出上调等级后亮起' },
      { k: 'down', t: '降级', v: downs, when: '有 bot 等级被下调后亮起' },
      { k: 'ach', t: '成就', v: [], when: '成就规则由 bot manager 发布并有人达成后亮起；当前未定义成就' }
    ];
    var box = clear($('ms-list'));
    rows.forEach(function (r) {
      var live = r.v.length > 0;
      box.appendChild(h('li', { class: 'ms ms-' + r.k + (live ? ' live' : ' idle') }, [
        h('span', { class: 'ms-ico', 'aria-hidden': 'true' }),
        h('span', { class: 'ms-t', text: r.t }),
        h('span', { class: 'ms-v', text: live ? r.v.join('、') : '暂无记录' }),
        h('span', { class: 'ms-w muted', text: live ? '最近一次快照对比' : r.when })]));
    });
    if (ups.length && !reduce) { var hero = document.querySelector('.ms-up'); hero && hero.classList.add('celebrate'); }
  }
  function renderList(agg) {
    var rows = L.filterBots(L.content(data.bots), state), list = clear($('list'));
    list.removeAttribute('aria-busy');
    var filtered = state.q || state.level !== '' || state.status;
    $('count').textContent = filtered ? rows.length + ' / ' + agg.total : String(agg.total);
    $('clear').hidden = !filtered;
    if (!data.bots.length) { renderStates('empty', '数据文件里没有 bot。等下一次刷新，或联系 bot manager。'); return; }
    if (!rows.length) {
      list.appendChild(h('div', { class: 'state' }, [h('h3', { text: '没有符合条件的 bot' }), h('p', { text: '换个关键词，或清除筛选看全部 ' + agg.total + ' 个。' }),
        h('button', { type: 'button', class: 'btn', text: '清除筛选', onclick: clearFilters })]));
      return;
    }
    rows.forEach(function (b, i) {
      list.appendChild(h('button', { type: 'button', class: 'row card lv' + Math.min(b.level, 5), 'data-bot': b.name, style: '--i:' + Math.min(i, 12) + ';view-transition-name:c' + slug(b.name),
        onclick: function () { setState({ bot: b.name }); } }, [
        h('span', { class: 'card-top' }, [avatar(b, 'm'), h('span', { class: 'lvl', text: 'L' + b.level })]),
        h('span', { class: 'name', text: b.name }), h('span', { class: 'role', text: b.role || '—' }),
        xpBar(b),
        h('span', { class: 'card-foot' }, [h('span', { class: 'out', text: outText(b) }), h('span', { class: 'badge ' + STATUS_CLASS[b.status] }, [b.status])])
      ]));
    });
  }

  function renderOps() {
    var rows = L.filterBots(L.ops(data.bots), { q: state.q, status: state.status, level: '' }), box = clear($('ops-list'));
    if (state.level !== '') rows = [];
    $('ops-count').textContent = rows.length + ' 个';
    rows.forEach(function (b) {
      box.appendChild(h('button', { type: 'button', class: 'ops-item', 'data-bot': b.name, onclick: function () { setState({ bot: b.name }); } }, [
        avatar(b, 's'), h('span', { class: 'rk-name' }, [b.name, h('small', { text: b.role || '—' })]), h('span', { class: 'badge ' + STATUS_CLASS[b.status], text: b.status })]));
    });
    if (!rows.length) box.appendChild(h('p', { class: 'muted', text: state.level !== '' ? '运营支持组不参与等级，按等级筛选时不显示。' : '没有符合条件的运营支持 bot。' }));
  }

  // v2.1: shared-element morph card -> centred detail card (desktop) / bottom sheet (mobile)
  function openDetail(name) {
    var card = Array.prototype.filter.call(document.querySelectorAll('.row,.rk,.ops-item'), function (r) { return r.getAttribute('data-bot') === name; })[0];
    if (!document.startViewTransition || reduce || !card) { render(); return; }
    var vt = 'c' + slug(name), av = card.querySelector('.av');
    card.style.viewTransitionName = vt; if (av) av.style.viewTransitionName = 'sel-av';
    lastFocus = card;
    var t = document.startViewTransition(function () {
      card.style.viewTransitionName = 'none'; if (av) av.style.viewTransitionName = '';
      renderDrawer(vt);
    });
    t.finished.then(function () { card.style.viewTransitionName = card.classList.contains('row') ? vt : ''; var di = document.querySelector('.drawer-inner'); if (di) di.style.viewTransitionName = ''; var da = document.querySelector('.d-hero .av'); if (da) da.style.viewTransitionName = ''; }, function () {});
  }
  function renderDrawer(vt) {
    var dlg = $('drawer');
    var b = state.bot && data && data.bots.filter(function (x) { return x.name === state.bot; })[0];
    if (!b) { if (dlg.open) dlg.close(); return; }
    $('d-name').textContent = b.name;
    var body = clear($('d-body'));
    body.appendChild(h('div', { class: 'd-hero' }, [avatar(b, 'l'), h('div', null, L.isOps(b) ? [h('span', { class: 'muted', text: '运营支持组 · 不参与等级评定' })] : [h('span', { class: 'lvl big', text: 'Level ' + b.level }), xpBar(b)])]));
    body.appendChild(h('dl', { class: 'dl' }, [
      h('dt', { text: '岗位' }), h('dd', { text: b.role || '—' }),
      h('dt', { text: '等级' }), h('dd', null, [h('span', { class: 'lv', text: 'Level ' + b.level })]),
      h('dt', { text: '状态' }), h('dd', null, [h('span', { class: 'badge ' + STATUS_CLASS[b.status], text: b.status })]),
      h('dt', { text: '今日产出' }), h('dd', { text: outText(b) }),
      h('dt', { text: '证据' }), h('dd', { class: b.has_evidence ? 'verified' : 'unverified', text: b.has_evidence ? '已核实：文件存在且非空（内容未验收）' : '暂无已核实的产出' }),
      h('dt', { text: '今日复盘' }), h('dd', { text: b.retro_today ? '已写' : '未写' }),
      h('dt', { text: '数据时间' }), h('dd', { text: L.fmtUtc8(data.updated_at) })
    ]));
    var tl = h('ol', { class: 'tl' });
    var hist = (data.history || []).slice().reverse();
    hist.forEach(function (x, i) {
      var lv = x.levels && x.levels[b.name];
      tl.appendChild(h('li', { class: i === 0 ? 'now' : '' }, [h('span', { class: 'when', text: x.date.slice(5) + (x.kind === 'baseline' ? ' · 基线日' : '') }), h('br'),
        lv == null ? '当天不在名录' : 'Level ' + lv + (x.kind === 'baseline' ? '，起点' : '')]));
    });
    body.appendChild(h('section', { class: 'sec' }, [h('h3', { text: '等级时间线' }), hist.length ? tl : h('p', { class: 'muted', text: '暂无快照' })]));
    if (vt) { document.querySelector('.drawer-inner').style.viewTransitionName = vt; var da = body.querySelector('.av'); if (da) da.style.viewTransitionName = 'sel-av'; }
    if (!dlg.open) { if (!lastFocus || !lastFocus.getAttribute || lastFocus.getAttribute('data-bot') !== b.name) lastFocus = document.activeElement; dlg.showModal(); }
  }

  function render() {
    if (!data) return;
    var agg = L.aggregate(L.content(data.bots));
    renderSummary(agg); renderList(agg); renderOps(); renderDrawer();
    $('q').value !== state.q && ($('q').value = state.q);
  }

  function clearFilters() { setState({ q: '', level: '', status: '' }); $('q').focus(); }

  function load() {
    var btn = $('refresh'); btn.setAttribute('aria-busy', 'true');
    if (!data) renderStates('loading');
    var av = fetch('./avatars.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (l) { AVATARS = {}; (l || []).forEach(function (k) { AVATARS[k] = 1; }); }).catch(function () {});
    return av.then(function () { return fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' }); })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var err = L.validate(d); if (err) throw new Error(err);
        data = d; maxOut = Math.max(1, Math.max.apply(null, d.bots.map(function (b) { return b.outputs_count || 0; }).concat([0])));
        $('updated').textContent = '数据更新于 ' + L.fmtUtc8(d.updated_at) + ' · 每 5 分钟自动刷新';
        renderBaseline(); renderTrajectory(); renderMilestones(); render(); renderRank();
      })
      .catch(function (e) {
        $('updated').textContent = data ? '刷新失败，显示的是上次数据' : '数据不可用';
        if (!data) renderStates('error', '读不到数据文件（' + e.message + '）。稍后重试，或联系 bot manager 检查发布脚本。');
      })
      .then(function () { btn.removeAttribute('aria-busy'); });
  }

  // events
  var qt;
  $('q').addEventListener('input', function (e) { clearTimeout(qt); var v = e.target.value; qt = setTimeout(function () { setState({ q: v.trim() }, true); }, 120); });
  $('f-level').addEventListener('change', function (e) { setState({ level: e.target.value }); });
  $('f-status').addEventListener('change', function (e) { setState({ status: e.target.value }); });
  $('clear').addEventListener('click', clearFilters);
  $('refresh').addEventListener('click', load);
  $('d-close').addEventListener('click', function () { $('drawer').close(); });
  $('drawer').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('drawer').addEventListener('close', function () {
    var name = state.bot;
    if (state.bot) setState({ bot: '' }, true);
    var target = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : null;
    if (!target && name) target = Array.prototype.filter.call(document.querySelectorAll('.row'), function (r) { return r.getAttribute('data-bot') === name; })[0];
    if (!target) target = document.querySelector('.row');
    if (target) setTimeout(function () { target.focus(); }, 0);
  });
  window.addEventListener('popstate', function () { state = L.parseState(location.hash); render(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !$('drawer').open) { e.preventDefault(); $('q').focus(); }
  });
  $('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    var apply = function () { root.dataset.theme = dark ? 'light' : 'dark'; };
    if (document.startViewTransition && !reduce) document.startViewTransition(apply); else apply();
    try { localStorage.setItem('board-theme', dark ? 'light' : 'dark'); } catch (_) {}
  });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (data) renderTrajectory(); }, 150); });
  setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && data) load(); });
  document.addEventListener('pointermove', function (e) { var c = e.target.closest && e.target.closest('.card'); if (!c) return; var r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  load();
})();
