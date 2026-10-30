/* Pure data logic shared by the page and node:test. No DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoardLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var STATUSES = ['已交付', '进行中', '逾期', '不适用'];

  function aggregate(bots) {
    var levels = {}, statuses = {};
    STATUSES.forEach(function (s) { statuses[s] = 0; });
    bots.forEach(function (b) {
      levels[b.level] = (levels[b.level] || 0) + 1;
      statuses[b.status] = (statuses[b.status] || 0) + 1;
    });
    return { total: bots.length, levels: levels, statuses: statuses };
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

  function filterBots(bots, f) {
    var q = norm(f.q);
    return bots.filter(function (b) {
      if (f.level !== '' && f.level != null && String(b.level) !== String(f.level)) return false;
      if (f.status && b.status !== f.status) return false;
      if (q && (norm(b.name) + norm(b.role)).indexOf(q) === -1) return false;
      return true;
    });
  }

  function parseState(hash) {
    var p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    var st = p.get('status') || '';
    return { q: p.get('q') || '', level: /^\d+$/.test(p.get('level') || '') ? p.get('level') : '',
      status: STATUSES.indexOf(st) >= 0 ? st : '', bot: p.get('bot') || '' };
  }
  function serializeState(s) {
    var p = new URLSearchParams();
    ['q', 'level', 'status', 'bot'].forEach(function (k) { if (s[k] !== '' && s[k] != null) p.set(k, s[k]); });
    var str = p.toString();
    return str ? '#' + str : '';
  }

  /* Always render in UTC+8 regardless of viewer's zone. */
  function fmtUtc8(iso, withDate) {
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var t = new Date(d.getTime() + 8 * 3600e3);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes());
    var md = pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
    return (withDate === false ? hm : md + ' ' + hm) + ' (UTC+8)';
  }

  function validate(data) {
    if (!data || !Array.isArray(data.bots)) return '数据格式不正确：缺少 bots 列表';
    var a = aggregate(data.bots), s = data.summary || {};
    if (s.total != null && s.total !== a.total) return '汇总总数与明细不一致';
    return '';
  }

  function isOps(b) { return b.group === 'ops'; }
  function content(bots) { return bots.filter(function (b) { return !isOps(b); }); }
  function ops(bots) { return bots.filter(isOps); }
  return { isOps: isOps, content: content, ops: ops, STATUSES: STATUSES, aggregate: aggregate, filterBots: filterBots, parseState: parseState,
    serializeState: serializeState, fmtUtc8: fmtUtc8, validate: validate };
});
