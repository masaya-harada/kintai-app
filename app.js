// ★Google Apps ScriptのURL（スプレッドシートとつながる窓口）
const GAS_URL = 'https://script.google.com/macros/s/AKfycby9NmGe8drC-3jPEkTlCTjoF4JYddKWiW3W_x2THYoxjSVcztaA9hgZYdPIDm5y37zIpA/exec';

const NAME_KEY = 'kintai-name';
const ADMIN_PIN = '9127'; // Google側の合言葉（画面では入力しない）
const DEMO = new URLSearchParams(location.search).has('demo');
const WEEK = ['日','月','火','水','木','金','土'];

const settings = { std: 8 };        // 1日の所定労働時間（これを超えた分が残業）
const BREAK_START = 12 * 60, BREAK_END = 13 * 60; // 休憩 12:00〜13:00
let reportMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let monthRecords = [];

// ---------- 小道具 ----------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fmtTime = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const monthKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hm = (min) => min == null ? '' : Math.floor(min / 60) + ':' + pad(min % 60);
const hours = (min) => (Math.round(min / 6) / 10).toFixed(1); // 0.1時間単位
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), isErr ? 4500 : 2500);
}

// ---------- データのやりとり ----------
let demoData = null;
function makeDemoData() {
  const out = [];
  const people = [['山田 太郎', 0], ['佐藤 花子', 1], ['鈴木 一郎', 2]];
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() - 1);
  const today = fmtDate(new Date());
  for (let d = new Date(base); fmtDate(d) <= today; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    people.forEach(([name, seed]) => {
      if (dow === 0 || (dow === 6 && (d.getDate() + seed) % 3)) return;
      if ((d.getDate() * 7 + seed * 3) % 23 === 0) return; // たまに休み
      const date = fmtDate(d);
      const inM = 7 * 60 + 40 + ((d.getDate() * 13 + seed * 7) % 35);
      const outM = 17 * 60 + ((d.getDate() * 17 + seed * 11) % 150);
      out.push({ date, time: hm(inM).padStart(5, '0'), name, type: 'in' });
      if (date !== today && !(seed === 2 && d.getDate() === 16)) out.push({ date, time: hm(outM).padStart(5, '0'), name, type: 'out' });
    });
  }
  return out;
}

async function getJson(params) {
  const res = await fetch(GAS_URL + '?' + new URLSearchParams(params), { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('old-server');
  if (!data.ok) throw new Error(data.error || 'error');
  getJson.last = data;
  return data.records;
}

async function postJson(body) {
  // text/plain で送るとGoogle側と問題なくやりとりできる
  const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('保存できませんでした');
  return data;
}

// 今いる場所（GPS）を取る
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('nogeo'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }),
      (err) => reject(new Error(err.code === 1 ? 'denied' : 'nogeo')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  });
}

// 集計用：その月の全員分（暗証番号が必要）
async function fetchMonth(mk) {
  if (DEMO) {
    demoData = demoData || makeDemoData();
    return demoData.filter((r) => r.date.startsWith(mk));
  }
  return getJson({ pin: ADMIN_PIN, month: mk });
}

// 打刻画面用：本人の今日の分だけ
async function fetchMine(name, date) {
  if (DEMO) {
    demoData = demoData || makeDemoData();
    return demoData.filter((r) => r.name === name && r.date === date);
  }
  return getJson({ name, date });
}

// 保存して、Google側の時計で確定した日付・時刻を返す
async function sendStamp(rec) {
  if (DEMO) { demoData = demoData || makeDemoData(); demoData.push(rec); return rec; }
  const data = await postJson(rec);
  if (!data.ok) { const err = new Error(data.error || '保存できませんでした'); err.data = data; throw err; }
  return { date: data.date || rec.date, time: data.time || rec.time };
}

// ---------- 打刻画面 ----------
function tickClock() {
  const now = new Date();
  $('clock').textContent = fmtTime(now);
  $('clock-date').textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日（' + WEEK[now.getDay()] + '）';
}

function showStampScreen() {
  const name = lsGet(NAME_KEY);
  $('name-card').style.display = name ? 'none' : 'block';
  $('stamp-card').style.display = name ? 'block' : 'none';
  if (name) { $('who-name').textContent = name; refreshToday(); }
  else $('name-input').focus();
}

let todayState = { inT: null, outT: null, inYest: false };
async function refreshToday() {
  const name = lsGet(NAME_KEY);
  const now = new Date();
  const today = fmtDate(now);
  try {
    const recs = await fetchMine(name, today);
    const ins = recs.filter((r) => r.type === 'in').map((r) => r.time).sort();
    const outs = recs.filter((r) => r.type === 'out').map((r) => r.time).sort();
    todayState = { inT: ins[0] || null, outT: outs[outs.length - 1] || null, inYest: false };
    // 夜勤：今日まだ出勤していなくて、昨日「出勤したまま退勤していない」なら、それを続きとして扱う
    if (!todayState.inT && now.getHours() < 12) {
      const yest = await fetchMine(name, fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)));
      const yIn = yest.filter((r) => r.type === 'in').map((r) => r.time).sort()[0];
      const yOut = yest.some((r) => r.type === 'out');
      if (yIn && !yOut) todayState = { inT: yIn, outT: todayState.outT, inYest: true };
    }
  } catch (e) { /* 読めなくても打刻はできる */ }
  $('ts-in-val').textContent = todayState.inT ? (todayState.inYest ? '昨日 ' : '') + todayState.inT : '--:--';
  $('ts-out-val').textContent = todayState.outT || '--:--';
  $('ts-in').className = 'ts-box' + (todayState.inT ? ' done-in' : '');
  $('ts-out').className = 'ts-box' + (todayState.outT ? ' done-out' : '');
}

function setGpsMsg(text) {
  const el = $('gps-msg');
  el.className = 'gps-msg' + (text ? ' show' : '');
  el.textContent = text;
}
function showGpsHelp(html) {
  const el = $('gps-msg');
  el.className = 'gps-msg show err';
  el.innerHTML = html;
  if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
}

async function stamp(type) {
  const name = lsGet(NAME_KEY);
  const label = type === 'in' ? '出勤' : '退勤';
  if (type === 'in' && todayState.inT && !todayState.inYest && !confirm('今日はもう ' + todayState.inT + ' に出勤しています。\nもう一度、出勤を記録しますか？')) return;
  if (type === 'out' && !todayState.inT && !confirm('今日の出勤が記録されていません。\n退勤だけ記録しますか？')) return;

  const now = new Date();
  const rec = { date: fmtDate(now), time: fmtTime(now), name, type };
  $('btn-in').disabled = $('btn-out').disabled = true;
  setGpsMsg('📍 場所を確認しています…');
  try {
    if (!DEMO) {
      try { Object.assign(rec, await getPosition()); }
      catch (e) {
        throw new Error(e.message === 'denied' ? 'denied' : 'nogps');
      }
    }
    setGpsMsg('');
    const saved = await sendStamp(rec);
    if (type === 'in') todayState = { inT: todayState.inYest ? saved.time : (todayState.inT || saved.time), inYest: false, outT: todayState.outT };
    else todayState.outT = saved.time;
    toast(label + 'しました（' + saved.time + '）' + (type === 'out' ? ' おつかれさまでした' : ''));
    if (navigator.vibrate) navigator.vibrate(60);
  } catch (e) {
    setGpsMsg('');
    if (e.message === 'far') {
      const d = e.data.distance;
      showGpsHelp('会社から約 ' + (d >= 1000 ? (d / 1000).toFixed(1) + 'km' : d + 'm') + ' 離れています。<br>会社の近く（' + e.data.radius + 'm以内）で押してください。');
    } else if (e.message === 'denied') {
      showGpsHelp('位置情報が「許可しない」になっています。<br>' +
        '<b>iPhone</b>：設定 → プライバシーとセキュリティ → 位置情報サービス → Safari（またはChrome）→「使用中のみ」<br>' +
        '<b>Android</b>：アドレスバー左の鍵マーク → 権限 → 位置情報 →「許可」<br>そのあと、もう一度押してください。');
    } else if (e.message === 'nogps') {
      showGpsHelp('場所がわかりませんでした。スマホの位置情報をオンにして、もう一度押してください。');
    } else {
      toast('記録できませんでした。電波のよい所でもう一度押してください', true);
    }
  }
  $('btn-in').disabled = $('btn-out').disabled = false;
  refreshToday();
}

// ---------- 集計 ----------
function summarize(recs, name, monthDate) {
  const y = monthDate.getFullYear(), m = monthDate.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const today = fmtDate(new Date());
  const byDate = {};
  recs.filter((r) => r.name === name).forEach((r) => {
    const o = byDate[r.date] || (byDate[r.date] = { ins: [], outs: [] });
    o[r.type === 'in' ? 'ins' : 'outs'].push(r.time);
  });
  Object.values(byDate).forEach((o) => { o.ins.sort(); o.outs.sort(); });
  const rows = [];
  let workDays = 0, totalWork = 0, totalOt = 0, missing = 0;
  let usedNextOut = null; // 前日の夜勤の退勤として使った翌日の退勤時刻

  for (let d = 1; d <= days; d++) {
    const date = y + '-' + pad(m + 1) + '-' + pad(d);
    const dow = new Date(y, m, d).getDay();
    const o = byDate[date] || { ins: [], outs: [] };
    const outs = o.outs.filter((t) => t !== usedNextOut);
    usedNextOut = null;
    const inT = o.ins[0] || null;
    let outT = outs[outs.length - 1] || null, overnight = false;
    // 夜勤：出勤だけで退勤がなく、翌日の昼前に（その日の出勤より先に）退勤がある → 日をまたいだ勤務
    if (inT && !outT) {
      const nd = new Date(y, m, d + 1);
      const n = byDate[fmtDate(nd)];
      const firstOut = n && n.outs[0];
      if (firstOut && toMin(firstOut) < 12 * 60 && (!n.ins.length || firstOut < n.ins[0])) {
        outT = firstOut; overnight = true; usedNextOut = firstOut;
      }
    }
    let work = null, ot = null, miss = false;
    if (inT || outT) workDays++;
    const start = inT ? toMin(inT) : 0;
    const end = inT && outT ? (overnight ? 24 * 60 : 0) + toMin(outT) : 0;
    const span = end - start;
    if (span > 0) {
      // 休憩は12:00〜13:00に固定。その時間帯に働いていた分だけ引く（日をまたいだ場合は翌日の昼も見る）
      let brk = 0;
      [0, 24 * 60].forEach((off) => { brk += Math.max(0, Math.min(end, BREAK_END + off) - Math.max(start, BREAK_START + off)); });
      work = Math.max(0, span - brk);
      ot = Math.max(0, work - Math.round(settings.std * 60));
      totalWork += work; totalOt += ot;
    } else if ((inT || outT) && date !== today) {
      miss = true; missing++;
    }
    rows.push({ d, dow, date, inT, outT: outT && overnight ? '翌' + outT : outT, work, ot, miss });
  }
  return { name, rows, workDays, totalWork, totalOt, missing };
}

function personHtml(s, monthDate) {
  const title = monthDate.getFullYear() + '年' + (monthDate.getMonth() + 1) + '月';
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const body = s.rows.map((r) => {
    const cls = (r.dow === 6 ? 'sat' : r.dow === 0 ? 'sun' : '') + (!r.inT && !r.outT ? ' off' : '');
    return '<tr class="' + cls + '"><td class="d">' + r.d + '日（' + WEEK[r.dow] + '）</td>' +
      '<td' + (r.miss && !r.inT ? ' class="miss"' : '') + '>' + (r.inT || (r.miss ? '未' : '')) + '</td>' +
      '<td' + (r.miss && !r.outT ? ' class="miss"' : '') + '>' + (r.outT || (r.miss ? '未' : '')) + '</td>' +
      '<td>' + hm(r.work) + '</td>' +
      '<td class="' + (r.ot ? 'ot-cell' : '') + '">' + (r.ot ? hm(r.ot) : '') + '</td></tr>';
  }).join('');
  return '<div class="card person">' +
    '<p class="print-only" style="margin:0 0 4px; font-size:10pt; color:#666;">勤怠表</p>' +
    '<h2>' + esc(s.name) + ' さん</h2>' +
    '<div class="period">' + title + '（1日〜' + last + '日）</div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="lbl">出勤日数</div><div class="val">' + s.workDays + '<span>日</span></div></div>' +
      '<div class="stat"><div class="lbl">実働合計</div><div class="val">' + hm(s.totalWork) + '</div></div>' +
      '<div class="stat ot"><div class="lbl">残業合計</div><div class="val">' + hm(s.totalOt) + '</div></div>' +
    '</div>' +
    (s.missing ? '<div class="alert">押し忘れが ' + s.missing + ' 日あります（表の「未」）。その日は時間に入っていません。</div>' : '') +
    '<table><thead><tr><th style="text-align:left;">日付</th><th>出勤</th><th>退勤</th><th>実働</th><th>残業</th></tr></thead>' +
    '<tbody>' + body + '</tbody>' +
    '<tfoot><tr><td class="d">合計 ' + s.workDays + '日</td><td></td><td></td><td>' + hm(s.totalWork) + '</td><td class="ot-cell">' + hm(s.totalOt) + '</td></tr></tfoot></table>' +
    '<p class="print-only" style="font-size:8pt; color:#888; margin-top:6px;">所定' + settings.std + '時間／休憩12:00〜13:00で計算　' +
      '時間表記「8:30」＝8時間30分（' + hours(510) + '時間）</p>' +
    '</div>';
}

function overviewHtml(list, monthDate) {
  const title = monthDate.getFullYear() + '年' + (monthDate.getMonth() + 1) + '月';
  return '<div class="card person">' +
    '<p class="print-only" style="margin:0 0 4px; font-size:10pt; color:#666;">勤怠表</p>' +
    '<h2>' + title + '　全員のまとめ</h2><div class="period">' + list.length + '人</div>' +
    '<table class="overview"><thead><tr><th style="text-align:left;">名前</th><th>出勤日数</th><th>実働合計</th><th>残業合計</th></tr></thead><tbody>' +
    list.map((s) => '<tr><td class="n">' + esc(s.name) + (s.missing ? ' <span style="color:var(--danger); font-size:11px;">未' + s.missing + '</span>' : '') + '</td>' +
      '<td>' + s.workDays + '日</td><td>' + hm(s.totalWork) + '</td><td class="ot-cell">' + hm(s.totalOt) + '</td></tr>').join('') +
    '</tbody></table></div>';
}

function names() { return [...new Set(monthRecords.map((r) => r.name))].sort((a, b) => a.localeCompare(b, 'ja')); }

function renderReport() {
  const list = names();
  const sel = $('person-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">全員</option>' + list.map((n) => '<option>' + esc(n) + '</option>').join('');
  if (list.includes(prev)) sel.value = prev;

  if (!list.length) { $('report-body').innerHTML = '<div class="card"><p class="loading">この月の記録はまだありません</p></div>'; return; }
  const targets = sel.value ? [sel.value] : list;
  const sums = targets.map((n) => summarize(monthRecords, n, reportMonth));
  $('report-body').innerHTML = (sel.value ? '' : overviewHtml(sums, reportMonth)) + sums.map((s) => personHtml(s, reportMonth)).join('');
}

async function loadReport() {
  const seq = loadReport.seq = (loadReport.seq || 0) + 1; // 月を連打しても最後の月だけ表示する
  $('m-label').textContent = reportMonth.getFullYear() + '年' + (reportMonth.getMonth() + 1) + '月';
  $('report-body').innerHTML = '<p class="loading">読み込み中…</p>';
  try {
    const recs = await fetchMonth(monthKey(reportMonth));
    if (seq !== loadReport.seq) return;
    monthRecords = recs;
    renderReport();
    loadOffice();
  } catch (e) {
    if (seq !== loadReport.seq) return;
    $('report-body').innerHTML = '<div class="card"><p class="loading">' +
      (e.message === 'old-server' ? 'スプレッドシート側の更新がまだです（設定手順をご確認ください）' : '読み込めませんでした。電波を確認してください') + '</p></div>';
  }
}

// ---------- 会社の場所（管理者だけ） ----------
function showOffice(o) {
  $('office-card').style.display = 'block';
  if (o) {
    $('office-status').innerHTML = '登録済み：会社から <b>' + o.radius + 'm</b> 以内でだけ押せます。' +
      '<a href="https://www.google.com/maps?q=' + o.lat + ',' + o.lng + '" target="_blank" rel="noopener">地図で確認</a>';
    $('office-radius').value = o.radius;
  } else {
    $('office-status').innerHTML = '<span style="color:var(--danger);">まだ登録されていません。</span>今はどこからでも押せます。';
    if (!$('office-radius').value) $('office-radius').value = 300;
  }
}

async function loadOffice() {
  if (DEMO) return showOffice(null);
  try {
    await getJson({ pin: ADMIN_PIN, action: 'office' });
    showOffice(getJson.last.office);
  } catch (e) {}
}

async function saveOffice(withPlace) {
  const radius = Math.round(parseFloat($('office-radius').value) || 300);
  const body = { action: 'setOffice', pin: ADMIN_PIN, radius };
  const btn = withPlace ? $('office-set') : $('office-radius-save');
  btn.disabled = true;
  try {
    if (withPlace) {
      if (!confirm('今いる場所を「会社」として登録します。\n会社にいますか？')) return;
      $('office-status').textContent = '📍 場所を確認しています…';
      const pos = await getPosition();
      body.lat = pos.lat; body.lng = pos.lng;
    }
    if (DEMO) { toast('お試し表示では保存されません'); return; }
    const data = await postJson(body);
    if (!data.ok) throw new Error(data.error);
    showOffice(data.office);
    toast(withPlace ? '会社の場所を登録しました' : '範囲を保存しました');
  } catch (e) {
    toast(e.message === 'denied' ? '位置情報を「許可」にしてください' : e.message === 'nogeo' ? '場所がわかりませんでした。もう一度押してください' : '保存できませんでした', true);
    loadOffice();
  } finally {
    btn.disabled = false;
  }
}

function downloadCsv() {
  const list = $('person-select').value ? [$('person-select').value] : names();
  if (!list.length) return toast('記録がありません', true);
  const lines = [['名前', '日付', '曜日', '出勤', '退勤', '実働(時間)', '残業(時間)', 'メモ']];
  list.forEach((n) => {
    const s = summarize(monthRecords, n, reportMonth);
    s.rows.filter((r) => r.inT || r.outT).forEach((r) => lines.push([n, r.date, WEEK[r.dow], r.inT || '', r.outT || '',
      r.work == null ? '' : hours(r.work), r.ot == null ? '' : hours(r.ot), r.miss ? '押し忘れ' : '']));
    lines.push([n + ' 合計', '', '', '', '', hours(s.totalWork), hours(s.totalOt), '出勤' + s.workDays + '日']);
  });
  const csv = '﻿' + lines.map((l) => l.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = '勤怠_' + monthKey(reportMonth) + ($('person-select').value ? '_' + $('person-select').value : '') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------- タブ ----------
function switchTab(tab) {
  $('view-stamp').style.display = tab === 'stamp' ? 'block' : 'none';
  $('view-report').style.display = tab === 'report' ? 'block' : 'none';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'report') loadReport(); else showStampScreen();
  window.scrollTo(0, 0);
}

// ---------- はじまり ----------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('btn-in').addEventListener('click', () => stamp('in'));
$('btn-out').addEventListener('click', () => stamp('out'));
$('name-save').addEventListener('click', () => {
  const v = $('name-input').value.trim().replace(/\s+/g, ' ');
  if (!v) return toast('お名前を入れてください', true);
  lsSet(NAME_KEY, v); showStampScreen();
});
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('name-save').click(); });
$('name-change').addEventListener('click', () => {
  if (!confirm('名前を変更しますか？')) return;
  $('name-input').value = lsGet(NAME_KEY) || '';
  lsSet(NAME_KEY, ''); showStampScreen();
});
$('m-prev').addEventListener('click', () => { reportMonth = new Date(reportMonth.getFullYear(), reportMonth.getMonth() - 1, 1); loadReport(); });
$('m-next').addEventListener('click', () => { reportMonth = new Date(reportMonth.getFullYear(), reportMonth.getMonth() + 1, 1); loadReport(); });
$('person-select').addEventListener('change', renderReport);
$('btn-pdf').addEventListener('click', () => window.print());
$('btn-csv').addEventListener('click', downloadCsv);
$('office-set').addEventListener('click', () => saveOffice(true));
$('office-radius-save').addEventListener('click', () => saveOffice(false));

if (DEMO) { $('demo-badge').style.display = 'inline-block'; if (!lsGet(NAME_KEY)) lsSet(NAME_KEY, '山田 太郎'); }
tickClock(); setInterval(tickClock, 1000);
showStampScreen();
if (location.hash === '#report') switchTab('report');
