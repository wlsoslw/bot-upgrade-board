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
    render();
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

  function renderSummary(agg) {
    $('k-total').textContent = agg.total;
    var ks = clear($('k-status'));
    L.STATUSES.forEach(function (s) {
      if (s === '不适用' && !agg.statuses[s]) return;
      ks.appendChild(h('button', { type: 'button', class: 'chip ' + STATUS_CLASS[s], 'aria-pressed': String(state.status === s),
        onclick: function () { setState({ status: state.status === s ? '' : s }); } },
        [h('span', { class: 'mark', 'aria-hidden': 'true' }), s + ' ', h('b', { text: String(agg.statuses[s] || 0) })]));
    });
    var kl = clear($('k-level'));
    Object.keys(agg.levels).sort(function (a, b) { return a - b; }).forEach(function (lv) {
      kl.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.level === lv),
        onclick: function () { setState({ level: state.level === lv ? '' : lv }); } },
        ['Level ' + lv + ' ', h('b', { text: String(agg.levels[lv]) })]));
    });
    var fl = $('f-level'), cur = fl.value;
    while (fl.options.length > 1) fl.remove(1);
    Object.keys(agg.levels).sort(function (a, b) { return a - b; }).forEach(function (lv) { fl.add(new Option('Level ' + lv, lv)); });
    fl.value = state.level; void cur;
    var fs = $('f-status');
    if (fs.options.length === 1) L.STATUSES.forEach(function (s) { fs.add(new Option(s, s)); });
    fs.value = state.status;
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
    var W = Math.max(280, Math.round(box.clientWidth || 1000)), H = 110, pl = 44, pr = 16, pt = 12, pb = 28;
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

  function renderList(agg) {
    var rows = L.filterBots(data.bots, state), list = clear($('list'));
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
    list.appendChild(h('div', { class: 'list-head', 'aria-hidden': 'true' }, [h('span', { text: 'bot / 职责' }), h('span', { text: '等级' }), h('span', { text: '本周目标' }), h('span', { text: '今日产出' }), h('span', { text: '状态' })]));
    rows.forEach(function (b) {
      list.appendChild(h('button', { type: 'button', class: 'row', 'data-bot': b.name, onclick: function () { setState({ bot: b.name }); } }, [
        h('span', { class: 'name' }, [b.name, h('span', { class: 'role', text: b.role || '—' })]),
        h('span', { class: 'lv', text: 'L' + b.level }),
        h('span', { class: 'goal', text: b.week_goal || '本周目标未填写' }),
        h('span', { class: 'out', text: outText(b) }),
        h('span', { class: 'badge ' + STATUS_CLASS[b.status] }, [b.status])
      ]));
    });
  }

  function renderDrawer() {
    var dlg = $('drawer');
    var b = state.bot && data && data.bots.filter(function (x) { return x.name === state.bot; })[0];
    if (!b) { if (dlg.open) dlg.close(); return; }
    $('d-name').textContent = b.name;
    var body = clear($('d-body'));
    body.appendChild(h('dl', { class: 'dl' }, [
      h('dt', { text: '职责' }), h('dd', { text: b.role || '—' }),
      h('dt', { text: '等级' }), h('dd', null, [h('span', { class: 'lv', text: 'Level ' + b.level })]),
      h('dt', { text: '状态' }), h('dd', null, [h('span', { class: 'badge ' + STATUS_CLASS[b.status], text: b.status })]),
      h('dt', { text: '本周目标' }), h('dd', { text: b.week_goal || '未填写' }),
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
    if (!dlg.open) { lastFocus = document.activeElement; dlg.showModal(); }
  }

  function render() {
    if (!data) return;
    var agg = L.aggregate(data.bots);
    renderSummary(agg); renderList(agg); renderDrawer();
    $('q').value !== state.q && ($('q').value = state.q);
  }

  function clearFilters() { setState({ q: '', level: '', status: '' }); $('q').focus(); }

  function load() {
    var btn = $('refresh'); btn.setAttribute('aria-busy', 'true');
    if (!data) renderStates('loading');
    return fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var err = L.validate(d); if (err) throw new Error(err);
        data = d;
        $('updated').textContent = '数据更新于 ' + L.fmtUtc8(d.updated_at) + ' · 每 5 分钟自动刷新';
        renderBaseline(); renderTrajectory(); render();
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
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('board-theme', root.dataset.theme); } catch (_) {}
  });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (data) renderTrajectory(); }, 150); });
  setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && data) load(); });
  load();
})();
