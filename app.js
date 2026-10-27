/* неПокер: аналитика турниров. Данные: window.NEPOKER (data/data.js), собираются build_data.py */
(function () {
  'use strict';
  var D = window.NEPOKER, T = D.tournaments, P = D.players;
  var DN = D.display || {}, disp = function (n) { return DN[n] || n; };
  var mq = window.matchMedia('(max-width: 640px)'), MOB = mq.matches;
  var cut = function (s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  var app = document.getElementById('app');
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); };
  var fmt = function (n) { return n == null ? '—' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
  var f1 = function (n) { return n == null ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ','); };
  var sgn = function (n) { return n > 0 ? '+' + n : String(n); };
  /* ---------- аватары и подсказки ---------- */
  function avatar(name, cls) {
    var t = disp(name).replace(/[^A-Za-zА-Яа-яЁё0-9 ]/g, ' ').trim().split(/\s+/), ini = (t[0] || '?').charAt(0).toUpperCase() + (t[1] ? t[1].charAt(0).toUpperCase() : '');
    var hs = 0, s = String(name); for (var i = 0; i < s.length; i++) hs = (hs * 31 + s.charCodeAt(i)) % 360;
    return '<span class="av ' + (cls || '') + '" style="background:hsl(' + hs + ' 42% 36%)">' + esc(ini) + '</span>';
  }
  var plink = function (n, cls) { return '<a class="pl pa" href="#players/' + encodeURIComponent(n) + '">' + avatar(n, cls || 'sm') + '<span>' + esc(disp(n)) + '</span></a>'; };
  var tip = function (t) { return '<span class="tip" tabindex="0" data-tip="' + esc(t) + '">?</span>'; };

  var link = function (n) { return '<a class="pl" href="#players/' + encodeURIComponent(n) + '">' + esc(disp(n)) + '</a>'; };
  var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
  var sd = function (a) { if (a.length < 2) return null; var m = mean(a); return Math.sqrt(mean(a.map(function (x) { return (x - m) * (x - m); }))); };

  /* ---------- фильтры и контексты данных ---------- */
  var PA = D.players;                           // все данные игроков (без фильтров)
  var flt = { from: 0, to: T.length - 1, incl: false };
  try {
    var sv = JSON.parse(localStorage.getItem('np_flt3') || 'null');
    if (sv) {   // период хранится по id турниров: новые турниры не должны выпадать из фильтра «до конца»
      var idx = function (id, d) { for (var i = 0; i < T.length; i++) if (T[i].id === id) return i; return d; };
      var f0 = sv.fid ? idx(sv.fid, sv.from) : sv.from, t0 = (sv.end || (sv.end === undefined && sv.to === T.length - 2)) ? T.length - 1 : (sv.tid ? idx(sv.tid, sv.to) : sv.to);
      if (f0 <= t0 && t0 < T.length) flt = { from: f0, to: t0, incl: !!sv.incl };
    }
  } catch (e) {}
  var TA, E, ES, stackTs, comebacks, chokes, PS, AW, P, CA;
  function buildCtx(tl) {
    var c = { tl: tl, E: [], P: {} };
    tl.forEach(function (t) { t.rows.forEach(function (r) { c.E.push({ t: t, name: r.name, place: r.place, n: t.finalists, stack: r.stack, rank: r.stack_rank, delta: r.delta, visits: r.visits, share: r.stack_share, r: r }); }); });
    c.ES = c.E.filter(function (e) { return e.rank != null; });
    c.ES.forEach(function (e) { e.rel = e.delta / (e.n - 1); e.q = Math.min(3, Math.floor((e.rank - 1) / (e.n / 4))); });
    c.stackTs = tl.filter(function (t) { return t.stack_available; });
    c.comebacks = c.ES.filter(function (e) { return e.rank > e.n / 2 && e.place <= 9; });
    c.chokes = c.ES.filter(function (e) { return e.rank <= 3; });
    c.E.forEach(function (e) {
      var p = c.P[e.name];
      if (!p) { var o = PA[e.name] || {}; p = c.P[e.name] = { name: e.name, finals: 0, wins: 0, podiums: 0, table: 0, places: [], deltas: [], list: [], passport: o.passport, series: o.series, rating_now: o.rating_now, rating_rank: o.rating_rank }; }
      p.finals++; p.places.push(e.place); p.wins += e.place === 1; p.podiums += e.place <= 3; p.table += e.place <= 9;
      if (e.delta != null) p.deltas.push(e.delta);
      p.list.push({ t: e.t.id, short: e.t.short, place: e.place, stack_rank: e.rank, delta: e.delta, stack: e.stack, visits: e.visits, of: e.n });
    });
    Object.keys(c.P).forEach(function (k) { var p = c.P[k]; p.avg_place = mean(p.places); p.sd_place = sd(p.places); p.avg_delta = p.deltas.length ? mean(p.deltas) : null; });
    c.PS = playerStats(c); c.AW = computeAwards(c);
    return c;
  }
  function useCtx(c) { E = c.E; ES = c.ES; stackTs = c.stackTs; comebacks = c.comebacks; chokes = c.chokes; PS = c.PS; AW = c.AW; P = c.P; TA = c.tl; }
  function applyFilter() { var tl = T.filter(function (t, i) { return i >= flt.from && i <= flt.to && (flt.incl || !t.nonstandard); }); useCtx(buildCtx(tl)); renderFilterUI(); }
  function saveFilter() { try { localStorage.setItem('np_flt3', JSON.stringify({ from: flt.from, to: flt.to, incl: flt.incl, fid: T[flt.from] && T[flt.from].id, tid: T[flt.to] && T[flt.to].id, end: flt.to === T.length - 1 })); } catch (e) {} }
  function computeAwards(c) {
    var PS = c.PS, P = c.P;
    var kings = PS.filter(function (s) { return s.shortN >= 3; }).sort(function (a, b) { return b.shortAvgRel - a.shortAvgRel; }).slice(0, 3);
    var losers = PS.filter(function (s) { return s.topN >= 3; }).sort(function (a, b) { return b.topFail - a.topFail || a.topLoss - b.topLoss; }).slice(0, 3);
    var vamps = PS.filter(function (s) { return s.vamp >= 1; }).sort(function (a, b) { return b.vamp - a.vamp || b.p.finals - a.p.finals; }).slice(0, 3);
    var stable = PS.filter(function (s) { return s.p.finals >= 3 && s.p.sd_place != null; }).sort(function (a, b) { return a.p.sd_place - b.p.sd_place; }).slice(0, 3);
    var coaster = PS.filter(function (s) { return s.p.finals >= 3 && s.p.sd_place != null; }).sort(function (a, b) { return b.p.sd_place - a.p.sd_place; }).slice(0, 3);
    var deep = Object.keys(P).map(function (k) { return P[k]; }).filter(function (p) { return p.finals >= 3; }).sort(function (a, b) { return b.table / b.finals - a.table / a.finals || b.finals - a.finals; }).slice(0, 3);
    return { kings: kings, losers: losers, vamps: vamps, stable: stable, coaster: coaster, deep: deep };
  }
  function lab(t) { return (t.year ? t.year + ' ' : '') + t.short; }
  function filterLabel() { var all = flt.from === 0 && flt.to === T.length - 1; return (all ? 'Все турниры' : lab(T[flt.from]) + ' — ' + lab(T[flt.to])) + (flt.incl ? ' · + нестандартные' : ''); }
  function filterBar() {
    return '<p class="fnote">Фильтр: <b>' + esc(filterLabel()) + '</b> · ' + (TA ? TA.length : 0) + ' из ' + T.length + ' турниров <button type="button" class="lb" data-open="f">изменить</button></p>';
  }
  function fpanelHTML() {
    var opts = function (sel) { return T.map(function (t, i) { return '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc((t.year ? t.year + ' · ' : '') + t.short) + '</option>'; }).join(''); };
    return '<div class="fp"><h3>Фильтр данных <button type="button" class="x" id="fclose" aria-label="Закрыть">×</button></h3><div class="fbar"><label>Период: с <select id="ff">' + opts(flt.from) + '</select> по <select id="ft">' + opts(flt.to) + '</select></label>' +
      '<label class="tog"><input type="checkbox" id="incl"' + (flt.incl ? ' checked' : '') + '> нестандартные форматы (' + T.filter(function (t) { return t.nonstandard; }).map(function (t) { return esc(t.short); }).join(', ') + ')</label>' +
      '<span class="yrs"><button class="chip fy" data-y="2025">2025</button><button class="chip fy" data-y="2026">2026</button><button class="chip fy" data-y="all">Всё</button></span><button class="chip" id="freset">Сбросить</button><span class="note">в выборке ' + (TA ? TA.length : 0) + ' из ' + T.length + ' турниров</span></div></div>';
  }
  function renderFilterUI() {
    var b = document.getElementById('fbadge'), all = flt.from === 0 && flt.to === T.length - 1;
    if (b) b.textContent = (all ? 'Всё' : (flt.to - flt.from + 1) + ' тур.') + (flt.incl ? ' +' : '');
    var p = document.getElementById('fpanel'); if (p) p.innerHTML = fpanelHTML();
  }
  function openFilter(v) {
    var p = document.getElementById('fpanel'), b = document.getElementById('fbtn'); if (!p) return;
    p.hidden = v === undefined ? !p.hidden : !v; b.setAttribute('aria-expanded', p.hidden ? 'false' : 'true');
    if (!p.hidden) { var mo = document.getElementById('more'); if (mo) mo.classList.remove('open'); }
  }

  /* ---------- SVG-графики ---------- */
  function dumbbell(t) {
    var rows = t.rows.filter(function (r) { return r.stack_rank != null; });
    var N = t.finalists, rowH = MOB ? 21 : 19, L = MOB ? 112 : 175, W = MOB ? 400 : 760, R = MOB ? 16 : 24, H = rows.length * rowH + 52;
    var x = function (p) { return L + (p - 1) / (N - 1) * (W - L - R); };
    var s = '<svg id="race" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Стек и итоговое место">';
    for (var k = 1; k <= N; k += (N > 20 ? 3 : 2)) s += '<line x1="' + x(k) + '" x2="' + x(k) + '" y1="28" y2="' + (H - 10) + '" stroke="var(--line)"/><text class="mu" x="' + x(k) + '" y="20" text-anchor="middle" font-size="11">' + k + '</text>';
    s += '<text class="mu" x="' + L + '" y="10" font-size="11">лучшая позиция → худшая</text>';
    var ft = rows.filter(function (r) { return r.place <= 9; }).length;
    rows.forEach(function (r, i) {
      var y = 38 + i * rowH, c = r.delta > 0 ? 'var(--good)' : (r.delta < 0 ? 'var(--bad)' : 'var(--mute)');
      s += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="' + (MOB ? 11.5 : (disp(r.name).length > 20 ? 10.5 : 12)) + '">' + esc(MOB ? cut(disp(r.name), 17) : disp(r.name)) + '</text>';
      s += '<line class="rl" data-a="' + x(r.stack_rank) + '" data-b="' + x(r.place) + '" x1="' + x(r.stack_rank) + '" x2="' + x(r.place) + '" y1="' + y + '" y2="' + y + '" stroke="' + c + '" stroke-width="3" stroke-linecap="round" opacity=".8"/>';
      s += '<circle cx="' + x(r.stack_rank) + '" cy="' + y + '" r="4" fill="var(--card)" stroke="var(--mute)" stroke-width="1.6"/>';
      s += '<circle class="rc" data-a="' + x(r.stack_rank) + '" data-b="' + x(r.place) + '" cx="' + x(r.place) + '" cy="' + y + '" r="5" fill="' + c + '"><title>' + esc(disp(r.name)) + ': стек №' + r.stack_rank + ' → место ' + r.place + '</title></circle>';
      if (i === ft - 1) s += '<line x1="6" x2="' + (W - 6) + '" y1="' + (y + rowH / 2) + '" y2="' + (y + rowH / 2) + '" stroke="var(--green)" stroke-dasharray="4 3"/><text class="mu" x="' + (W - 8) + '" y="' + (y + rowH / 2 - 3) + '" text-anchor="end" font-size="10">финальный стол</text>';
    });
    return s + '</svg>';
  }
  var raceRaf = 0;
  function setupRace() {
    var svg = document.getElementById('race'); if (!svg) return;
    var ls = svg.querySelectorAll('.rl'), cs = svg.querySelectorAll('.rc'), n = ls.length;
    var slider = document.getElementById('rr'), lab = document.getElementById('rlab');
    var ease = function (u) { return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
    function set(p) {
      for (var i = 0; i < n; i++) {
        var lp = Math.max(0, Math.min(1, p * 1.5 - (i / n) * .5)), e = ease(lp);
        var a = +ls[i].dataset.a, b = +ls[i].dataset.b, v = a + (b - a) * e;
        ls[i].setAttribute('x2', v); cs[i].setAttribute('cx', v);
      }
      slider.value = Math.round(p * 100); lab.textContent = p <= 0.005 ? 'старт: места по стеку' : (p >= .995 ? 'итог финала' : Math.round(p * 100) + '%');
    }
    function play() {
      cancelAnimationFrame(raceRaf);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { set(1); return; }
      var t0 = null; set(0);
      (function step(ts) { if (t0 == null) t0 = ts; var p = Math.min(1, (ts - t0) / 2800); set(p); if (p < 1) raceRaf = requestAnimationFrame(step); })(performance.now());
    }
    slider.addEventListener('input', function () { cancelAnimationFrame(raceRaf); set(slider.value / 100); });
    document.getElementById('rplay').addEventListener('click', play);
    set(1); setTimeout(play, 250);
  }
  function hbars(items, opt) {            // items: [{label, v, color, txt}]
    opt = opt || {};
    var rowH = 24, L = MOB ? 118 : 185, W = MOB ? 400 : 760, H = items.length * rowH + 10, mid, unit, pl = MOB ? 56 : 75, pr = MOB ? 64 : 75;
    if (opt.diverge) {
      var neg = Math.max.apply(null, items.map(function (i) { return i.v < 0 ? -i.v : 0; }).concat([0]));
      var pos = Math.max.apply(null, items.map(function (i) { return i.v > 0 ? i.v : 0; }).concat([0]));
      unit = (W - L - pl - pr) / Math.max(neg + pos, 1e-9); mid = L + pl + neg * unit;
    } else {
      var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.v); }).concat([1e-9]));
      unit = (W - L - (MOB ? 88 : 130)) / max; mid = L;
    }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    if (opt.diverge) s += '<line x1="' + mid + '" x2="' + mid + '" y1="0" y2="' + H + '" stroke="var(--line)"/>';
    items.forEach(function (it, i) {
      var y = 6 + i * rowH, w = Math.abs(it.v) * unit, x0 = it.v < 0 ? mid - w : mid;
      s += '<text x="' + (L - 8) + '" y="' + (y + 13) + '" text-anchor="end" font-size="' + (MOB ? 11.5 : (it.label.length > 22 ? 10.5 : 12)) + '">' + esc(MOB ? cut(it.label, 18) : it.label) + '</text>';
      s += '<rect class="grow" style="transform-origin:' + (it.v < 0 ? 'right' : 'left') + ' center;animation-delay:' + (i * 40) + 'ms" x="' + x0 + '" y="' + y + '" width="' + Math.max(w, 2) + '" height="16" rx="3" fill="' + (it.color || (it.v < 0 ? 'var(--bad)' : 'var(--green)')) + '"/>';
      s += '<text class="mu" x="' + (it.v < 0 ? x0 - 5 : x0 + w + 5) + '" y="' + (y + 13) + '" text-anchor="' + (it.v < 0 ? 'end' : 'start') + '" font-size="12">' + (it.txt != null ? esc(it.txt) : f1(it.v)) + '</text>';
    });
    return s + '</svg>';
  }
  function topBy(arr, key, n, asc) { return arr.slice().sort(function (a, b) { return asc ? a[key] - b[key] : b[key] - a[key]; }).slice(0, n); }
  function playerStats(c) {
    var out = [];
    Object.keys(c.P).forEach(function (name) {
      var p = c.P[name], ent = c.ES.filter(function (e) { return e.name === name; });
      var short = ent.filter(function (e) { return e.rank > e.n / 2; }), top = ent.filter(function (e) { return e.rank <= 3; });
      out.push({ name: name, p: p, ent: ent,
        shortN: short.length, shortAvgRel: short.length ? mean(short.map(function (e) { return e.rel; })) : null,
        vamp: short.filter(function (e) { return e.place <= 9; }).length,
        topN: top.length, topFail: top.filter(function (e) { return e.place > 3; }).length, topLoss: top.length ? mean(top.map(function (e) { return e.rel; })) : null });
    });
    return out;
  }
  CA = buildCtx(T); applyFilter();

  /* ---------- страницы ---------- */
  function stackBar(ranks) {
    var B = [['чиплидер', 'var(--gold)', function (r) { return r === 1; }], ['2–3-й стек', 'var(--green)', function (r) { return r >= 2 && r <= 3; }], ['4–10-й стек', 'var(--blue)', function (r) { return r >= 4 && r <= 10; }], ['ниже 10-го', 'var(--bad)', function (r) { return r > 10; }]];
    var cnt = B.map(function (b) { return ranks.filter(b[2]).length; });
    return '<div class="sbar" role="img" aria-label="Откуда стартовали победители">' + B.map(function (b, i) { return cnt[i] ? '<span style="flex-grow:' + cnt[i] + ';background:' + b[1] + '" title="' + b[0] + ': ' + cnt[i] + '"></span>' : ''; }).join('') + '</div>' +
      '<div class="sleg">' + B.map(function (b, i) { return '<span><i style="background:' + b[1] + '"></i>' + b[0] + ' — <b>' + cnt[i] + '</b></span>'; }).join('') + '</div>';
  }
  function podium(rows) {
    var order = [1, 0, 2], cls = ['s1', 's2', 's3'], med = ['🥇', '🥈', '🥉'], out = '<div class="podium">';
    order.forEach(function (i) {
      var r = rows[i]; if (!r) return;
      out += '<div class="pc ' + cls[i] + '">' + avatar(r.name, 'lg') + '<div class="nm"><a href="#players/' + encodeURIComponent(r.name) + '">' + esc(disp(r.name)) + '</a></div><div class="sub2">' + (r.stack_rank ? 'старт: стек №' + r.stack_rank : '&nbsp;') + '</div><div class="step">' + med[i] + '</div></div>';
    });
    return out + '</div>';
  }
  function pOverview() {
    var leaderWins = stackTs.filter(function (t) { return t.chip_leader.place === 1; }).length;
    var avgLeader = mean(stackTs.map(function (t) { return t.chip_leader.place; }));
    var bestC = topBy(comebacks, 'rel', 1)[0], worstC = topBy(chokes, 'rel', 1, true)[0];
    var winnersRank = stackTs.map(function (t) { return t.winner.stack_rank; });
    var uniq = Object.keys(P).length;
    var t = TA[TA.length - 1], rows = t.top || t.rows.slice(0, 3);
    var h = '<section class="hero"><span class="eyebrow">Последний турнир</span><h1>' + esc(t.title) + '</h1><p class="sub" style="margin:0">финал ' + esc(t.final_date || '') + ' · ' + t.finalists + ' финалистов</p>' + podium(rows) +
      '<div class="hero-links"><a class="btn" href="#tournaments/' + t.id + '">Результаты и график</a><a class="btn ghost" href="#report/' + t.id + '">Автоотчёт</a></div></section>';
    h += filterBar();
    // лидеры рейтинга + межсезонка
    var lead = Object.keys(PA).filter(function (n) { return PA[n].rating_now; }).sort(function (x, y) { return PA[y].rating_now - PA[x].rating_now; }).slice(0, 5), mx = lead.length ? PA[lead[0]].rating_now : 1;
    var cs = IT.series.filter(function (s) { return s.status === 'идёт'; })[0] || IT.series[IT.series.length - 1];
    h += '<div class="twocol"><div class="card"><h3 class="t">Лидеры рейтинга <a href="#players">все игроки →</a></h3>' + lead.map(function (n, i) {
      return '<div class="lrow"><span class="n">' + (i + 1) + '</span>' + plink(n, 'sm') + '<b>' + PA[n].rating_now + '</b><span class="bw"><i style="width:' + Math.round(PA[n].rating_now / mx * 100) + '%"></i></span></div>';
    }).join('') + '<p class="note" style="margin:6px 0 0">Рейтинг — сумма ' + D.rating_top + ' лучших результатов.</p></div>' +
      (cs ? '<div class="card"><h3 class="t">' + esc(cs.title.replace('Межсезонка, ', 'Межсезонка · ')) + (cs.status === 'идёт' ? ' ●' : '') + ' <a href="#inter/' + cs.id + '">зачёт →</a></h3>' + cs.standings.slice(0, 5).map(function (s, i) {
        return '<div class="lrow"><span class="n">' + (i + 1) + '</span>' + plink(s.name, 'sm') + '<b class="' + (s.win > 0 ? 'pos' : 'neg') + '">' + (s.win > 0 ? '+' : '') + fmt(s.win) + '</b></div>';
      }).join('') + '<p class="note" style="margin:6px 0 0">' + cs.days.length + (cs.planned_days ? ' из ' + cs.planned_days : '') + ' дн. · ' + cs.players_total + ' участников</p></div>' : '') + '</div>';
    h += feed();
    h += '<div class="strip"><div><b>' + TA.length + '</b><span>турниров в выборке</span></div><div><b>' + E.length + '</b><span>финальных выступлений</span></div><div><b>' + uniq + '</b><span>разных финалистов</span></div><div><b>' + leaderWins + ' из ' + stackTs.length + '</b><span>раз чиплидер выиграл финал</span></div></div>';
    h += '<h2>Что показывают данные</h2><div class="grid ig">';
    h += ins('bad', 'Проклятие чиплидера', 'Чиплидер — игрок с самым большим стеком на старте финала — ' + (leaderWins ? 'выиграл <b>' + leaderWins + ' из ' + stackTs.length + '</b> финалов' : 'не выиграл ни одного из ' + stackTs.length + ' финалов') + ', в среднем он финишировал ' + f1(avgLeader) + '-м. Откуда стартовали победители:' + stackBar(winnersRank), '🪦');
    if (bestC) h += ins('good', 'Лучший камбек сезона', link(bestC.name) + ' — ' + esc(bestC.t.short) + (bestC.t.nonstandard ? ' ⚠' : '') + ': стартовал ' + bestC.rank + '-м по стеку из ' + bestC.n + ', финишировал ' + bestC.place + '-м.', '🔥');
    if (worstC) h += ins('bad', 'Самая большая потеря преимущества', link(worstC.name) + ' — ' + esc(worstC.t.short) + (worstC.t.nonstandard ? ' ⚠' : '') + ': стартовал ' + worstC.rank + '-м по стеку, финишировал ' + worstC.place + '-м из ' + worstC.n + '.', '📉');
    var q = [0, 1, 2, 3].map(function (i) { var a2 = ES.filter(function (e) { return e.q === i; }); return { tab: a2.filter(function (e) { return e.place <= 9; }).length / (a2.length || 1) }; });
    h += ins('', 'Конвертация стеков', 'Самая большая четверть стеков доходит до финального стола в ' + Math.round(q[0].tab * 100) + '% случаев, самая маленькая — в ' + Math.round(q[3].tab * 100) + '%.', '🎯');
    h += '</div>';
    h += '<h2>Разделы</h2><div class="tiles">' +
      [['#heat', '🗺', 'Карта', 'игрок × турнир'], ['#compare', '⚖', 'Сравнение', 'двух игроков'], ['#rating', '📈', 'Рейтинг', '12 лучших результатов'], ['#fame', '🏛', 'Зал славы', 'чемпионы и рекорды'], ['#fun', '✨', 'Интересное', 'номинации, метрики, охота'], ['#report', '📝', 'Отчёт', 'текст и картинки']]
        .map(function (x) { return '<a class="tile" href="' + x[0] + '"><span class="ti">' + x[1] + '</span><b>' + x[2] + '</b><span>' + x[3] + '</span></a>'; }).join('') + '</div>';
    h += '<h2>Стек и итог по всем финалам</h2><p class="note">Каждая точка — один финалист: чем больше его доля фишек на старте, тем правее. Чем выше итоговое место — тем выше точка.</p><div class="chart">' + scatter() + '</div>' + capScatter();
    return h;
  }
  function kpi(v, l) { var long = String(v).length > 9; return '<div class="card kpi"><b' + (typeof v === 'number' ? ' data-count="' + v + '"' : '') + (long ? ' style="font-size:20px;line-height:1.3;padding:5px 0"' : '') + '>' + v + '</b><span>' + l + '</span></div>'; }
  function ins(cls, t, body, icon) { return '<div class="card insight ' + cls + '"><h3>' + (icon ? '<span class="ico">' + icon + '</span>' : '') + t + '</h3><p>' + body + '</p></div>'; }
  function scatter() {
    var W = MOB ? 400 : 700, H = MOB ? 300 : 360, L = MOB ? 44 : 52, B = 36, R = 14, Tp = 10;
    var maxS = Math.max.apply(null, ES.map(function (e) { return e.share; }));
    var x = function (s) { return L + s / maxS * (W - L - R); }, y = function (p) { return Tp + p * (H - Tp - B); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Доля стека и итоговое место">';
    [0, .25, .5, .75, 1].forEach(function (v) { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text class="mu" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11">' + Math.round(v * 100) + '%</text>'; });
    [0, .05, .1, .15, .2].forEach(function (v) { if (v <= maxS) s += '<text class="mu" x="' + x(v) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="11">' + Math.round(v * 100) + '%</text>'; });
    s += '<text class="mu" x="' + (L + (W - L - R) / 2) + '" y="' + (H - 1) + '" text-anchor="middle" font-size="11">доля всех фишек финала у игрока</text>';
    s += '<text class="mu" transform="translate(12 ' + (Tp + (H - Tp - B) / 2) + ') rotate(-90)" text-anchor="middle" font-size="11">итоговое место (в % поля, 0 = победа)</text>';
    ES.forEach(function (e) {
      var c = e.delta > 0 ? 'var(--good)' : (e.delta < 0 ? 'var(--bad)' : 'var(--mute)');
      s += '<circle cx="' + x(e.share) + '" cy="' + y((e.place - 1) / (e.n - 1)) + '" r="' + (e.place <= 3 ? 6 : 3.8) + '" fill="' + c + '" opacity="' + (e.place <= 3 ? .95 : .55) + '"><title>' + esc(e.name) + ' · ' + esc(e.t.short) + ': ' + e.place + ' место, ранг стека ' + e.rank + '</title></circle>';
    });
    return s + '</svg>';
  }

  var curT = null;
  function pTournaments(id) {
    var t = T.filter(function (x) { return x.id === id; })[0] || T[T.length - 1];
    var years = []; T.forEach(function (x) { if (years.indexOf(x.year) < 0) years.push(x.year); }); years.sort(function (p, q) { return q - p; });
    var h = '<h1>Турниры</h1><div class="tgroups">' + years.map(function (y) {
      var list = T.filter(function (x) { return x.year === y; });
      return '<div class="tg"><div class="tgy"><b>' + y + '</b><span>' + list.length + ' ' + (list.length % 10 === 1 && list.length !== 11 ? 'турнир' : ([2, 3, 4].indexOf(list.length % 10) >= 0 && (list.length < 10 || list.length > 20) ? 'турнира' : 'турниров')) + '</span></div><div class="chips">' + list.map(function (x) {
        var one = !x.days.length && !x.stack_available, dd = (x.final_date || '').split('.').slice(0, 2).join('.');
        return '<button class="chip tch' + (x.id === t.id ? ' on' : '') + (x.nonstandard ? ' ns' : '') + '" data-id="' + x.id + '" title="' + esc(x.title) + '"><b>' + (one ? '🃏 ' : '') + esc(x.short) + (x.nonstandard ? ' ⚠' : '') + '</b><small>' + esc(dd) + '</small></button>';
      }).join('') + '</div></div>';
    }).join('') + '</div><div class="legend" style="margin:-4px 0 8px"><span>🃏 однодневный турнир (только места)</span><span>⚠ нестандартный формат</span></div>';
    var tw = (t.top || t.rows || []).filter(function (r) { return r.place === 1; })[0];
    h += '<h2 style="margin-top:6px">' + esc(t.title) + ' <span class="tag">финал ' + esc(t.final_date || '') + '</span><span class="tag">' + t.finalists + ' финалистов</span>' + (tw ? '<span class="tag">🏆 ' + esc(disp(tw.name)) + '</span>' : '') + '</h2>' + (t.hidden ? '<p class="note">Показаны игроки, которые играют и в 2026 году: ' + t.rows.length + ' из ' + t.finalists + '. Остальные скрыты, чтобы не засорять статистику; места и ранги — по полному полю.</p>' : '');
    if (t.flag) h += '<div class="flag">⚠ ' + esc(t.flag) + '</div>';
    if (t.stack_available) {
      h += '<div class="grid g4" style="margin:10px 0">' + kpi(esc(t.chip_leader.name), 'чиплидер — финишировал ' + t.chip_leader.place + '-м') + kpi(esc(t.winner.name), 'победитель — стартовал ' + t.winner.stack_rank + '-м по стеку') +
        kpi(t.corr == null ? '—' : f1(t.corr), 'корреляция ранга стека и места' + tip('От −1 до 1. Ближе к 1 — размер стека почти решает итог; около 0 — стек не влияет')) + kpi(f1(t.top3_stack_avg_place), 'среднее место трёх крупнейших стеков' + tip('Как в среднем финишировали три игрока с самыми большими стеками на старте')) + '</div>';
      h += '<h2>Стек → итог</h2><p class="note">Светлый круг — место по стеку, цветной — итоговое место; двигайте ползунок или нажмите «Повторить». Зелёный: обыграл свой стек, красный: не оправдал.</p><div class="raceui"><button class="chip" id="rplay">▶ Повторить</button><input type="range" id="rr" min="0" max="100" value="100" aria-label="Ход финала"><span id="rlab" class="note"></span></div><div class="chart">' + dumbbell(t) + '</div>' + capDumb(t);
    }
    h += '<h2>Результаты финала</h2><div class="tw"><table class="rtab"><thead><tr><th>' + (MOB ? '№' : 'Место') + '</th><th class="l">Игрок</th><th>Дней</th>' + (t.stack_available ? (MOB ? '<th>Стек</th><th>Ранг' + tip('Место по размеру стека среди финалистов: 1 — самый большой') + '</th><th>Δ' + tip('Ранг по стеку минус итоговое место. Плюс — игрок обыграл свой стек') + '</th>' : '<th>Стек финала</th><th>Ранг стека' + tip('Место по размеру стека среди финалистов: 1 — самый большой') + '</th><th>Δ мест' + tip('Ранг по стеку минус итоговое место. Плюс — игрок обыграл свой стек') + '</th>') : '') + '<th>Очки рейтинга</th></tr></thead><tbody>';
    t.rows.forEach(function (r) {
      h += '<tr class="' + (r.place <= 3 ? 'p' + r.place : '') + (r.place === 9 ? ' ft' : '') + '"><td>' + r.place + '</td><td class="l">' + plink(r.name) + '</td><td>' + (r.visits == null ? '—' : r.visits) + '</td>';
      if (t.stack_available) {
        var w = Math.min(60, Math.abs(r.delta) * 4);
        h += '<td>' + fmt(r.stack) + '</td><td>' + r.stack_rank + '</td><td class="' + (r.delta > 0 ? 'pos' : (r.delta < 0 ? 'neg' : '')) + '">' + (r.delta ? sgn(r.delta) : '0') + '<span class="bar" style="width:' + w + 'px;background:' + (r.delta > 0 ? 'var(--good)' : 'var(--bad)') + '"></span></td>';
      }
      h += '<td>' + r.points + '</td></tr>';
    });
    h += '</tbody></table></div><p class="note">Δ мест = ранг по стеку − итоговое место (плюс — игрок обыграл свой стек). Строка с зелёной полосой слева — последнее место финального стола (топ-9).</p>';
    var df = dayForm(t);
    h += df || (!t.days.length ? '' : ('<h2>Отборочные дни</h2><div class="tw"><table><thead><tr><th>День</th><th>Дата</th><th>Игроков</th><th>Доля добора</th></tr></thead><tbody>' + t.days.map(function (d) { return '<tr><td>' + d.n + '</td><td>' + esc(d.date) + '</td><td>' + d.players + '</td><td>' + (d.addon_rate == null ? '—' : Math.round(d.addon_rate * 100) + '%') + '</td></tr>'; }).join('') + '</tbody></table></div>'));
    if (t.note) h += '<div class="flag">⚠ ' + esc(t.note) + '</div>';
    return h;
  }

  function heatCell(place, field) {
    if (place == null) return '<td class="mu2">—</td>';
    var u = field > 1 ? (place - 1) / (field - 1) : 0, pct = Math.round(70 * (1 - u));
    return '<td style="background:color-mix(in srgb, var(--green) ' + pct + '%, transparent)" title="место ' + place + ' из ' + field + '">' + place + '</td>';
  }
  function dayForm(t) {
    if (!t.rows.some(function (r) { return r.days.some(function (d) { return d.place != null; }); })) return '';
    var h = '<h2>Отборочные дни и дневная форма финалистов</h2><p class="note">В шапке — дата, сколько игроков пришло и какая доля брала добор (на телефоне: Д1, число игроков, % добора). В клетках — место финалиста в дне (по очкам рейтинга): чем темнее, тем выше; «—» — не играл.</p><div class="tw"><table class="dtab"><thead><tr><th>Итог</th><th class="l">Игрок</th>' + t.days.map(function (d) { return MOB ? '<th>Д' + d.n + '<br><span class="note">' + d.players + (d.addon_rate == null ? '' : '<br>' + Math.round(d.addon_rate * 100) + '%') + '</span></th>' : '<th>День ' + d.n + '<br><span class="note">' + esc(d.date) + '<br>' + d.players + ' игр.' + (d.addon_rate == null ? '' : '<br>добор ' + Math.round(d.addon_rate * 100) + '%') + '</span></th>'; }).join('') + '</tr></thead><tbody>';
    t.rows.forEach(function (r) {
      h += '<tr><td>' + r.place + '</td><td class="l">' + link(r.name) + '</td>' + r.days.map(function (d, i) { return heatCell(d.place, t.days[i].players); }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  var sortKey = 'finals', sortDir = -1, q = '';
  function pPlayers(name) {
    if (name) return pPlayer(name);
    var h = '<h1>Игроки</h1><p class="sub">Статистика по финалам 2025–2026 годов. Нажмите на заголовок, чтобы отсортировать.</p>' + filterBar() + '<input class="search" id="q" placeholder="Поиск по имени" value="' + esc(q) + '">';
    h += '<div id="ptable"></div>';
    return h;
  }
  function renderPT() {
    var cols = [['name', 'Игрок', 'l'], ['finals', 'Финалов'], ['wins', 'Побед'], ['podiums', 'Топ-3'], ['table', 'Фин.стол' + tip('Сколько раз игрок занимал места 1–9 (финальный стол)')], ['avg_place', 'Ср. место'], ['avg_delta', 'Ср. Δ мест' + tip('Ранг по стеку минус итоговое место, в среднем. Плюс — игрок обычно обыгрывает свой стек')], ['sd_place', 'Разброс' + tip('Стандартное отклонение мест: чем меньше, тем стабильнее результаты')]];
    var rows = Object.keys(P).map(function (k) { return P[k]; }).filter(function (p) { return (p.name + ' ' + disp(p.name)).toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    rows.sort(function (a, b) { var x = a[sortKey], y = b[sortKey]; if (x == null) return 1; if (y == null) return -1; return typeof x === 'string' ? sortDir * x.localeCompare(y) : sortDir * (x - y); });
    var h = '<div class="tw tall"><table class="ptab"><thead><tr>' + cols.map(function (c) { return '<th class="s ' + (c[2] || '') + '" data-k="' + c[0] + '">' + c[1] + (sortKey === c[0] ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (p) {
      h += '<tr><td class="l">' + plink(p.name) + '</td><td>' + p.finals + '</td><td>' + p.wins + '</td><td>' + p.podiums + '</td><td>' + p.table + '</td><td>' + f1(p.avg_place) + '</td><td class="' + (p.avg_delta > 0 ? 'pos' : (p.avg_delta < 0 ? 'neg' : '')) + '">' + (p.avg_delta == null ? '—' : f1(p.avg_delta)) + '</td><td>' + f1(p.sd_place) + '</td></tr>';
    });
    document.getElementById('ptable').innerHTML = h + '</tbody></table></div>';
  }
  function badges(name) {
    var p = PA[name], b = [];
    var AWX = CA.AW, first = function (arr) { return arr && arr[0] && arr[0].name === name; };
    if (p.wins) b.push(['🏆', 'Чемпион' + (p.wins > 1 ? ' ×' + p.wins : ''), 'good']);
    if (p.rating_rank === 1) b.push(['👑', 'Лидер рейтинга', 'good']);
    if (first(AWX.kings)) b.push(['🔥', 'Король камбеков', 'good']);
    if (first(AWX.stable)) b.push(['🧱', 'Человек-стабильность', '']);
    if (first(AWX.coaster)) b.push(['🎢', 'Американские горки', '']);
    if (first(AWX.losers)) b.push(['🪦', 'Чиплидер-неудачник', 'bad']);
    if (p.passport && p.passport.visits >= 100) b.push(['🎖', 'Ветеран (' + p.passport.visits + ' игр)', '']);
    if (p.passport && p.passport.first && p.passport.first >= '2026-01-01') b.push(['🌱', 'Новичок 2026', '']);
    return b;
  }
  function ratingChart(p) {
    var s = p.series; if (!s || s.length < 2) return '<p class="note">Недостаточно данных рейтинга.</p>';
    var W = MOB ? 400 : 760, H = MOB ? 240 : 270, L = MOB ? 38 : 48, R = 14, Tp = 16, B = 34, ev = D.events;
    var maxE = Math.max.apply(null, Object.keys(ev).map(Number)), maxR = Math.max.apply(null, s.map(function (z) { return z.rating; })) * 1.08;
    var x = function (e) { return L + (e - 1) / (maxE - 1) * (W - L - R); }, y = function (v) { return Tp + (1 - v / maxR) * (H - Tp - B); };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Рейтинг по событиям">';
    for (var g = 0; g <= 4; g++) { var v = maxR * g / 4; out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text class="mu" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11">' + Math.round(v / 10) * 10 + '</text>'; }
    Object.keys(ev).forEach(function (k) { if (ev[k].kind === 'final') out += '<line x1="' + x(+k) + '" x2="' + x(+k) + '" y1="' + Tp + '" y2="' + (H - B) + '" stroke="var(--gold)" stroke-dasharray="2 4" opacity=".6"/><text class="mu" x="' + x(+k) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="10">' + (MOB ? '' : esc(ev[k].label.replace(' · финал', ''))) + '</text>'; });
    var pts = s.map(function (z) { return x(z.e) + ',' + y(z.rating); });
    var area = 'M' + x(s[0].e) + ',' + y(0) + ' L' + pts.join(' L') + ' L' + x(s[s.length - 1].e) + ',' + y(0) + ' Z';
    out += '<path d="' + area + '" fill="var(--green)" opacity=".12"/><polyline class="draw" pathLength="1" points="' + pts.join(' ') + '" fill="none" stroke="var(--green)" stroke-width="2.4" stroke-linejoin="round"/>';
    s.forEach(function (z) {
      var e = ev[z.e] || { label: 'Событие ' + z.e, kind: 'other' };
      out += '<circle class="pt" cx="' + x(z.e) + '" cy="' + y(z.rating) + '" r="' + (e.kind === 'final' ? 5 : 3) + '" fill="' + (e.kind === 'final' ? 'var(--gold)' : 'var(--card)') + '" stroke="var(--green)" stroke-width="1.6"><title>' + esc(e.label) + ': +' + z.pts + ' → рейтинг ' + z.rating + (z.rank ? ', #' + z.rank + ' в рейтинге' : '') + '</title></circle>';
    });
    var last = s[s.length - 1];
    out += '<text x="' + (x(last.e) - 6) + '" y="' + (y(last.rating) - 10) + '" text-anchor="end" font-size="12" font-weight="700">' + last.rating + '</text>';
    return out + '</svg>';
  }
  function pPlayer(name) {
    var p = PA[name]; if (!p) return '<h1>Игрок не найден</h1>';
    var h = '<p><a href="#players">← все игроки</a></p><h1 class="ph">' + avatar(name, 'lg') + '<span>' + esc(disp(name)) + '</span></h1><div class="pact"><a class="btn ghost" href="#compare/' + encodeURIComponent(name) + '">⚖ Сравнить</a><button class="btn ghost" type="button" id="pprint">🖨 Печать / PDF</button><button class="btn ghost" type="button" id="pshare">🖼 Картинкой</button><span class="note" id="pmsg"></span></div>';
    var bg = badges(name);
    h += '<p class="sub">' + p.finals + ' финал(ов) в базе · лучшее место ' + Math.min.apply(null, p.places) + ' · среднее ' + f1(p.avg_place) + '</p>';
    if (bg.length) h += '<div class="badges">' + bg.map(function (b) { return '<span class="badge ' + b[2] + '"><i>' + b[0] + '</i>' + esc(b[1]) + '</span>'; }).join('') + '</div>';
    if (p.passport) {
      var pp = p.passport, bits = [];
      if (pp.visits != null) bits.push('<b>' + pp.visits + '</b> посещений клуба');
      if (pp.first) bits.push('с ' + pp.first.split('-').reverse().join('.'));
      if (pp.hand) bits.push('любимая рука <b>' + esc(pp.hand) + '</b>');
      if (bits.length || pp.motto) h += '<div class="card passport">' + bits.join(' · ') + (pp.motto ? '<br><i class="note">«' + esc(pp.motto) + '»</i>' : '') + '</div>';
    }
    h += '<div class="grid g4" style="margin-top:12px">' + kpi(p.wins, 'побед') + kpi(p.podiums, 'призовых мест') + kpi(p.table, 'финальных столов') + kpi(p.avg_delta == null ? '—' : f1(p.avg_delta), 'ср. Δ мест (стек → итог)' + tip('Ранг по стеку минус итоговое место. Плюс — игрок обычно обыгрывает свой стек')) +
      (p.rating_now != null ? kpi(p.rating_now, 'рейтинг (#' + (p.rating_rank || '—') + ')') : '') + '</div>';
    h += formStrip(p) + profileInsights(name);
    h += '<h2>Рейтинг по событиям</h2><p class="note">Рейтинг — сумма ' + D.rating_top + ' лучших результатов. Золотые точки — финалы турниров; наведите курсор на точку.</p><div class="chart">' + ratingChart(p) + '</div>' + capRating(p) + (p.rating_now ? '<p class="note"><a href="#rating/' + encodeURIComponent(name) + '">Какие результаты в зачёте и сколько нужно для обгона соседей →</a></p>' : '');
    h += interBlock(name);
    h += '<h2>История финалов</h2><div class="tw"><table class="htab"><thead><tr><th class="l">Турнир</th><th>Место</th><th>из</th><th>Ранг стека</th><th>Δ мест</th><th>Стек</th><th>Дней</th><th>Дневная форма</th></tr></thead><tbody>';
    p.list.forEach(function (l) {
      var t = T.filter(function (x) { return x.id === l.t; })[0], row = t && t.rows.filter(function (r) { return r.name === name; })[0];
      var form = row ? row.days.map(function (d, i) { return d.place == null ? '<span class="dchip off">—</span>' : '<span class="dchip" title="день ' + (i + 1) + ': ' + d.place + ' из ' + t.days[i].players + '">' + d.place + '</span>'; }).join('') : '';
      h += '<tr><td class="l"><a class="pl" href="#tournaments/' + l.t + '">' + esc(l.short) + '</a></td><td>' + l.place + '</td><td>' + l.of + '</td><td>' + (l.stack_rank == null ? '—' : l.stack_rank) + '</td><td class="' + (l.delta > 0 ? 'pos' : (l.delta < 0 ? 'neg' : '')) + '">' + (l.delta == null ? '—' : sgn(l.delta)) + '</td><td>' + fmt(l.stack) + '</td><td>' + (l.visits == null ? '—' : l.visits) + '</td><td>' + form + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- автоотчёт по турниру ---------- */
  function ordinal(n) { return n + '-е'; }
  function reportFacts(t) {
    var rows = t.rows, f = { t: t, top: t.top || rows.slice(0, 3), n: t.finalists };
    f.table = rows.filter(function (r) { return r.place <= 9; });
    if (t.stack_available) {
      var withS = rows.filter(function (r) { return r.stack_rank != null; });
      f.leader = withS.filter(function (r) { return r.stack_rank === 1; })[0] || (t.chip_leader ? { name: t.chip_leader.name, place: t.chip_leader.place, stack_rank: 1 } : null);
      f.winner = (t.top && t.top[0]) || rows[0];
      var cb = withS.filter(function (r) { return r.stack_rank > t.finalists / 2; }).sort(function (x, y) { return y.delta - x.delta; })[0];
      var ls = withS.filter(function (r) { return r.stack_rank <= 3; }).sort(function (x, y) { return x.delta - y.delta; })[0];
      f.comeback = cb && cb.delta > 0 ? cb : null; f.loss = ls && ls.delta < 0 ? ls : null;
      var top9 = withS.filter(function (r) { return r.stack_rank <= 9; }).map(function (r) { return r.name; });
      f.overlap = t.hidden ? null : f.table.filter(function (r) { return top9.indexOf(r.name) >= 0; }).length;
    }
    f.dayWinners = t.days.map(function (d, i) { return rows.filter(function (r) { return r.days[i] && r.days[i].place === 1; }).map(function (r) { return r.name; })[0]; });
    var gains = [];
    rows.forEach(function (r) {
      var p = PA[r.name]; if (!p || !p.series) return;
      var idx = p.series.map(function (z) { return z.e; }).indexOf(t.rating_event); if (idx < 0) return;
      var cur = p.series[idx], prev = idx ? p.series[idx - 1] : { rating: 0, rank: null };
      gains.push({ name: r.name, gain: cur.rating - prev.rating, rating: cur.rating, rank: cur.rank, prevRank: prev.rank });
    });
    f.climber = gains.slice().sort(function (x, y) { return y.gain - x.gain; })[0];
    f.ratingLeader = gains.slice().sort(function (x, y) { return y.rating - x.rating; })[0];
    return f;
  }
  function reportText(f) {
    var t = f.t, nm = function (r) { return disp(r.name); }, L = [];
    L.push('🏆 Итоги турнира «' + t.title + '»' + (t.final_date ? ' (финал ' + t.final_date + ')' : ''));
    L.push('🥇 ' + nm(f.top[0]) + '  ·  🥈 ' + nm(f.top[1]) + '  ·  🥉 ' + nm(f.top[2]));
    L.push('Финалистов: ' + f.n + '.' + (f.winner && f.winner.stack_rank ? ' Победитель стартовал ' + f.winner.stack_rank + '-м по размеру стека.' : ''));
    if (f.leader) L.push(f.leader.place === 1 ? '👑 Чиплидер финала ' + nm(f.leader) + ' не сдал позиции и победил.' : '🪦 Проклятие чиплидера: ' + nm(f.leader) + ' начинал финал самым большим стеком, а закончил на ' + f.leader.place + '-м месте.');
    if (f.comeback) L.push('🔥 Камбек турнира: ' + nm(f.comeback) + ' — ' + f.comeback.stack_rank + '-й стек из ' + f.n + ' → ' + ordinal(f.comeback.place) + ' место.');
    if (f.loss && (!f.leader || f.loss.name !== f.leader.name)) L.push('📉 Потеря преимущества: ' + nm(f.loss) + ' — ' + f.loss.stack_rank + '-й стек → ' + ordinal(f.loss.place) + ' место.');
    if (f.overlap != null) L.push('🎯 Из девяти мест финального стола ' + f.overlap + ' заняли игроки из топ-9 по стеку.');
    var dw = f.dayWinners.map(function (n, i) { return n ? 'день ' + (i + 1) + ' — ' + disp(n) : null; }).filter(Boolean);
    if (dw.length) L.push('📅 Победители отборочных дней среди финалистов: ' + dw.join('; ') + '.');
    if (f.ratingLeader) L.push('📈 Рейтинг после турнира: лидер ' + disp(f.ratingLeader.name) + ' (' + f.ratingLeader.rating + ')' + (f.climber && f.climber.gain > 0 ? '; больше всех вырос ' + disp(f.climber.name) + ' (+' + f.climber.gain + ').' : '.'));
    return L.join('\n');
  }
  function pReport(id) {
    var t = T.filter(function (x) { return x.id === id; })[0] || T[T.length - 1], f = reportFacts(t);
    var h = '<h1>Автоотчёт</h1><p class="sub">Готовый текст для поста и картинки по итогам турнира — собираются сами из данных.</p><div class="chips">' +
      T.map(function (x) { return '<button class="chip rpt' + (x.id === t.id ? ' on' : '') + '" data-id="' + x.id + '">' + esc(x.short) + '</button>'; }).join('') + '</div>';
    h += '<div class="card"><h3>Текст для поста</h3><pre class="reptext" id="reptext">' + esc(reportText(f)) + '</pre><button class="chip" id="repcopy">Скопировать текст</button> <span class="note" id="repmsg"></span></div>';
    h += '<h2>Картинки</h2><div class="grid g2"><div class="card"><h3>Итоги и призёры</h3><canvas id="cv1" class="cv" width="1080" height="1350"></canvas><button class="chip dl" data-cv="cv1" data-name="itogi">Скачать PNG</button></div>' +
      '<div class="card"><h3>Главные истории</h3><canvas id="cv2" class="cv" width="1080" height="1350"></canvas><button class="chip dl" data-cv="cv2" data-name="istorii">Скачать PNG</button></div></div>';
    pReport.cur = f;
    return h;
  }
  function wrapText(c, text, x, y, maxW, lh) {
    var words = String(text).split(' '), line = '';
    words.forEach(function (w) { var test = line ? line + ' ' + w : w; if (c.measureText(test).width > maxW && line) { c.fillText(line, x, y); line = w; y += lh; } else line = test; });
    if (line) { c.fillText(line, x, y); y += lh; }
    return y;
  }
  function cardBase(c, f, title) {
    var g = c.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, '#14452f'); g.addColorStop(1, '#0c2418');
    c.fillStyle = g; c.fillRect(0, 0, 1080, 1350);
    c.fillStyle = '#c8a24a'; c.font = '700 40px system-ui, Arial'; c.fillText('♠ неПокер · Циферблат', 70, 110);
    c.fillStyle = '#ffffff'; c.font = '700 64px system-ui, Arial'; var y = wrapText(c, f.t.title, 70, 210, 940, 76);
    c.fillStyle = '#9fc4b0'; c.font = '400 34px system-ui, Arial'; c.fillText(title + (f.t.final_date ? ' · ' + f.t.final_date : ''), 70, y + 10);
    return y + 80;
  }
  function drawCards() {
    var f = pReport.cur; if (!f) return;
    var c1 = document.getElementById('cv1'), c2 = document.getElementById('cv2'); if (!c1) return;
    var c = c1.getContext('2d'), y = cardBase(c, f, 'Итоги финала'), medals = ['🥇', '🥈', '🥉'], sz = [70, 60, 56];
    f.top.forEach(function (r, i) {
      c.fillStyle = i === 0 ? '#e8c76a' : '#ffffff'; c.font = '700 ' + sz[i] + 'px system-ui, Arial'; c.fillText(medals[i] + ' ' + disp(r.name), 70, y);
      if (r.stack_rank) { c.fillStyle = '#9fc4b0'; c.font = '400 30px system-ui, Arial'; c.fillText('стек №' + r.stack_rank + ' → место ' + r.place, 120, y + 44); }
      y += 120;
    });
    c.fillStyle = '#9fc4b0'; c.font = '400 32px system-ui, Arial'; c.fillText('Финальный стол', 70, y + 10); y += 60;
    c.font = '400 36px system-ui, Arial';
    (f.t.hidden ? [] : f.table.slice(3)).forEach(function (r, i) { c.fillStyle = '#ffffff'; c.fillText(r.place + '. ' + disp(r.name), 70 + (i % 2) * 480, y + Math.floor(i / 2) * 56); });
    c.fillStyle = '#6c8d7c'; c.font = '400 28px system-ui, Arial'; c.fillText(f.n + ' финалистов', 70, 1290);
    var d = c2.getContext('2d'), y2 = cardBase(d, f, 'Главные истории'), items = [];
    if (f.leader) items.push([f.leader.place === 1 ? '👑 Чиплидер победил' : '🪦 Проклятие чиплидера', disp(f.leader.name) + ': стек №1 → ' + f.leader.place + '-е место']);
    if (f.comeback) items.push(['🔥 Камбек турнира', disp(f.comeback.name) + ': стек №' + f.comeback.stack_rank + ' → ' + f.comeback.place + '-е место']);
    if (f.loss && (!f.leader || f.loss.name !== f.leader.name)) items.push(['📉 Потеря преимущества', disp(f.loss.name) + ': стек №' + f.loss.stack_rank + ' → ' + f.loss.place + '-е место']);
    if (f.overlap != null) items.push(['🎯 Финальный стол', f.overlap + ' из 9 мест — у игроков из топ-9 по стеку']);
    if (f.ratingLeader) items.push(['📈 Рейтинг', 'Лидер ' + disp(f.ratingLeader.name) + ' — ' + f.ratingLeader.rating]);
    if (!items.length) items.push(['🏆 Победитель', disp(f.top[0].name)]);
    items.slice(0, 4).forEach(function (it) {
      d.fillStyle = '#e8c76a'; d.font = '700 44px system-ui, Arial'; d.fillText(it[0], 70, y2);
      d.fillStyle = '#ffffff'; d.font = '400 40px system-ui, Arial'; y2 = wrapText(d, it[1], 70, y2 + 56, 940, 52) + 48;
    });
  }

  /* ---------- сравнение двух игроков ---------- */
  function cmpOrder() { return Object.keys(PA).sort(function (a, b) { return PA[b].finals - PA[a].finals || a.localeCompare(b); }); }
  function selOpts(sel) { return cmpOrder().map(function (n) { return '<option value="' + esc(n) + '"' + (n === sel ? ' selected' : '') + '>' + esc(disp(n)) + '</option>'; }).join(''); }
  function cmpRow(label, a, b, better, f) {
    var ca = '', cb = '';
    if (better && a != null && b != null && a !== b) { var aw = better === 'high' ? a > b : a < b; ca = aw ? 'win' : ''; cb = aw ? '' : 'win'; }
    return '<tr><td class="' + ca + '">' + (f ? f(a) : (a == null ? '—' : a)) + '</td><td class="mid">' + label + '</td><td class="' + cb + '">' + (f ? f(b) : (b == null ? '—' : b)) + '</td></tr>';
  }
  function ratingMulti(list) {
    var W = MOB ? 400 : 760, H = MOB ? 240 : 280, L = MOB ? 38 : 48, R = 14, Tp = 16, B = 34, ev = D.events, maxE = Math.max.apply(null, Object.keys(D.events).map(Number));
    var maxR = Math.max.apply(null, list.map(function (z) { return Math.max.apply(null, (z.p.series || [{ rating: 1 }]).map(function (q) { return q.rating; })); })) * 1.08;
    var x = function (e) { return L + (e - 1) / (maxE - 1) * (W - L - R); }, y = function (v) { return Tp + (1 - v / maxR) * (H - Tp - B); };
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Рейтинг двух игроков">';
    for (var g = 0; g <= 4; g++) { var v = maxR * g / 4; out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text class="mu" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11">' + Math.round(v / 10) * 10 + '</text>'; }
    Object.keys(ev).forEach(function (k) { if (ev[k].kind === 'final') out += '<line x1="' + x(+k) + '" x2="' + x(+k) + '" y1="' + Tp + '" y2="' + (H - B) + '" stroke="var(--gold)" stroke-dasharray="2 4" opacity=".5"/><text class="mu" x="' + x(+k) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="10">' + (MOB ? '' : esc(ev[k].label.replace(' · финал', ''))) + '</text>'; });
    list.forEach(function (z) {
      var s = z.p.series; if (!s || s.length < 2) return;
      out += '<polyline class="draw" pathLength="1" points="' + s.map(function (q) { return x(q.e) + ',' + y(q.rating); }).join(' ') + '" fill="none" stroke="' + z.color + '" stroke-width="2.6" stroke-linejoin="round"/>';
      s.forEach(function (q) { var e = ev[q.e] || { label: 'Событие ' + q.e, kind: 'other' }; out += '<circle cx="' + x(q.e) + '" cy="' + y(q.rating) + '" r="' + (e.kind === 'final' ? 4.5 : 2.6) + '" fill="' + z.color + '"><title>' + esc(disp(z.name)) + ' · ' + esc(e.label) + ': +' + q.pts + ' → ' + q.rating + '</title></circle>'; });
    });
    return out + '</svg>';
  }
  function setupCompare() {
    document.querySelectorAll('.cmpsrch').forEach(function (inp) {
      var box = inp.parentNode.querySelector('.cmpres'), sideId = inp.dataset.side;
      function find(q) { q = q.trim().toLowerCase(); if (!q) return []; return Object.keys(PA).filter(function (n) { return (n + ' ' + disp(n)).toLowerCase().indexOf(q) >= 0; }).sort(function (x, y) { return PA[y].finals - PA[x].finals; }).slice(0, 8); }
      function go(n) {
        var A = document.getElementById('cmpA').value, B = document.getElementById('cmpB').value;
        if (sideId === 'A') A = n; else B = n;
        location.hash = '#compare/' + encodeURIComponent(A) + '/' + encodeURIComponent(B);
      }
      function show() {
        var r = find(inp.value);
        box.innerHTML = r.map(function (n) { return '<a href="#" data-n="' + esc(n) + '">' + avatar(n, 'sm') + '<span>' + esc(disp(n)) + '</span> <span class="note">' + PA[n].finals + ' фин.</span></a>'; }).join('') || (inp.value.trim() ? '<span class="note" style="padding:8px 12px;display:block">Никого не найдено</span>' : '');
        box.hidden = !box.innerHTML;
      }
      inp.addEventListener('input', show); inp.addEventListener('focus', show);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var r = find(inp.value); if (r[0]) go(r[0]); } if (e.key === 'Escape') { box.hidden = true; inp.blur(); } });
      box.addEventListener('mousedown', function (e) { var l = e.target.closest('a[data-n]'); if (l) { e.preventDefault(); go(l.dataset.n); } });
      document.addEventListener('click', function (e) { if (!e.target.closest('.cmpq')) box.hidden = true; });
    });
  }

  function pCompare(a, b) {
    var names = cmpOrder();
    if (!a || !PA[a]) a = PA['Богдан А'] ? 'Богдан А' : names[0];
    if (!b || !PA[b] || b === a) b = (PA['Семён Ануфриев'] && a !== 'Семён Ануфриев') ? 'Семён Ануфриев' : names.filter(function (n) { return n !== a; })[0];
    var pa = PA[a], pb = PA[b], bgs = function (n) { return badges(n).map(function (x) { return '<span class="badge ' + x[2] + '"><i>' + x[0] + '</i>' + esc(x[1]) + '</span>'; }).join(''); };
    var h = '<h1>Сравнение игроков</h1><p class="sub">Все данные (2025–2026), без фильтров периода.</p>';
    var side = function (id, sel, ph) { return '<div class="cmpside"><div class="cmpq"><input class="cmpsrch" data-side="' + id + '" type="search" placeholder="' + ph + '" autocomplete="off" aria-label="' + ph + '"><div class="gsr cmpres" hidden></div></div><select id="cmp' + id + '" aria-label="Игрок ' + (id === 'A' ? 1 : 2) + '">' + selOpts(sel) + '</select></div>'; };
    h += '<div class="cmpsel">' + side('A', a, 'Найти первого игрока…') + '<span>vs</span>' + side('B', b, 'Найти второго игрока…') + '</div>';
    h += '<div class="grid g2"><div class="card"><h3 style="font-size:18px;color:var(--green)">' + plink(a, 'md') + '</h3><div class="badges">' + bgs(a) + '</div></div><div class="card"><h3 style="font-size:18px;color:var(--gold)">' + plink(b, 'md') + '</h3><div class="badges">' + bgs(b) + '</div></div></div>';
    var pct = function (p) { return p.finals ? Math.round(p.table / p.finals * 100) : null; };
    var rows = cmpRow('рейтинг', pa.rating_now, pb.rating_now, 'high') + cmpRow('место в рейтинге', pa.rating_rank, pb.rating_rank, 'low', function (v) { return v == null ? '—' : '#' + v; }) +
      cmpRow('финалов', pa.finals, pb.finals, 'high') + cmpRow('побед', pa.wins, pb.wins, 'high') + cmpRow('призовых мест (топ-3)', pa.podiums, pb.podiums, 'high') +
      cmpRow('финальных столов (топ-9)', pa.table, pb.table, 'high') + cmpRow('доля финальных столов', pct(pa), pct(pb), 'high', function (v) { return v == null ? '—' : v + '%'; }) +
      cmpRow('среднее место', pa.avg_place, pb.avg_place, 'low', f1) + cmpRow('лучшее место', Math.min.apply(null, pa.places), Math.min.apply(null, pb.places), 'low') +
      cmpRow('ср. Δ мест (стек → итог)' + tip('Ранг по стеку минус итоговое место. Плюс — игрок обычно обыгрывает свой стек'), pa.avg_delta, pb.avg_delta, 'high', f1) + cmpRow('разброс мест (меньше — стабильнее)', pa.sd_place, pb.sd_place, 'low', f1) +
      cmpRow('посещений клуба', pa.passport && pa.passport.visits, pb.passport && pb.passport.visits, 'high') +
      cmpRow('первое посещение', pa.passport && pa.passport.first, pb.passport && pb.passport.first, null, function (v) { return v ? v.split('-').reverse().join('.') : '—'; });
    h += '<div class="tw" style="margin-top:12px"><table class="cmp"><thead><tr><th style="text-align:right">' + esc(disp(a)) + '</th><th>показатель</th><th style="text-align:left">' + esc(disp(b)) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    h += '<h2>Рейтинг по событиям</h2><div class="legend"><span><i class="dot" style="background:var(--green)"></i>' + esc(disp(a)) + '</span><span><i class="dot" style="background:var(--gold)"></i>' + esc(disp(b)) + '</span></div><div class="chart">' + ratingMulti([{ p: pa, name: a, color: 'var(--green)' }, { p: pb, name: b, color: 'var(--gold)' }]) + '</div>' + capCompare(a, b, pa, pb);
    var common = pa.list.filter(function (x) { return pb.list.some(function (y) { return y.t === x.t; }); });
    h += '<h2>Очные встречи в финалах</h2>';
    if (!common.length) h += '<p class="note">Эти игроки не встречались в общих финалах.</p>';
    else {
      var aw = 0, bw = 0;
      var body = common.map(function (x) {
        var y = pb.list.filter(function (z) { return z.t === x.t; })[0], ca = x.place < y.place, cb = y.place < x.place;
        aw += ca; bw += cb;
        return '<tr><td class="l"><a class="pl" href="#tournaments/' + x.t + '">' + esc(x.short) + '</a></td><td class="' + (ca ? 'win' : '') + '">' + x.place + '</td><td>' + (x.stack_rank == null ? '—' : x.stack_rank) + '</td><td class="' + (cb ? 'win' : '') + '">' + y.place + '</td><td>' + (y.stack_rank == null ? '—' : y.stack_rank) + '</td></tr>';
      }).join('');
      h += duelCard(a, b, pa, pb, common);
      h += '<div class="tw"><table><thead><tr><th class="l">Турнир</th><th>' + esc(MOB ? cut(disp(a), 9) : disp(a) + ': место') + '</th><th>' + (MOB ? 'стек' : 'ранг стека') + '</th><th>' + esc(MOB ? cut(disp(b), 9) : disp(b) + ': место') + '</th><th>' + (MOB ? 'стек' : 'ранг стека') + '</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    }
    return h;
  }

  /* ---------- тепловая карта «игрок × турнир» ---------- */
  var heat = { hmetric: 'place', hsort: 'finals', hmin: '2', hq: '' };
  function pHeat() {
    var minF = +heat.hmin, cell = {};
    E.forEach(function (e) { cell[e.name + '|' + e.t.id] = e; });
    var hq = (heat.hq || '').trim().toLowerCase();
    var rows = Object.keys(P).map(function (k) { return P[k]; }).filter(function (p) { return (hq ? true : p.finals >= minF) && (!hq || (p.name + ' ' + disp(p.name)).toLowerCase().indexOf(hq) >= 0); });
    var key = heat.hsort;
    rows.sort(function (x, y) {
      if (key === 'avg') return x.avg_place - y.avg_place;
      if (key === 'name') return disp(x.name).localeCompare(disp(y.name));
      if (key === 'delta') return (y.avg_delta == null ? -99 : y.avg_delta) - (x.avg_delta == null ? -99 : x.avg_delta);
      return y.finals - x.finals || x.avg_place - y.avg_place;
    });
    var sel = function (id, cur, o) { return '<select id="' + id + '">' + o.map(function (v) { return '<option value="' + v[0] + '"' + (String(cur) === String(v[0]) ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select>'; };
    var h = '<h1>Карта «игрок × турнир»</h1><p class="sub">Каждая клетка — один финал. Читайте по строке: стабильность игрока; по столбцу: кто «вытянул» турнир.</p>' + filterBar();
    h += '<div class="fbar"><label>Показывать ' + sel('hmetric', heat.hmetric, [['place', 'итоговое место'], ['delta', 'Δ мест (стек → итог)']]) + '</label><label>Сортировка ' + sel('hsort', heat.hsort, [['finals', 'по числу финалов'], ['avg', 'по среднему месту'], ['delta', 'по среднему Δ'], ['name', 'по имени']]) + '</label><label>Минимум финалов ' + sel('hmin', heat.hmin, [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']]) + '</label><label class="hqw">Игрок <input id="hq" type="search" class="hq" placeholder="Найти игрока…" autocomplete="off" value="' + esc(heat.hq || '') + '"></label></div>';
    h += '<div class="tw tall"><table class="heat"><thead><tr><th class="l">Игрок</th>' + TA.map(function (t) { return '<th><a class="pl" href="#tournaments/' + t.id + '" title="' + esc(t.title) + '">' + esc(t.short) + '</a><br><span class="note">' + (t.year || '') + '</span></th>'; }).join('') + '<th>Ср.</th></tr></thead><tbody>';
    rows.forEach(function (p) {
      h += '<tr><td class="l">' + link(p.name) + '</td>' + TA.map(function (t) {
        var e = cell[p.name + '|' + t.id];
        if (!e) return '<td class="mu2">·</td>';
        var tip = esc(disp(p.name)) + ' · ' + esc(t.short) + ': место ' + e.place + ' из ' + e.n + (e.rank ? ', стек №' + e.rank : '');
        if (heat.hmetric === 'delta') {
          if (e.delta == null) return '<td class="mu2" title="' + tip + '">·</td>';
          var up = e.delta > 0, pc = Math.min(85, Math.round(12 + Math.abs(e.delta) / (e.n - 1) * 230));
          return '<td style="background:color-mix(in srgb, ' + (up ? 'var(--good)' : 'var(--bad)') + ' ' + (e.delta ? pc : 0) + '%, transparent)" title="' + tip + '">' + (e.delta ? sgn(e.delta) : '0') + '</td>';
        }
        if (e.place === 1) return '<td style="background:var(--gold);color:#1c2622;font-weight:700" title="' + tip + '">1</td>';
        var u = (e.place - 1) / (e.n - 1);
        return '<td style="background:color-mix(in srgb, var(--green) ' + Math.round(10 + 70 * (1 - u)) + '%, transparent)" title="' + tip + '">' + e.place + '</td>';
      }).join('') + '<td><b>' + (heat.hmetric === 'delta' ? (p.avg_delta == null ? '—' : f1(p.avg_delta)) : f1(p.avg_place)) + '</b></td></tr>';
    });
    h += '</tbody></table></div><p class="note">Золото — победа. Тёмно-зелёный — высокое место. «·» — игрок не был в финале. Игроков в таблице: ' + rows.length + '.</p>' + capHeat(rows);
    return h;
  }

  /* ---------- межсезонка ---------- */
  var IT = D.interseason || { series: [], alltime: [] };
  function pInter(id) {
    var S = IT.series; if (!S.length) return '<h1>Межсезонка</h1><p class="note">Нет данных.</p>';
    var s = S.filter(function (x) { return x.id === id; })[0] || S[S.length - 1];
    var rev = S.slice().reverse();
    var h = '<h1>Межсезонка</h1><p class="sub">Тренировочные игры без вылета: у каждого день «вход + добор → выход», считаем выигрыш в фишках. Чиплидер серии получает приз и место в Сателлите.</p>';
    h += '<div class="chips">' + rev.map(function (x) { return '<button class="chip itr' + (x.id === s.id ? ' on' : '') + '" data-id="' + x.id + '">' + esc(x.title.replace('Межсезонка, ', '')) + (x.status === 'идёт' ? ' ●' : '') + '</button>'; }).join('') + '</div>';
    var st = s.standings, lead = st[0], bestDay = null;
    s.days.forEach(function (d) { d.players.forEach(function (p) { if (!bestDay || p.win > bestDay.win) bestDay = { name: p.name, win: p.win, n: d.n }; }); });
    h += '<h2 style="margin-top:6px">' + esc(s.title) + ' <span class="tag">' + esc(s.status) + '</span></h2>';
    h += '<div class="grid g4" style="margin:8px 0">' + kpi(s.players_total, 'участников') + kpi(s.days.length + (s.planned_days ? ' из ' + s.planned_days : ''), 'игровых дней') + kpi(esc(disp(lead.name)), 'чиплидер: ' + (lead.win > 0 ? '+' : '') + fmt(lead.win)) + kpi(esc(disp(bestDay.name)), 'лучший день: +' + fmt(bestDay.win) + ' (день ' + bestDay.n + ')') + '</div>';
    var nd = s.days.length;
    h += '<h2>Общий зачёт</h2><div class="tw tall"><table class="istab"><thead><tr><th>№</th><th class="l">Игрок</th><th>Дней</th><th>Сумма' + tip('Выигрыш = выход − вход − добор, в фишках') + '</th>' + s.days.map(function (d) { return '<th class="dcol">Д' + d.n + '</th>'; }).join('') + '</tr></thead><tbody>';
    st.forEach(function (t, i) {
      h += '<tr class="' + (i < 3 ? 'p' + (i + 1) : '') + '"><td>' + (i + 1) + '</td><td class="l">' + plink(t.name) + '</td><td>' + t.days + '</td><td class="' + (t.win > 0 ? 'pos' : (t.win < 0 ? 'neg' : '')) + '"><b>' + (t.win > 0 ? '+' : '') + fmt(t.win) + '</b></td>' +
        s.days.map(function (d) { var v = t.per_day[d.n]; return '<td class="dcol ' + (v > 0 ? 'pos' : (v < 0 ? 'neg' : '')) + '">' + (v == null ? '·' : (v > 0 ? '+' : '') + fmt(v)) + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table></div>';
    var plus = st.filter(function (t) { return t.win > 0; }).length;
    h += cap('В плюсе по итогам серии ' + plus + ' из ' + st.length + ' игроков. Выигрыш = выход − вход − добор, поэтому сумма по всем игрокам примерно нулевая.');
    var DAYN = s.days.length > 0 ? s.days[s.days.length - 1] : null;
    if (DAYN) {
      h += '<h2>Результаты дня ' + DAYN.n + (DAYN.date ? ' — ' + esc(DAYN.date) : '') + '</h2><div class="tw tall"><table class="itday"><thead><tr><th>№</th><th class="l">Игрок</th><th>Выигрыш</th><th>Добор</th><th>Выход</th></tr></thead><tbody>' +
        DAYN.players.slice().sort(function (x, y) { return y.win - x.win; }).map(function (p, i) { return '<tr><td>' + (i + 1) + '</td><td class="l">' + link(p.name) + '</td><td class="' + (p.win > 0 ? 'pos' : (p.win < 0 ? 'neg' : '')) + '">' + (p.win > 0 ? '+' : '') + fmt(p.win) + '</td><td>' + (p.extra ? fmt(p.extra) : '—') + '</td><td>' + fmt(p.exit) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (s.hunting && s.hunting.length) {
      h += '<h2>Охота за головами</h2><p class="note">Цена за голову игрока в текущей серии (по данным сайта результатов).</p><div class="chart">' + hbars(s.hunting.slice(0, 12).map(function (x) { return { label: disp(x.name), v: x.value, txt: fmt(x.value), color: 'var(--gold)' }; })) + '</div>';
    }
    var all = IT.alltime.slice(0, 20);
    h += '<h2>Все межсезонки: лучшие игроки</h2><p class="note">Сумма выигрыша за все серии 2023–2026 (по данным клубной таблицы и сайта).</p><div class="tw tall"><table class="iatab"><thead><tr><th>№</th><th class="l">Игрок</th><th>Серий</th><th>Дней</th><th>Сумма</th><th>Побед в серии</th><th>% плюсовых дней</th></tr></thead><tbody>' +
      all.map(function (t, i) { return '<tr><td>' + (i + 1) + '</td><td class="l">' + link(t.name) + '</td><td>' + t.series + '</td><td>' + t.days + '</td><td class="' + (t.win > 0 ? 'pos' : 'neg') + '"><b>' + (t.win > 0 ? '+' : '') + fmt(t.win) + '</b></td><td>' + t.series_wins + '</td><td>' + Math.round(t.pos_days / t.days * 100) + '%</td></tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }

  function pMetrics() {
    var h = '<h1>Метрики</h1><p class="sub">Базовые показатели из концепта: как реализуется стек, проклятие чиплидера, камбеки. Считаются по турнирам, где известны финальные стеки (' + stackTs.length + ' из ' + T.length + ').</p>' + filterBar();
    h += '<h2>1. Проклятие чиплидера</h2><div class="tw"><table class="mt1"><thead><tr><th class="l">Турнир</th><th class="l">Чиплидер по стеку</th><th>Его место</th><th class="l">Победитель</th><th>Ранг стека победителя' + tip('Каким по размеру стека стартовал победитель: 1 — самым большим') + '</th><th>Ср. место топ-3 стеков' + tip('Среднее итоговое место трёх крупнейших стеков') + '</th></tr></thead><tbody>';
    stackTs.forEach(function (t) { h += '<tr><td class="l"><a class="pl" href="#tournaments/' + t.id + '">' + esc(t.short) + '</a></td><td class="l">' + link(t.chip_leader.name) + '</td><td class="' + (t.chip_leader.place === 1 ? 'pos' : '') + '">' + t.chip_leader.place + '</td><td class="l">' + link(t.winner.name) + '</td><td>' + t.winner.stack_rank + '</td><td>' + f1(t.top3_stack_avg_place) + '</td></tr>'; });
    h += '</tbody></table></div>';
    h += '<h2>2. Конвертация стеков</h2><p class="note">Игроки разбиты на четверти по рангу стека внутри своего турнира.</p><div class="tw"><table><thead><tr>' + (MOB ? '<th class="l">Стек</th><th>Игр</th><th>Ср. место</th><th>Ф. стол</th><th>Топ-3</th>' : '<th class="l">Четверть по стеку</th><th>Выступлений</th><th>Ср. итоговое место, % поля</th><th>Дошли до финального стола</th><th>В топ-3</th>') + '</tr></thead><tbody>';
    ['Крупнейшие стеки', 'Выше среднего', 'Ниже среднего', 'Короткие стеки'].forEach(function (nm, i) {
      var a = ES.filter(function (e) { return e.q === i; });
      h += '<tr><td class="l">' + nm + '</td><td>' + a.length + '</td><td>' + Math.round(mean(a.map(function (e) { return e.place / e.n; })) * 100) + '%</td><td>' + Math.round(a.filter(function (e) { return e.place <= 9; }).length / a.length * 100) + '%</td><td>' + Math.round(a.filter(function (e) { return e.place <= 3; }).length / a.length * 100) + '%</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<h2>3. Лучшие камбеки</h2><p class="note">Стек ниже медианы, итог — финальный стол. Сортировка по Δ мест (в % поля).</p>' + eList(topBy(comebacks, 'rel', 10), true);
    h += '<h2>4. Потеря преимущества</h2><p class="note">Начинали финал в тройке крупнейших стеков. Сортировка по тому, сколько мест потеряно (в % поля).</p>' + eList(topBy(chokes, 'rel', 10, true), false);
    h += '<h2>5. Сила отборочных дней</h2><p class="note">В этой системе дни идут один за другим, поэтому сравниваем не «стартовые дни», а «насколько сложен день»: сколько игроков и как часто брали добор.</p>' + daysTable();
    h += '<h2>6. Эффективность игроков</h2><p class="note">Средний Δ мест по всем финалам (минимум 3 финала): кто стабильно обыгрывает свой стек.</p>';
    var eff = PS.filter(function (s) { return s.ent.length >= 3; }).map(function (s) { return { label: disp(s.name), v: mean(s.ent.map(function (e) { return e.rel; })) * 100, txt: sgn(Math.round(mean(s.ent.map(function (e) { return e.rel; })) * 100)) + '% (' + s.ent.length + ')' }; }).sort(function (a, b) { return b.v - a.v; });
    var shown = eff.length <= 14 ? eff : eff.slice(0, 7).concat(eff.slice(-7));
    h += '<div class="chart">' + hbars(shown, { diverge: true }) + '</div>' + capEff(eff) + '<div class="legend"><span>Скобки — число финалов со стеками. Положительное — игрок в среднем финиширует выше, чем стартовал.</span></div>';
    return h;
  }
  function eList(arr, good) {
    return '<div class="cardlist">' + arr.map(function (e, i) {
      return '<div class="card rank"><div class="n">' + (i + 1) + '</div><div><h3><span class="nm">' + link(e.name) + '</span> <span class="tag">' + esc(e.t.short) + (e.t.nonstandard ? ' ⚠' : '') + '</span></h3><p style="margin:0">стек №' + e.rank + ' из ' + e.n + ' → место ' + e.place + ' <span class="' + (good ? 'pos' : 'neg') + '">(' + sgn(e.delta) + ')</span> · ' + fmt(e.stack) + ' фишек</p></div></div>';
    }).join('') + '</div>';
  }
  function daysTable() {
    var h = '<div class="tw"><table><thead><tr><th class="l">Турнир</th>' + [1, 2, 3, 4].map(function (i) { return MOB ? '<th>Д' + i + '</th>' : '<th>День ' + i + ': игроков / добор</th>'; }).join('') + '</tr></thead><tbody>';
    T.forEach(function (t) { h += '<tr><td class="l">' + esc(t.short) + '</td>' + [0, 1, 2, 3].map(function (i) { var d = t.days[i]; return '<td>' + (d ? d.players + ' / ' + (d.addon_rate == null ? '—' : Math.round(d.addon_rate * 100) + '%') : '—') + '</td>'; }).join('') + '</tr>'; });
    return h + '</tbody></table></div>';
  }

  function pFun() {
    function top(arr, fn, n) { return arr.filter(fn.f).sort(fn.s).slice(0, n || 3); }
    var h = '<h1>Номинации</h1><p class="sub">Неформальные звания из концепта. Звания выдаются только при достаточном числе финалов (минимум 3), иначе шум решает больше, чем игра. «Глубокие проходы» смотрите на вкладке «Карта».</p>' + filterBar() + '<div class="cardlist">';
    function awards(title, note, list, text) {
      h += '<div class="card"><h3>' + title + '</h3><p class="note" style="margin:0 0 6px">' + note + '</p>' + (list.length ? list.map(function (s, i) { return '<div class="rank"><div class="n">' + (i + 1) + '</div><div style="padding-top:3px">' + link(s.name) + ' — ' + text(s) + '</div></div>'; }).join('') : '<p class="note">Пока недостаточно данных.</p>') + '</div>';
    }
    var kings = AW.kings;
    awards('Король камбеков', 'Лучший средний прирост мест при коротких стеках (минимум 3 таких финала).', kings, function (s) { return '+' + Math.round(s.shortAvgRel * 100) + '% поля в среднем, ' + s.shortN + ' финал(а) с коротким стеком'; });
    var losers = AW.losers;
    awards('Главный чиплидер-неудачник', 'Чаще всего стартует в тройке крупнейших стеков и не доезжает до призов (минимум 3 таких финала).', losers, function (s) { return s.topFail + ' из ' + s.topN + ' раз вне топ-3'; });
    var stable = AW.stable;
    awards('Человек-стабильность', 'Самый ровный результат: минимальный разброс мест (минимум 3 финала).', stable, function (s) { return 'разброс ' + f1(s.p.sd_place) + ', среднее место ' + f1(s.p.avg_place) + ' (' + s.p.finals + ' финал.)'; });
    var coaster = AW.coaster;
    awards('Американские горки', 'Самые разные результаты: максимальный разброс мест.', coaster, function (s) { return 'разброс ' + f1(s.p.sd_place) + ', места ' + s.p.places.join(', '); });
    return h + '</div>';
  }

  /* ---------- подписи «что видно» ---------- */
  function cap(t) { return t ? '<p class="cap">💡 ' + t + '</p>' : ''; }
  function capScatter() {
    var wins = ES.filter(function (e) { return e.place === 1; }); if (!wins.length) return '';
    var top = wins.filter(function (e) { return e.q === 0; }).length, low = wins.filter(function (e) { return e.q >= 2; }).length;
    var lead = ES.filter(function (e) { return e.rank === 1 && e.place === 1; }).length;
    return cap('Победитель стартовал из верхней четверти стеков в ' + top + ' из ' + wins.length + ' финалов, из нижней половины — в ' + low + '. Чиплидер побеждал ' + lead + ' раз(а).');
  }
  function capDumb(t) {
    var rs = t.rows.filter(function (r) { return r.delta != null; }); if (rs.length < 4) return '';
    var up = rs.slice().sort(function (x, y) { return y.delta - x.delta; })[0], dn = rs.slice().sort(function (x, y) { return x.delta - y.delta; })[0];
    return cap('Сильнее всего обыграл стек ' + esc(disp(up.name)) + ' (' + up.stack_rank + '-й стек → ' + up.place + '-е место, ' + sgn(up.delta) + '), сильнее всего потерял ' + esc(disp(dn.name)) + ' (' + dn.stack_rank + '-й → ' + dn.place + '-е, ' + sgn(dn.delta) + ').' + (t.corr != null ? ' Связь стека и места: ' + f1(t.corr) + ' (1 — стек решает всё, 0 — не решает).' : ''));
  }
  function capRating(p) {
    var s = p.series; if (!s || s.length < 3) return '';
    var best = null; s.forEach(function (z, i) { var g = z.rating - (i ? s[i - 1].rating : 0); if (!best || g > best.g) best = { g: g, e: z.e }; });
    var ev = D.events[best.e] || { label: 'событие ' + best.e }, last = s[s.length - 1];
    return cap('Рейтинг ' + last.rating + (p.rating_rank ? ' (#' + p.rating_rank + ')' : '') + '. Самый большой скачок — ' + esc(ev.label) + ' (+' + best.g + ').');
  }
  function capCompare(a, b, pa, pb) {
    var A = {}, B = {}; (pa.series || []).forEach(function (z) { A[z.e] = z.rating; }); (pb.series || []).forEach(function (z) { B[z.e] = z.rating; });
    var ra = 0, rb = 0, lead = null, since = null;
    for (var e = 1; e <= 99; e++) { if (A[e] != null) ra = A[e]; if (B[e] != null) rb = B[e]; var l = ra === rb ? lead : (ra > rb ? 'a' : 'b'); if (l !== lead) { lead = l; since = e; } }
    if (!lead) return '';
    var ev = D.events[since] || { label: 'событие ' + since };
    return cap('Сейчас впереди ' + esc(disp(lead === 'a' ? a : b)) + ' (разница ' + Math.abs(ra - rb) + '), лидирует с события «' + esc(ev.label) + '».');
  }
  function capHeat(rows) {
    var r3 = rows.filter(function (p) { return p.finals >= 3; }); if (!r3.length) return '';
    var best = r3.slice().sort(function (x, y) { return x.avg_place - y.avg_place; })[0], gold = rows.slice().sort(function (x, y) { return y.wins - x.wins; })[0];
    return cap('Лучшее среднее место (от 3 финалов) — ' + esc(disp(best.name)) + ' (' + f1(best.avg_place) + '); больше всего побед — ' + esc(disp(gold.name)) + ' (' + gold.wins + ').');
  }
  function capEff(eff) {
    if (eff.length < 2) return '';
    return cap('В среднем лучше всех обыгрывает стек ' + esc(eff[0].label) + ' (' + esc(eff[0].txt) + '), хуже всех — ' + esc(eff[eff.length - 1].label) + ' (' + esc(eff[eff.length - 1].txt) + ').');
  }

  /* ---------- охота за головами ---------- */
  var huntAll = false;
  function pHunt(id) {
    var hts = T.filter(function (t) { return t.hunt; });
    if (!hts.length) return '<h1>Охота</h1><p class="note">Нет данных об охоте.</p>';
    var t = hts.filter(function (x) { return x.id === id; })[0] || hts[hts.length - 1], hu = t.hunt;
    var place = {}; t.rows.forEach(function (r) { place[r.name] = r.place; });
    var hs = hu.hunters.filter(function (x) { return huntAll || x.finalist; });
    var best = hu.hunters.reduce(function (m, x) { return x.best > m.best ? x : m; }, hu.hunters[0]);
    var h = '<h1>Охота за головами</h1><p class="sub">Нокауты и цена за голову. Данные есть только по турнирам, где организаторы вели таблицу охоты.</p>';
    h += '<div class="chips">' + hts.map(function (x) { return '<button class="chip hnt' + (x.id === t.id ? ' on' : '') + '" data-id="' + x.id + '">' + esc(x.short) + '</button>'; }).join('') + '</div>';
    h += '<label class="tog"><input type="checkbox" id="hall"' + (huntAll ? ' checked' : '') + '> показывать и тех, кто не вышел в финал</label>';
    h += '<div class="grid g4">' + kpi(hu.total_ko, 'нокаутов за турнир') + kpi(fmt(Math.round(hu.total_sum / hu.total_ko)), 'средняя цена нокаута') + kpi(esc(disp(hu.hunters[0].name)), 'охотник №1: ' + hu.hunters[0].count + ' нокаутов') + kpi(fmt(best.best), 'самый дорогой нокаут — ' + esc(disp(best.name))) + '</div>';
    h += '<h2>Лучшие охотники</h2><div class="chart">' + hbars(hs.slice(0, 10).map(function (x) { return { label: disp(x.name), v: x.count, txt: x.count + ' · ср. ' + x.avg, color: x.finalist ? 'var(--green)' : 'var(--mute)' }; })) + '</div>';
    h += cap('Охотник №1 — ' + esc(disp(hu.hunters[0].name)) + ': ' + hu.hunters[0].count + ' нокаутов на ' + fmt(hu.hunters[0].sum) + ' фишек. Выше всех средняя цена нокаута (от 3 выбитых) — ' + esc(disp(hu.hunters.filter(function (x) { return x.count >= 3; }).sort(function (x, y) { return y.avg - x.avg; })[0].name)) + '.');
    h += '<h2>Все охотники</h2><div class="tw tall"><table class="ht"><thead><tr><th>№</th><th class="l">Игрок</th><th>' + (MOB ? 'Нок.' : 'Нокаутов') + '</th><th>Сумма</th><th>' + (MOB ? 'Ср.' : 'Ср. цена') + '</th><th>Лучший</th><th>' + (MOB ? 'Место' : 'Место в финале') + '</th></tr></thead><tbody>' +
      hs.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td><td class="l">' + link(x.name) + '</td><td>' + x.count + '</td><td>' + fmt(x.sum) + '</td><td>' + x.avg + '</td><td>' + fmt(x.best) + '</td><td>' + (place[x.name] || '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var bn = hu.bounty.filter(function (x) { return huntAll || x.finalist; }).slice(0, 8);
    h += '<h2>Самые дорогие головы</h2><p class="note">Максимальная цена за голову игрока в ходе турнира.</p><div class="chart">' + hbars(bn.map(function (x) { return { label: disp(x.name), v: x.price, txt: fmt(x.price), color: x.finalist ? 'var(--gold)' : 'var(--mute)' }; })) + '</div>';
    if (hu.busts && hu.busts.length) {
      h += '<h2>Чаще всех выбывали</h2><p class="note">Сколько раз игрок терял стек и добор за отборочные дни.</p><div class="chart">' + hbars(hu.busts.filter(function (x) { return huntAll || place[x.name]; }).slice(0, 8).map(function (x) { return { label: disp(x.name), v: x.n, txt: String(x.n), color: 'var(--bad)' }; })) + '</div>';
    }
    return h + '<p class="note">Зелёные столбцы — финалисты, серые — не вышедшие в финал.</p>';
  }

  /* ---------- «О данных»: проверки ---------- */
  function pData() {
    var h = '<h1>О данных</h1><p class="sub">Как собираются цифры и что стоит проверить.</p><div class="cardlist">';
    h += ins('', 'Откуда данные', 'Таблицы турниров 2026 года (лист «Главная») дают результаты отборочных дней и финальный стек. Итоговые места в финалах восстановлены из очков рейтинга по формуле очки = √(N·K)/√место, поэтому место = (максимум очков / очки)². Рейтинг игрока — сумма ' + D.rating_top + ' лучших результатов.');
    h += ins('', 'Стартовый стек финала', 'Итог отборочных (по таблице) + базовый бонус (3 000, для 3-7 и 3-8 — 3 800) + трофеи за охоту, если они считаются отдельно (А-2, 3-8). Номинации не учитываются. Ранг стека — место по размеру стека среди финалистов (1 — самый большой).');
    h += ins('', 'Финалы 2025 года', 'Стеки и места восстановлены вручную по картинкам таблиц из чата клуба и по истории сайта результатов (Дойль Брансон, Тощий Джек). У однодневных турниров (Туз Весны, Сателлит, Финал финалистов) есть только места. Возможны опечатки и разные написания ников.');
    h += ins('', 'Δ мест', 'Ранг по стеку минус итоговое место. Плюс — игрок финишировал выше, чем стартовал; минус — ниже.');
    h += '</div><h2>Проверка данных</h2>';
    var lv = { warn: ['Проверить', 'bad'], info: ['Заметка', ''] }, ch = (D.checks || []).slice().sort(function (x, y) { return (x.level === 'warn' ? 0 : 1) - (y.level === 'warn' ? 0 : 1); });
    h += '<div class="cardlist">' + ch.map(function (c) { var l = lv[c.level] || lv.info; return '<div class="card insight ' + l[1] + '"><h3>' + l[0] + '</h3><p>' + esc(c.text) + '</p></div>'; }).join('') + '</div>';
    h += '<h2>Как обновлять сайт</h2><div class="card"><ol><li>Положите таблицу нового турнира в папку <code>2026/…</code> и обновите <code>Данные/Рейтинг ЦИФЕРБЛАТ.xlsx</code>.</li><li>Добавьте запись о турнире в список <code>TOURNAMENTS</code> в <code>site/build_data.py</code>.</li><li>Если один человек записан по-разному — добавьте пару в <code>ALIASES</code>; красивые имена — в <code>site/names.json</code>.</li><li>Запустите <code>python build_data.py</code> в папке <code>site</code> и посмотрите вкладку «О данных» — там появятся новые замечания.</li></ol><p class="note">Межсезонку и рейтинг после неё можно обновить без Excel: <code>python update_site.py</code>. После публикации на GitHub то же делает автозапуск (<code>.github/workflows/update.yml</code>, раз в сутки).</p></div>';
    return h;
  }

  /* ---------- поиск игрока и последние турниры ---------- */
  function recentTournaments() {
    var last = TA.slice(-3).reverse();
    return '<h2>Последние турниры</h2><div class="grid g2">' + last.map(function (t) {
      var r = t.top || t.rows;
      return '<div class="card"><h3><a class="pl" href="#tournaments/' + t.id + '">' + esc(t.title) + '</a> <span class="tag">' + esc(t.final_date || '') + '</span></h3><p style="margin:2px 0 6px">🥇 ' + link(r[0].name) + ' · 🥈 ' + link(r[1].name) + ' · 🥉 ' + link(r[2].name) + '</p><p class="note" style="margin:0">' + t.finalists + ' финалистов · <a href="#report/' + t.id + '">автоотчёт</a></p></div>';
    }).join('') + '</div>';
  }
  function setupChrome() {
    var more = document.getElementById('more'), mb = document.getElementById('morebtn');
    if (mb) {
      mb.addEventListener('click', function (e) { e.stopPropagation(); openFilter(false); var v = !more.classList.contains('open'); more.classList.toggle('open', v); mb.setAttribute('aria-expanded', v ? 'true' : 'false'); });
      document.addEventListener('click', function (e) { if (!e.target.closest('#more')) { more.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); } });
      window.addEventListener('hashchange', function () { more.classList.remove('open'); });
    }
    var fb = document.getElementById('fbtn'); if (fb) fb.addEventListener('click', function (e) { e.stopPropagation(); openFilter(); });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-open="f"]')) { openFilter(true); window.scrollTo(0, 0); return; }
      if (e.target.id === 'fclose') { openFilter(false); return; }
      if (!e.target.closest('#fpanel') && !e.target.closest('#fbtn')) openFilter(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openFilter(false); });
    var tb = document.getElementById('tbtn');
    function paint() { var th = document.documentElement.dataset.theme; if (tb) tb.textContent = th === 'light' ? '🌙' : '☀'; }
    if (tb) tb.addEventListener('click', function () { var n = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = n; try { localStorage.setItem('np_theme', n); } catch (e) {} paint(); });
    paint();
    var ft = document.getElementById('foot'); if (ft && D.generated) { var cs0 = D.checks_summary || {}; ft.innerHTML = 'Данные обновлены ' + esc(D.generated) + '. Места в финалах восстановлены из очков рейтинга. ' + (cs0.warn ? '<a href="#data">Замечаний к проверке: ' + cs0.warn + '</a>' : 'Проверки данных пройдены.'); }
  }
  function setupBurger() {
    var btn = document.getElementById('burger'), top = document.querySelector('.top'); if (!btn) return;
    function set(v) { top.classList.toggle('menu-open', v); btn.setAttribute('aria-expanded', v ? 'true' : 'false'); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); set(!top.classList.contains('menu-open')); });
    document.getElementById('nav').addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.top')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    window.addEventListener('hashchange', function () { set(false); });
  }
  function setupSearch() {
    var inp = document.getElementById('gs'), box = document.getElementById('gsr'); if (!inp) return;
    function find(q) { q = q.trim().toLowerCase(); if (!q) return []; return Object.keys(PA).filter(function (n) { return (n + ' ' + disp(n)).toLowerCase().indexOf(q) >= 0; }).sort(function (x, y) { return PA[y].finals - PA[x].finals; }).slice(0, 8); }
    function show() { var r = find(inp.value); box.innerHTML = r.map(function (n) { return '<a href="#players/' + encodeURIComponent(n) + '">' + avatar(n, 'sm') + '<span>' + esc(disp(n)) + '</span> <span class="note">' + PA[n].finals + ' фин.</span></a>'; }).join('') || (inp.value.trim() ? '<span class="note" style="padding:8px 12px;display:block">Никого не найдено</span>' : ''); box.hidden = !box.innerHTML; }
    inp.addEventListener('input', show); inp.addEventListener('focus', show);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var r = find(inp.value); if (r[0]) { location.hash = '#players/' + encodeURIComponent(r[0]); inp.value = ''; box.hidden = true; inp.blur(); } } if (e.key === 'Escape') { box.hidden = true; inp.blur(); } });
    box.addEventListener('click', function () { setTimeout(function () { inp.value = ''; box.hidden = true; }, 0); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.gs')) box.hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') { e.preventDefault(); inp.focus(); } });
  }

  /* ---------- общие помощники для страниц «Зал славы», «Рейтинг», профиля ---------- */
  var parseD = function (s) { var m = String(s || '').match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
  var dshort = function (d) { return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2); };
  var podiumOf = function (t) { return (t.top || t.rows || []).filter(function (x) { return x.place <= 3; }).sort(function (a, b) { return a.place - b.place; }); };
  var median = function (a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  var interTitle = function (s) { return s.title.replace('Межсезонка, ', ''); };
  function allPlayers() { return Object.keys(PA).map(function (k) { return PA[k]; }); }
  function eventLabel(e) { var ev = D.events[e]; return ev ? ev.label : 'Событие ' + e; }

  /* ---------- рейтинг: какие результаты в зачёте ---------- */
  function ratingInfo(name) {
    var p = PA[name], s = (p.series || []).filter(function (z) { return z.pts > 0; }), K = D.rating_top;
    var idx = s.map(function (z, i) { return i; }).sort(function (a, b) { return s[b].pts - s[a].pts || a - b; });
    var counted = {}; idx.slice(0, K).forEach(function (i) { counted[i] = 1; });
    var full = idx.length >= K;
    return { s: s, idx: idx, counted: counted, full: full, min: full ? s[idx[K - 1]].pts : 0, nextOut: idx.length > K ? s[idx[K]].pts : null, n: s.length };
  }
  function ratingList() { return allPlayers().filter(function (p) { return p.rating_now; }).sort(function (a, b) { return b.rating_now - a.rating_now; }); }
  var rq = '';
  function pRating(name) {
    var list = ratingList(), K = D.rating_top;
    if (name && PA[name] && PA[name].rating_now) return pRatingOne(name, list);
    var mx = list[0].rating_now, thr = median(list.filter(function (p) { return ratingInfo(p.name).full; }).map(function (p) { return ratingInfo(p.name).min; }));
    var h = '<h1>Рейтинг клуба</h1><p class="sub">Рейтинг — сумма ' + K + ' лучших результатов за всё время (финалы, отборочные дни и межсезонки). Нажмите на игрока, чтобы увидеть, какие результаты идут в зачёт и сколько не хватает до соседей.</p>';
    h += '<div class="grid g4">' + kpi(list.length, 'игроков в рейтинге') + kpi(esc(disp(list[0].name)), 'лидер: ' + list[0].rating_now + ' очков') + kpi(list[0].rating_now - list[1].rating_now, 'отрыв лидера от второго места') + kpi(thr == null ? '—' : f1(thr), 'типичный «порог» зачёта' + tip('Медианное значение 12-го лучшего результата: именно столько очков надо набрать, чтобы новый результат стал зачётным')) + '</div>';
    h += '<div class="srch"><input id="rq" type="search" placeholder="Найти игрока в рейтинге" value="' + esc(rq) + '" autocomplete="off"></div>';
    var rows = list.map(function (p, i) { return { p: p, i: i }; }).filter(function (x) { return !rq || (x.p.name + ' ' + disp(x.p.name)).toLowerCase().indexOf(rq.toLowerCase()) >= 0; });
    h += '<div class="tw tall"><table class="dtab rkt"><thead><tr><th>№</th><th class="l">Игрок</th><th>' + (MOB ? 'Очки' : 'Рейтинг') + '</th><th>' + (MOB ? 'До выше' : 'До соседа выше') + '</th><th>' + (MOB ? 'Зачёт' : 'В зачёте') + '</th><th>' + (MOB ? 'Порог' : 'Порог зачёта') + tip('Очки самого слабого из зачётных результатов. Новый результат выше порога вытеснит его.') + '</th></tr></thead><tbody>';
    rows.forEach(function (x) {
      var p = x.p, ri = ratingInfo(p.name), up = x.i ? list[x.i - 1].rating_now - p.rating_now : null;
      h += '<tr><td>' + (x.i + 1) + '</td><td class="l"><a class="pl pa" href="#rating/' + encodeURIComponent(p.name) + '">' + avatar(p.name, 'sm') + '<span>' + esc(disp(p.name)) + '</span></a></td><td><b>' + p.rating_now + '</b></td><td class="mu2">' + (up == null ? '—' : '−' + up) + '</td><td>' + Math.min(ri.n, K) + '/' + K + '</td><td>' + (ri.full ? ri.min : '—') + '</td></tr>';
    });
    if (!rows.length) h += '<tr><td colspan="6" class="note">Никого не найдено</td></tr>';
    return h + '</tbody></table></div><p class="note">«До соседа выше» — сколько очков не хватает, чтобы обогнать игрока строкой выше. Если в зачёте меньше ' + K + ' результатов, порога нет: каждый новый результат прибавляется целиком.</p>';
  }
  function pRatingOne(name, list) {
    var p = PA[name], ri = ratingInfo(name), K = D.rating_top, pos = list.indexOf(p), up = list[pos - 1], dn = list[pos + 1];
    var h = '<p><a href="#rating">← весь рейтинг</a> · <a href="#players/' + encodeURIComponent(name) + '">профиль игрока</a></p><h1 class="ph">' + avatar(name, 'lg') + '<span>' + esc(disp(name)) + '</span></h1>';
    h += '<p class="sub">Рейтинг <b>' + p.rating_now + '</b> · ' + (pos + 1) + '-е место из ' + list.length + ' · результатов с очками: ' + ri.n + (ri.n > K ? ' (в зачёте ' + K + ' лучших)' : '') + '</p>';
    function need(gap, who, sign) {
      var x = ri.full ? gap + ri.min : gap;
      return '<div class="card"><h3>' + sign + ' ' + link(who.name) + ' <span class="tag">' + who.rating_now + '</span></h3><p style="margin:2px 0 0">' + (gap > 0 ? (sign === '▲' ? 'Не хватает <b>' + gap + '</b> оч. Один новый результат обгонит, если он будет не меньше <b>' + x + '</b> оч.' : 'Отрыв <b>' + gap + '</b> оч.') : 'Очки равны.') + '</p></div>';
    }
    h += '<div class="grid g2">' + (up ? need(up.rating_now - p.rating_now + 1, up, '▲') : '<div class="card"><h3>👑 Лидер рейтинга</h3><p style="margin:2px 0 0">' + (dn ? 'Отрыв от второго места: <b>' + (p.rating_now - dn.rating_now) + '</b> оч.' : '') + '</p></div>') + (dn ? need(p.rating_now - dn.rating_now, dn, '▼') : '') + '</div>';
    if (ri.full) h += cap('Порог зачёта — <b>' + ri.min + '</b> оч.: любой новый результат выше него вытеснит самый слабый из зачётных и прибавит разницу к рейтингу' + (ri.nextOut != null ? '. Сейчас первым «за бортом» стоит результат в ' + ri.nextOut + ' оч.' : '.'));
    h += whatIfBlock(name);
    h += '<h2>Рейтинг по событиям</h2><div class="chart">' + ratingChart(p) + '</div>';
    h += '<h2>Результаты игрока</h2><p class="note">Подсвечены результаты, которые входят в рейтинг (' + K + ' лучших).</p><div class="tw tall"><table class="dtab rkt"><thead><tr><th>№</th><th class="l">Событие</th><th>Очки</th><th>Статус</th></tr></thead><tbody>';
    ri.idx.forEach(function (i, k) { var z = ri.s[i]; h += '<tr class="' + (ri.counted[i] ? 'in' : 'out') + '"><td>' + (k + 1) + '</td><td class="l">' + esc(eventLabel(z.e)) + '</td><td><b>' + z.pts + '</b></td><td>' + (ri.counted[i] ? '✓ в зачёте' : '— не в зачёте') + '</td></tr>'; });
    return h + '</tbody></table></div>';
  }

  /* ---------- зал славы ---------- */
  function pFame() {
    var players = allPlayers(), h = '<h1>Зал славы</h1><p class="sub">Чемпионы всех турниров в базе (' + T.length + ') и рекорды клуба. Страница не зависит от фильтра периода.</p>';
    var champs = players.filter(function (p) { return p.wins > 0; }).sort(function (a, b) { return b.wins - a.wins || b.podiums - a.podiums || a.avg_place - b.avg_place; });
    var wonBy = {}; T.forEach(function (t) { var w = podiumOf(t)[0]; if (w && w.place === 1) (wonBy[w.name] = wonBy[w.name] || []).push(t); });
    var multi = champs.filter(function (p) { return p.wins > 1; }), single = champs.filter(function (p) { return p.wins === 1; });
    h += '<h2>Самые титулованные</h2><div class="grid g2">' + multi.map(function (p, i) {
      return '<div class="card hof"><div class="hn">' + p.wins + '<small>🏆</small></div><div class="hb"><h3>' + plink(p.name, 'sm') + '</h3><p class="note" style="margin:2px 0 4px">призовых мест: ' + p.podiums + ' из ' + p.finals + ' финалов</p><div class="wchips">' + (wonBy[p.name] || []).map(function (t) { return '<a class="tag" href="#tournaments/' + t.id + '">' + esc(lab(t)) + '</a>'; }).join('') + '</div></div></div>';
    }).join('') + '</div>';
    h += '<p class="note" style="margin-top:12px">С одной победой (' + single.length + '): ' + single.map(function (p) { return link(p.name); }).join(', ') + '.</p>';
    /* рекорды */
    var recs = [], rec = function (ico, title, who, val, note) { recs.push('<div class="card rec"><span class="ri">' + ico + '</span><div><h3>' + title + '</h3><div class="rw">' + who + '</div><div class="rv">' + val + '</div>' + (note ? '<p class="note" style="margin:2px 0 0">' + note + '</p>' : '') + '</div></div>'); };
    var by = function (f, asc) { return players.filter(function (p) { return f(p) != null; }).sort(function (a, b) { return asc ? f(a) - f(b) : f(b) - f(a); })[0]; };
    var pm = by(function (p) { return p.podiums; }); if (pm) rec('🥇', 'Больше всего призовых мест', plink(pm.name, 'sm'), pm.podiums, 'из ' + pm.finals + ' финалов');
    var fm = by(function (p) { return p.finals; }); if (fm) rec('🎟', 'Больше всего финалов', plink(fm.name, 'sm'), fm.finals, 'выходов в финал, из них ' + fm.table + ' на финальный стол');
    var tm = by(function (p) { return p.table; }); if (tm) rec('🃏', 'Больше всего финальных столов', plink(tm.name, 'sm'), tm.table, 'топ-9 в финале');
    var ba = by(function (p) { return p.finals >= 5 ? p.avg_place : null; }, true); if (ba) rec('🎯', 'Лучшее среднее место', plink(ba.name, 'sm'), f1(ba.avg_place), 'в ' + ba.finals + ' финалах (от 5)');
    var full = T.filter(function (t) { return t.finalists >= 9; }), best = null;
    players.forEach(function (p) { var m = {}; p.list.forEach(function (l) { m[l.t] = l.place; }); var cur = 0; full.forEach(function (t) { if (m[t.id] != null && m[t.id] <= 9) { cur++; if (!best || cur > best.n) best = { p: p, n: cur, end: t }; } else cur = 0; }); });
    if (best) rec('🔥', 'Серия финальных столов подряд', plink(best.p.name, 'sm'), best.n, 'турниров подряд (серия дошла до «' + esc(lab(best.end)) + '»)');
    var lw = CA.ES.filter(function (e) { return e.place === 1; }).sort(function (a, b) { return b.rank - a.rank || b.n - a.n; })[0];
    if (lw) rec('🧗', 'Победа с самого короткого стека', plink(lw.name, 'sm'), '№' + lw.rank + ' из ' + lw.n, esc(lw.t.short) + ' · стартовал ' + lw.rank + '-м, финишировал первым');
    var cb = CA.ES.slice().sort(function (a, b) { return b.delta - a.delta; })[0];
    if (cb) rec('🚀', 'Самый большой камбек', plink(cb.name, 'sm'), '+' + cb.delta + ' мест', esc(cb.t.short) + ' · с ' + cb.rank + '-го по стеку на ' + cb.place + '-е место');
    var cs = CA.ES.slice().sort(function (a, b) { return a.delta - b.delta; })[0];
    if (cs) rec('📉', 'Самое большое падение', plink(cs.name, 'sm'), cs.delta + ' мест', esc(cs.t.short) + ' · со ' + cs.rank + '-го по стеку на ' + cs.place + '-е место');
    var bf = T.filter(function (t) { return podiumOf(t)[0]; }).sort(function (a, b) { return b.finalists - a.finalists; })[0];
    if (bf) rec('👥', 'Самый многолюдный финал', plink(podiumOf(bf)[0].name, 'sm'), bf.finalists, 'финалистов · победитель «' + esc(bf.title) + '»');
    var rl = ratingList()[0]; if (rl) rec('📈', 'Лидер рейтинга сейчас', plink(rl.name, 'sm'), rl.rating_now, 'очков, сумма ' + D.rating_top + ' лучших результатов');
    var bp = null; players.forEach(function (p) { (p.series || []).forEach(function (z) { if (!bp || z.pts > bp.z.pts) bp = { p: p, z: z }; }); });
    if (bp) rec('💎', 'Самый дорогой результат в рейтинге', plink(bp.p.name, 'sm'), '+' + bp.z.pts, esc(eventLabel(bp.z.e)));
    var ia = IT.alltime || [];
    var im = ia.slice().sort(function (a, b) { return b.win - a.win; })[0]; if (im) rec('🎰', 'Больше всех выиграл на межсезонках', plink(im.name, 'sm'), fmt(im.win), 'фишек за всё время, серий сыграно: ' + im.series);
    var id = ia.slice().sort(function (a, b) { return b.best - a.best; })[0]; if (id) rec('⚡', 'Лучший день межсезонки', plink(id.name, 'sm'), '+' + fmt(id.best), 'фишек за один день');
    var iw = ia.slice().sort(function (a, b) { return b.series_wins - a.series_wins || b.win - a.win; })[0]; if (iw && iw.series_wins) rec('🏁', 'Больше всех выигранных серий', plink(iw.name, 'sm'), iw.series_wins, 'серий межсезонки с первым местом в зачёте');
    h += '<h2>Рекорды клуба</h2><div class="grid g2 recs">' + recs.join('') + '</div>';
    h += '<h2>Чемпионы по турнирам</h2><div class="tw"><table class="dtab chm"><thead><tr><th class="l">Турнир</th><th>Дата</th><th class="l">Чемпион</th><th class="l">' + (MOB ? '2–3' : 'Серебро и бронза') + '</th></tr></thead><tbody>';
    T.slice().reverse().forEach(function (t) { var pd = podiumOf(t); if (!pd.length) return; h += '<tr><td class="l"><a class="pl" href="#tournaments/' + t.id + '">' + esc(lab(t)) + '</a>' + (t.nonstandard ? ' ⚠' : '') + '</td><td>' + esc(t.final_date || '') + '</td><td class="l">🥇 ' + link(pd[0].name) + '</td><td class="l">' + pd.slice(1).map(function (r) { return (r.place === 2 ? '🥈 ' : '🥉 ') + link(r.name); }).join(' · ') + '</td></tr>'; });
    return h + '</tbody></table></div>';
  }

  /* ---------- лента событий на главной ---------- */
  function evDate(e) {
    var ev = D.events[e]; if (!ev) return null;
    if (ev.tid) { var t = T.filter(function (x) { return x.id === ev.tid; })[0]; return ev.kind === 'final' && t ? parseD(t.final_date) : null; }
    var m = /день (\d+)/.exec(ev.label), cs = IT.series.filter(function (s) { return s.status === 'идёт'; })[0];
    if (m && cs && ev.kind === 'inter') { var d = cs.days.filter(function (x) { return x.n === +m[1]; })[0]; return d ? parseD(d.date) : null; }
    return null;
  }
  function feed() {
    var it = [];
    T.slice(-4).forEach(function (t) {
      var pd = podiumOf(t), d = parseD(t.final_date); if (!pd.length || !d) return;
      it.push({ d: d, ico: '🏆', h: link(pd[0].name) + ' выиграл «' + esc(t.title) + '»' + (pd[1] ? ' · серебро — ' + link(pd[1].name) : '') + ' <a href="#tournaments/' + t.id + '">результаты</a>' });
    });
    IT.series.slice(-2).forEach(function (s) {
      s.days.forEach(function (day) {
        var d = parseD(day.date); if (!d || !day.players.length) return;
        var b = day.players.slice().sort(function (x, y) { return y.win - x.win; })[0];
        it.push({ d: d, ico: '🃏', h: esc(interTitle(s)) + ', день ' + day.n + ': лучший — ' + link(b.name) + ' (' + sgn(b.win) + ' фишек) <a href="#inter/' + s.id + '">зачёт</a>' });
      });
    });
    var lead = {}; allPlayers().forEach(function (p) { (p.series || []).forEach(function (z) { if (z.rank === 1) lead[z.e] = p.name; }); });
    var prev = null; Object.keys(lead).map(Number).sort(function (a, b) { return a - b; }).forEach(function (e) {
      if (prev && lead[e] !== prev && e >= 30) { var d = evDate(e); if (d) it.push({ d: d, ico: '👑', h: 'Новый лидер рейтинга — ' + link(lead[e]) + ' (после «' + esc(eventLabel(e)) + '»)' }); }
      prev = lead[e];
    });
    it.sort(function (a, b) { return b.d - a.d; });
    if (!it.length) return '';
    return '<h2>Лента событий</h2><div class="card feed">' + it.slice(0, 6).map(function (x) { return '<div class="fi"><span class="fd">' + dshort(x.d) + '</span><span class="fic">' + x.ico + '</span><div>' + x.h + '</div></div>'; }).join('') + '</div>';
  }

  /* ---------- профиль 2.0: форма, сильные и слабые стороны, межсезонки ---------- */
  function formStrip(p) {
    var l = p.list.slice(-8); if (l.length < 2) return '';
    var cls = function (x) { return x === 1 ? 'pw' : (x <= 3 ? 'pp' : (x <= 9 ? 'pt' : 'pn')); };
    var h = '<h2>Форма</h2><div class="fstrip">' + l.map(function (x) { return '<a class="fchip ' + cls(x.place) + '" href="#tournaments/' + x.t + '" title="' + esc(x.short) + ': ' + x.place + ' место из ' + x.of + '"><b>' + x.place + '</b><small>' + esc(x.short) + '</small></a>'; }).join('') + '</div>';
    var l5 = p.list.slice(-5), a5 = mean(l5.map(function (x) { return x.place; }));
    if (p.finals >= 7) { var diff = p.avg_place - a5; h += cap('В последних ' + l5.length + ' финалах среднее место — <b>' + f1(a5) + '</b> (за всё время ' + f1(p.avg_place) + '): ' + (diff > 2 ? 'игрок в хорошей форме 📈' : (diff < -2 ? 'форма просела 📉' : 'держится на своём уровне')) + '.'); }
    return h + '<div class="legend"><span><i class="fl pw"></i>победа</span><span><i class="fl pp"></i>призы</span><span><i class="fl pt"></i>финальный стол</span><span><i class="fl pn"></i>остальные</span></div>';
  }
  function profileInsights(name) {
    var p = PA[name], st = [], wk = [], ps = allPlayers();
    if (p.finals < 3) return '<h2>Сильные и слабые стороны</h2><p class="note">Нужно минимум 3 финала, чтобы делать выводы без случайных шумов (сейчас ' + p.finals + ').</p>';
    var clubT = ps.reduce(function (a, x) { return a + x.table; }, 0) / ps.reduce(function (a, x) { return a + x.finals; }, 0), tr = p.table / p.finals;
    if (tr >= clubT * 1.25) st.push('Часто доходит до финального стола: <b>' + Math.round(tr * 100) + '%</b> финалов при клубных ' + Math.round(clubT * 100) + '%.');
    else if (tr <= clubT * 0.75) wk.push('Финальный стол — лишь в <b>' + Math.round(tr * 100) + '%</b> финалов (по клубу ' + Math.round(clubT * 100) + '%).');
    if (p.finals && p.podiums / p.finals >= 0.25) st.push('Призовые места в <b>' + p.podiums + '</b> из ' + p.finals + ' финалов.');
    var nd = (p.deltas || []).length;
    if (p.avg_delta != null && nd >= 3) { if (p.avg_delta >= 1.5) st.push('Обыгрывает свой стек: финиширует в среднем на <b>' + f1(p.avg_delta) + '</b> мест выше, чем стартовал.'); else if (p.avg_delta <= -1.5) wk.push('Хуже реализует стек: финиширует в среднем на <b>' + f1(-p.avg_delta) + '</b> мест ниже стартового ранга.'); }
    var sds = ps.filter(function (x) { return x.finals >= 3 && x.sd_place != null; }).map(function (x) { return x.sd_place; }), msd = median(sds);
    if (p.sd_place != null && msd) { if (p.sd_place <= msd * 0.7) st.push('Ровная игра: разброс мест <b>' + f1(p.sd_place) + '</b> (медиана клуба ' + f1(msd) + ').'); else if (p.sd_place >= msd * 1.3) wk.push('Нестабилен: разброс мест <b>' + f1(p.sd_place) + '</b> (медиана клуба ' + f1(msd) + ').'); }
    var ent = CA.ES.filter(function (e) { return e.name === name; });
    var cb = ent.filter(function (e) { return e.rank > e.n / 2 && e.place <= 9; }).length; if (cb) st.push('Камбеки: <b>' + cb + '</b> раз(а) пробивался на финальный стол с коротким стеком.');
    var ch = ent.filter(function (e) { return e.rank <= 3; }), chf = ch.filter(function (e) { return e.place > 3; }).length; if (chf >= 2) wk.push('Из ' + ch.length + ' стартов в тройке крупнейших стеков <b>' + chf + '</b> раз(а) остался без призов.');
    if (p.rating_rank && p.rating_rank <= 5) st.push('В топ-5 рейтинга: <b>#' + p.rating_rank + '</b>, ' + p.rating_now + ' очков.');
    var l5 = p.list.slice(-5); if (p.finals >= 7) { var a5 = mean(l5.map(function (x) { return x.place; })); if (p.avg_place - a5 > 2) st.push('Последние финалы лучше обычного: среднее место ' + f1(a5) + ' против ' + f1(p.avg_place) + '.'); else if (p.avg_place - a5 < -2) wk.push('Последние финалы хуже обычного: среднее место ' + f1(a5) + ' против ' + f1(p.avg_place) + '.'); }
    var ia = (IT.alltime || []).filter(function (x) { return x.name === name; })[0];
    if (ia) { if (ia.win > 0 && ia.pos_days >= ia.days / 2) st.push('Успешен на межсезонках: <b>' + sgn(ia.win) + '</b> фишек, в плюсе ' + ia.pos_days + ' из ' + ia.days + ' дней.'); else if (ia.win < 0) wk.push('На межсезонках в минусе: <b>' + fmt(ia.win) + '</b> фишек за ' + ia.days + ' дн.'); }
    var col = function (t, a, c) { return '<div class="card sw ' + c + '"><h3>' + t + '</h3>' + (a.length ? '<ul>' + a.slice(0, 4).map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '<p class="note" style="margin:0">Явных выводов нет — всё в пределах клубной нормы.</p>') + '</div>'; };
    return '<h2>Сильные и слабые стороны</h2><div class="grid g2">' + col('💪 Сильные стороны', st, 'good') + col('🎯 Зоны роста', wk, 'bad') + '</div><p class="note">Выводы автоматические: сравнение с клубными медианами по финалам, стекам и рейтингу.</p>';
  }
  function interBlock(name) {
    var rows = [];
    IT.series.forEach(function (s) { var st = s.standings.slice().sort(function (a, b) { return b.win - a.win; }), i = -1; st.forEach(function (x, k) { if (x.name === name) i = k; }); if (i >= 0) rows.push({ s: s, rank: i + 1, x: st[i] }); });
    if (!rows.length) return '';
    var ia = (IT.alltime || []).filter(function (x) { return x.name === name; })[0], h = '<h2>Межсезонки</h2>';
    if (ia) h += '<div class="grid g4">' + kpi(ia.series, 'серий сыграно') + kpi((ia.win > 0 ? '+' : '') + fmt(ia.win), 'фишек за всё время') + kpi('+' + fmt(ia.best), 'лучший день') + kpi(ia.series_wins, 'серий выиграно') + '</div>';
    h += '<div class="tw"><table class="dtab itb"><thead><tr><th class="l">Серия</th><th>Место</th><th>Дней</th><th>Итог</th></tr></thead><tbody>' + rows.slice(-8).reverse().map(function (r) { return '<tr><td class="l"><a class="pl" href="#inter/' + r.s.id + '">' + esc(interTitle(r.s)) + '</a></td><td>' + r.rank + ' из ' + r.s.standings.length + '</td><td>' + r.x.days + '</td><td class="' + (r.x.win > 0 ? 'pos' : (r.x.win < 0 ? 'neg' : '')) + '">' + (r.x.win > 0 ? '+' : '') + fmt(r.x.win) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }

  /* ---------- картинка для шаринга ---------- */
  function shareCard(name) {
    var p = PA[name], W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d'), F = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    var g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#14402d'); g.addColorStop(1, '#07140e'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.globalAlpha = .07; c.fillStyle = '#fff'; c.font = '700 260px ' + F; c.fillText('♠', 760, 330); c.globalAlpha = 1;
    var t = disp(name).replace(/[^A-Za-zА-Яа-яЁё0-9 ]/g, ' ').trim().split(/\s+/), ini = (t[0] || '?').charAt(0).toUpperCase() + (t[1] ? t[1].charAt(0).toUpperCase() : '');
    var hs = 0, s = String(name); for (var i = 0; i < s.length; i++) hs = (hs * 31 + s.charCodeAt(i)) % 360;
    c.fillStyle = 'hsl(' + hs + ',42%,36%)'; c.beginPath(); c.arc(150, 190, 90, 0, 7); c.fill(); c.lineWidth = 6; c.strokeStyle = '#e0b858'; c.stroke();
    c.fillStyle = '#fff'; c.font = '700 70px ' + F; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ini, 150, 194);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#e0b858'; c.font = '700 30px ' + F; c.fillText('♠ неПокер · профиль игрока', 270, 150);
    c.fillStyle = '#fff'; var nm = disp(name), fs = 78; c.font = '800 ' + fs + 'px ' + F; while (c.measureText(nm).width > 770 && fs > 36) { fs -= 4; c.font = '800 ' + fs + 'px ' + F; } c.fillText(nm, 270, 240);
    c.fillStyle = '#9db1a6'; c.font = '400 32px ' + F; c.fillText(p.finals + ' финал(ов) · лучшее место ' + Math.min.apply(null, p.places) + ' · среднее ' + f1(p.avg_place), 270, 292);
    var kp = [[p.wins, 'побед'], [p.podiums, 'призовых'], [p.table, 'фин. столов'], [p.rating_now != null ? p.rating_now : '—', 'рейтинг' + (p.rating_rank ? ' (#' + p.rating_rank + ')' : '')]];
    kp.forEach(function (k, i) { var x = 60 + i * 240; c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(x, 380, 220, 170); c.fillStyle = '#58b886'; c.font = '800 70px ' + F; c.fillText(String(k[0]), x + 18, 468); c.fillStyle = '#c9d8cf'; c.font = '400 26px ' + F; c.fillText(k[1], x + 18, 520); });
    c.fillStyle = '#e0b858'; c.font = '700 34px ' + F; c.fillText('Форма: последние финалы', 60, 640);
    var l = p.list.slice(-8), cw = 112, gap = 12;
    l.forEach(function (x, i) { var xx = 60 + i * (cw + gap), col = x.place === 1 ? '#e0b858' : (x.place <= 3 ? '#a9b4af' : (x.place <= 9 ? '#2f7d58' : 'rgba(255,255,255,.12)')); c.fillStyle = col; c.fillRect(xx, 670, cw, 120); c.fillStyle = x.place <= 3 ? '#1c2622' : '#fff'; c.textAlign = 'center'; c.font = '800 48px ' + F; c.fillText(String(x.place), xx + cw / 2, 735); c.font = '400 22px ' + F; c.fillText(cut(x.short, 9), xx + cw / 2, 772); c.textAlign = 'left'; });
    var sr = (p.series || []).filter(function (z) { return z.e <= 60; });
    if (sr.length > 2) {
      c.fillStyle = '#e0b858'; c.font = '700 34px ' + F; c.fillText('Рейтинг по событиям', 60, 880);
      var mx = Math.max.apply(null, sr.map(function (z) { return z.rating; })), x0 = 60, x1 = 1020, y0 = 1160, y1 = 920, mE = sr[sr.length - 1].e, mn = sr[0].e;
      c.strokeStyle = '#58b886'; c.lineWidth = 5; c.lineJoin = 'round'; c.beginPath();
      sr.forEach(function (z, i) { var x = x0 + (z.e - mn) / (mE - mn || 1) * (x1 - x0), y = y0 - z.rating / mx * (y0 - y1); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
      c.fillStyle = '#fff'; c.font = '700 34px ' + F; c.textAlign = 'right'; c.fillText(String(sr[sr.length - 1].rating), x1, y1 - 14); c.textAlign = 'left';
    }
    var bg = badges(name).slice(0, 4).map(function (b) { return b[0] + ' ' + b[1]; }).join('   ');
    c.fillStyle = '#c9d8cf'; c.font = '400 30px ' + F; if (bg) c.fillText(cut(bg, 50), 60, 1230);
    c.fillStyle = '#6f8479'; c.font = '400 26px ' + F; c.fillText('Аналитика турниров клуба «неПокер»', 60, 1290);
    return cv;
  }
  function doShare(name, msg) {
    var cv = shareCard(name);
    cv.toBlob(function (b) {
      var file = null; try { file = new File([b], 'nepoker-' + name.replace(/\s+/g, '_') + '.png', { type: 'image/png' }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ files: [file], title: 'неПокер: ' + disp(name) }).catch(function () {}); msg.textContent = ''; return; }
      var u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = 'nepoker-' + name.replace(/\s+/g, '_') + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); msg.textContent = 'Картинка сохранена';
    });
  }


  /* ---------- калькулятор «что если» для рейтинга ---------- */
  function whatIf(name, x) {
    var p = PA[name], ri = ratingInfo(name), list = ratingList(), K = D.rating_top;
    x = Math.max(0, Math.round(+x || 0));
    var gain = ri.full ? Math.max(0, x - ri.min) : x, nr = p.rating_now + gain;
    var others = list.filter(function (o) { return o.name !== name; });
    var oldPlace = list.indexOf(p) + 1, newPlace = others.filter(function (o) { return o.rating_now > nr; }).length + 1;
    var passed = others.filter(function (o) { return o.rating_now >= p.rating_now && o.rating_now <= nr && o.rating_now > p.rating_now; });
    var weak = ri.full ? ri.s[ri.idx[K - 1]] : null;
    var out = '<div class="wires"><div class="wi-big"><span>' + p.rating_now + '</span> → <b>' + nr + '</b> <em class="' + (gain > 0 ? 'pos' : '') + '">' + (gain > 0 ? '+' + gain : '±0') + '</em></div>' +
      '<p style="margin:4px 0">Место в рейтинге: <b>' + oldPlace + '</b> → <b>' + newPlace + '</b>' + (newPlace < oldPlace ? ' 📈' : '') + '</p>';
    if (!gain) out += '<p class="note" style="margin:0">Результат в ' + x + ' оч. не выше порога зачёта (' + ri.min + '): рейтинг не изменится.</p>';
    else {
      if (weak) out += '<p class="note" style="margin:0">Выпадет самый слабый зачётный результат: ' + weak.pts + ' оч. («' + esc(eventLabel(weak.e)) + '»).</p>';
      if (passed.length) out += '<p style="margin:4px 0 0">Обгоняет: ' + passed.slice(-5).reverse().map(function (o) { return link(o.name) + ' (' + o.rating_now + ')'; }).join(', ') + '.</p>';
    }
    return out + '</div>';
  }
  function whatIfBlock(name) {
    var ri = ratingInfo(name), presets = [ri.full ? ri.min : 50, 100, 150, 200, 250].filter(function (v, i, a) { return a.indexOf(v) === i; });
    return '<h2>Что если…</h2><div class="card whatif"><label class="wil">Новый результат игрока, очков <input id="wi" type="number" min="0" max="500" step="1" value="' + presets[Math.min(2, presets.length - 1)] + '" data-name="' + esc(name) + '" inputmode="numeric"></label>' +
      '<div class="wip">' + presets.map(function (v) { return '<button type="button" class="chip wiq" data-v="' + v + '">' + v + (ri.full && v === ri.min ? ' (порог)' : '') + '</button>'; }).join('') + '</div><div id="wires">' + whatIf(name, presets[Math.min(2, presets.length - 1)]) + '</div>' +
      '<p class="note" style="margin:8px 0 0">Прикидка по текущей таблице: другие игроки не меняются. Очки за финал считаются как √(N·K)/√место, у отборочных дней они меньше.</p></div>';
  }

  /* ---------- дуэль двух игроков ---------- */
  function duelCard(a, b, pa, pb, common) {
    var aw = 0, bw = 0, tie = 0, sa = 0, sb = 0, best = { a: null, b: null };
    common.forEach(function (x) {
      var y = pb.list.filter(function (z) { return z.t === x.t; })[0], d = y.place - x.place;
      if (d > 0) aw++; else if (d < 0) bw++; else tie++;
      sa += x.place; sb += y.place;
      if (d > 0 && (!best.a || d > best.a.d)) best.a = { d: d, t: x.short, p1: x.place, p2: y.place };
      if (d < 0 && (!best.b || -d > best.b.d)) best.b = { d: -d, t: x.short, p1: y.place, p2: x.place };
    });
    var A = {}, B = {}, ea = 0, eb = 0; (pa.series || []).forEach(function (z) { if (z.pts > 0) A[z.e] = z.pts; }); (pb.series || []).forEach(function (z) { if (z.pts > 0) B[z.e] = z.pts; });
    Object.keys(A).forEach(function (e) { if (B[e] != null) { if (A[e] > B[e]) ea++; else if (A[e] < B[e]) eb++; } });
    var n = common.length, pc = function (v) { return Math.round(v / n * 100); };
    var h = '<div class="card duel"><div class="dl-head"><span class="dn a">' + esc(disp(a)) + '</span><span class="dn b">' + esc(disp(b)) + '</span></div>' +
      '<div class="dbar" role="img" aria-label="Счёт по общим финалам"><i class="a" style="width:' + pc(aw) + '%">' + (aw || '') + '</i><i class="t" style="width:' + pc(tie) + '%">' + (tie || '') + '</i><i class="b" style="width:' + pc(bw) + '%">' + (bw || '') + '</i></div>' +
      '<p class="note" style="margin:4px 0 8px">Кто финишировал выше в общих финалах (' + n + '): ' + esc(disp(a)) + ' — ' + aw + ', ' + esc(disp(b)) + ' — ' + bw + (tie ? ', поровну ' + tie : '') + '.</p>' +
      '<div class="dstats"><div><b>' + f1(sa / n) + '</b><span>среднее место ' + esc(cut(disp(a), 14)) + '</span></div><div><b>' + f1(sb / n) + '</b><span>среднее место ' + esc(cut(disp(b), 14)) + '</span></div>' +
      ((ea + eb) ? '<div><b>' + ea + ' : ' + eb + '</b><span>события, где очков больше</span></div>' : '') + '</div>';
    if (best.a || best.b) h += '<p class="note" style="margin:8px 0 0">' + (best.a ? 'Крупнейшая победа ' + esc(disp(a)) + ': ' + esc(best.a.t) + ' (' + best.a.p1 + '-е место против ' + best.a.p2 + '-го). ' : '') + (best.b ? 'Крупнейшая победа ' + esc(disp(b)) + ': ' + esc(best.b.t) + ' (' + best.b.p1 + '-е место против ' + best.b.p2 + '-го).' : '') + '</p>';
    return h + '</div>';
  }

  /* ---------- посещаемость ---------- */
  function visitsChart(ev) {
    var W = MOB ? 400 : 760, H = MOB ? 230 : 270, L = MOB ? 30 : 38, R = 8, Tp = 12, B = 30, N = ev.length, mx = Math.ceil(Math.max.apply(null, ev.map(function (e) { return e.n; })) / 20) * 20;
    var bw = (W - L - R) / N, y = function (v) { return Tp + (1 - v / mx) * (H - Tp - B); }, col = { tourn: 'var(--green)', oneday: 'var(--gold)', inter: 'var(--blue)' }, kn = { tourn: 'многодневный турнир', oneday: 'однодневный', inter: 'межсезонка' };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Число участников по событиям">';
    for (var g = 0; g <= mx; g += 20) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)"/><text class="mu" x="' + (L - 5) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="11">' + g + '</text>';
    var prev = null, yrStart = 0;
    ev.forEach(function (e, i) {
      var x = L + i * bw;
      if (prev !== null && e.year !== prev) s += '<line x1="' + x + '" x2="' + x + '" y1="' + Tp + '" y2="' + (H - B + 6) + '" stroke="var(--mute)" stroke-dasharray="3 3" opacity=".6"/>';
      if (e.year !== prev) { var cnt = ev.filter(function (z) { return z.year === e.year; }).length; s += '<text class="mu" x="' + (x + cnt * bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="12" font-weight="700">' + e.year + '</text>'; prev = e.year; }
      s += '<rect x="' + (x + bw * .12) + '" y="' + y(e.n) + '" width="' + bw * .76 + '" height="' + (H - B - y(e.n)) + '" rx="1.5" fill="' + col[e.kind] + '" opacity="' + (e.extra ? '.55' : '.88') + '"' + (e.extra ? ' stroke="' + col[e.kind] + '" stroke-dasharray="3 2"' : '') + '><title>' + esc(e.name) + ' — ' + e.n + ' игроков, впервые пришли ' + e.new + ' (' + kn[e.kind] + ')</title></rect>';
    });
    return s + '</svg><div class="legend"><span><i class="dot" style="background:var(--green)"></i>многодневный турнир</span><span><i class="dot" style="background:var(--gold)"></i>однодневный</span><span><i class="dot" style="background:var(--blue)"></i>межсезонка</span></div>';
  }
  function pVisits() {
    var A = D.attendance; if (!A) return '<h1>Посещаемость</h1><p class="note">Нет данных.</p>';
    var ev = A.events, tot = ev.reduce(function (a, e) { return a + e.n; }, 0), rec = ev.slice().sort(function (x, y) { return y.n - x.n; })[0], yrs = Object.keys(A.years).sort();
    var h = '<h1>Посещаемость</h1><p class="sub">Сколько игроков приходило на каждое событие клуба с августа 2023 года. Источник — отметки в таблице «Итоги» до события «' + esc(A.last_core) + '»' + (A.extra_n ? '; ' + A.extra_n + ' более новых событий (штриховка на графике) посчитаны по результатам на сайте — по списку игроков турнира или игровых дней межсезонки.' : '.') + '</p>';
    h += '<div class="grid g4">' + kpi(ev.length, 'событий клуба') + kpi(f1(tot / ev.length), 'в среднем игроков на событие') + kpi(rec.n, 'рекорд: ' + esc(cut(rec.name, 28))) + kpi(A.total, 'разных игроков за всё время') + '</div>';
    h += '<h2>Игроков на событии</h2><div class="chart">' + visitsChart(ev) + '</div>';
    var y0 = A.years[yrs[0]], yl = A.years[yrs[yrs.length - 1]], y1 = A.years[yrs[yrs.length - 2]];
    h += cap('Средний состав вырос с <b>' + f1(y0.avg) + '</b> игроков в ' + yrs[0] + ' до <b>' + f1(yl.avg) + '</b> в ' + yrs[yrs.length - 1] + '. Больше всего людей собирают межсезонки и многодневные турниры; однодневные Тузы заметно скромнее.');
    h += '<h2>По годам</h2><div class="tw"><table><thead><tr><th class="l">Год</th><th>' + (MOB ? 'Событий' : 'Событий в году') + '</th><th>' + (MOB ? 'Ср. состав' : 'Средний состав') + '</th><th>' + (MOB ? 'Новых' : 'Впервые пришли') + '</th><th>' + (MOB ? 'Разных' : 'Разных игроков') + '</th></tr></thead><tbody>' + yrs.map(function (y) { var v = A.years[y]; return '<tr><td class="l"><b>' + y + '</b></td><td>' + v.events + '</td><td>' + f1(v.avg) + '</td><td>' + v.new + '</td><td>' + v.uniq + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var dn = ['1 событие', '2–5 событий', '6–20 событий', '21 и больше'];
    h += '<h2>Сколько раз люди возвращаются</h2><div class="chart">' + hbars(A.dist.map(function (v, i) { return { label: dn[i], v: v, txt: v + ' чел. (' + Math.round(v / A.total * 100) + '%)', color: i === 0 ? 'var(--mute)' : (i === 3 ? 'var(--gold)' : 'var(--green)') }; })) + '</div>';
    h += cap('Разово заходили <b>' + Math.round(A.dist[0] / A.total * 100) + '%</b> игроков, а ядро клуба (21+ событий) — <b>' + A.dist[3] + '</b> человек.');
    h += '<h2>Самые частые гости</h2><div class="chart">' + hbars(A.top.slice(0, 12).map(function (x) { return { label: disp(x.name), v: x.visits, txt: x.visits + ' посещ. · ' + x.events + ' событий', color: 'var(--green)' }; })) + '</div><p class="note">Посещения — по счётчику в таблице «Итоги» (считаются игровые дни), события — число отметок в матрице.</p>';
    return h;
  }

  /* ---------- «Интересное»: номинации, метрики и охота в одном разделе ---------- */
  function pInteresting(sub, arg) {
    var tabs = [['awards', 'Номинации'], ['metrics', 'Метрики стека'], ['hunt', 'Охота'], ['visits', 'Посещаемость']];
    var h = '<h1>Интересное</h1><div class="subtabs" role="tablist">' + tabs.map(function (x) { return '<a role="tab" class="' + (sub === x[0] ? 'on' : '') + '" href="#fun/' + x[0] + '">' + x[1] + '</a>'; }).join('') + '</div>';
    var body = sub === 'metrics' ? pMetrics() : (sub === 'hunt' ? pHunt(arg) : (sub === 'visits' ? pVisits() : pFun()));
    return h + body.replace(/^<h1>[^<]*<\/h1>/, '');
  }

  /* ---------- роутинг ---------- */
  function countUp() {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var to = +el.dataset.count; if (reduce || !to) return;
      var t0 = null; (function step(ts) { if (t0 == null) t0 = ts; var u = Math.min(1, (ts - t0) / 900); el.textContent = Math.round(to * (1 - Math.pow(1 - u, 3))); if (u < 1) requestAnimationFrame(step); })(performance.now());
    });
  }
  function route(keep) {
    var parts = location.hash.replace(/^#/, '').split('/'), tab = parts[0] || 'overview';
    if (tab === 'metrics' || tab === 'hunt') { parts = ['fun', tab].concat(parts.slice(1)); try { history.replaceState(null, '', '#' + parts.join('/')); } catch (e) {} tab = 'fun'; }
    var sub = tab === 'fun' ? (parts[1] || 'awards') : null, argRaw = tab === 'fun' ? parts[2] : parts[1], arg = argRaw ? decodeURIComponent(argRaw) : null;
    var pages = { overview: pOverview, tournaments: function () { return pTournaments(arg); }, players: function () { return pPlayers(arg); }, fun: function () { return pInteresting(sub, arg); }, rating: function () { return pRating(arg); }, fame: pFame, heat: pHeat, inter: function () { return pInter(arg); }, hunt: function () { return pHunt(arg); }, compare: function () { return pCompare(parts[1] ? decodeURIComponent(parts[1]) : null, parts[2] ? decodeURIComponent(parts[2]) : null); }, report: function () { return pReport(arg); }, data: pData };
    var gated = tab === 'fun' && (sub === 'hunt' || sub === 'visits') ? '' : tab, needsData = { overview: 1, fun: 1 }, needsT = { overview: 1, fun: 1, heat: 1 };
    if ((needsT[gated] || (tab === 'players' && !arg)) && (!TA.length || (needsData[gated] && !ES.length))) {
      app.innerHTML = '<h1>Нет данных</h1>' + filterBar() + '<p class="note">В выбранном периоде нет турниров' + (TA.length ? ' с известными стеками' : '') + '. Расширьте период или включите нестандартные форматы.</p>';
      document.querySelectorAll('#nav a').forEach(function (x) { x.classList.toggle('on', x.dataset.t === tab); });
      return;
    }
    app.classList.toggle('noanim', keep === true);
    app.classList.add('enter'); clearTimeout(route.enterT); route.enterT = setTimeout(function () { app.classList.remove('enter'); }, 1500);
    app.innerHTML = (pages[tab] || pOverview)();
    document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.t === tab); });
    var mre = document.getElementById('more'); if (mre) mre.classList.toggle('has-on', !!document.querySelector('#moremenu a.on'));
    if (tab === 'players' && !arg) { renderPT(); var qi = document.getElementById('q'); qi.addEventListener('input', function () { q = qi.value; renderPT(); }); }
    if (tab === 'tournaments') setupRace();
    if (tab === 'report') drawCards();
    if (tab === 'compare') setupCompare();
    countUp();
    if (keep !== true) window.scrollTo(0, 0);
  }
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'wi') { document.getElementById('wires').innerHTML = whatIf(ev.target.dataset.name, ev.target.value); return; }
    var iid = ev.target.id; if (iid !== 'hq' && iid !== 'rq') return;
    if (iid === 'hq') heat.hq = ev.target.value; else rq = ev.target.value;
    var pos = ev.target.selectionStart; route(true);
    var el = document.getElementById(iid); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
  });
  document.addEventListener('change', function (ev) {
    var id = ev.target.id;
    if (id === 'incl') flt.incl = ev.target.checked;
    else if (id === 'ff') flt.from = +ev.target.value;
    else if (id === 'ft') flt.to = +ev.target.value;
    else if (id === 'cmpA' || id === 'cmpB') { location.hash = '#compare/' + encodeURIComponent(document.getElementById('cmpA').value) + '/' + encodeURIComponent(document.getElementById('cmpB').value); return; }
    else if (id === 'hall') { huntAll = ev.target.checked; route(true); return; }
    else if (id === 'hmetric' || id === 'hsort' || id === 'hmin') { heat[id] = ev.target.value; route(true); return; }
    else return;
    if (flt.from > flt.to) { var tmp = flt.from; flt.from = flt.to; flt.to = tmp; }
    saveFilter(); applyFilter(); route(true);
  });
  document.addEventListener('click', function (ev) {
    var itr = ev.target.closest('.chip.itr'); if (itr) { location.hash = '#inter/' + itr.dataset.id; return; }
    var hn = ev.target.closest('.chip.hnt'); if (hn) { location.hash = '#fun/hunt/' + hn.dataset.id; return; }
    var wq = ev.target.closest('.wiq'); if (wq) { var wi = document.getElementById('wi'); wi.value = wq.dataset.v; document.getElementById('wires').innerHTML = whatIf(wi.dataset.name, wq.dataset.v); return; }
    var ppr = ev.target.closest('#pprint'); if (ppr) { var nm0 = decodeURIComponent((location.hash.split('/')[1] || '')), old = document.title; document.title = 'неПокер — ' + disp(nm0); window.print(); setTimeout(function () { document.title = old; }, 500); return; }
    var psh = ev.target.closest('#pshare'); if (psh) { doShare(decodeURIComponent(location.hash.split('/')[1] || ''), document.getElementById('pmsg')); return; }
    var rp = ev.target.closest('.chip.rpt'); if (rp) location.hash = '#report/' + rp.dataset.id;
    var dl = ev.target.closest('.dl'); if (dl) { var cv = document.getElementById(dl.dataset.cv); cv.toBlob(function (b) { var u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = 'nepoker-' + pReport.cur.t.id + '-' + dl.dataset.name + '.png'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }); }
    var cp = ev.target.closest('#repcopy'); if (cp) { var tx = document.getElementById('reptext').textContent, msg = document.getElementById('repmsg'); (navigator.clipboard ? navigator.clipboard.writeText(tx) : Promise.reject()).then(function () { msg.textContent = 'Скопировано'; }, function () { var r = document.createRange(); r.selectNodeContents(document.getElementById('reptext')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); msg.textContent = 'Текст выделен — нажмите Ctrl+C'; }); }
    var fy = ev.target.closest('.chip.fy'); if (fy) { var yy = fy.dataset.y; if (yy === 'all') { flt.from = 0; flt.to = T.length - 1; } else { var ix = []; T.forEach(function (t, i) { if (String(t.year) === yy) ix.push(i); }); if (ix.length) { flt.from = ix[0]; flt.to = ix[ix.length - 1]; } } saveFilter(); applyFilter(); route(true); return; }
    if (ev.target.id === 'freset') { flt = { from: 0, to: T.length - 1, incl: false }; saveFilter(); applyFilter(); route(true); return; }
    var c = ev.target.closest('.chip:not(.rpt):not(.hnt):not(.itr):not(.wiq)'); if (c && c.dataset.id) location.hash = '#tournaments/' + c.dataset.id;
    var th = ev.target.closest('th.s'); if (th) { var k = th.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; } renderPT(); }
  });
  window.addEventListener('hashchange', function () { route(); });
  var onMq = function () { MOB = mq.matches; route(true); };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  setupSearch();
  setupBurger();
  setupChrome();
  route();
})();
