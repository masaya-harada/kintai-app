const STORAGE_KEY = 'attendance-records-v1';
const NAME_KEY = 'attendance-worker-name';

// ★ここにGoogle Apps ScriptのURLを貼り付ける
const GAS_URL = 'https://script.google.com/macros/s/AKfycby9NmGe8drC-3jPEkTlCTjoF4JYddKWiW3W_x2THYoxjSVcztaA9hgZYdPIDm5y37zIpA/exec';

let records = [];
let calMonth = new Date();

// ---------- utils ----------
function fmtDate(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function fmtTime(d){
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function escapeHtml(str){
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- storage ----------
function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    records = raw ? JSON.parse(raw) : [];
  }catch(e){ records = []; }

  // 名前を復元
  const savedName = localStorage.getItem(NAME_KEY);
  if(savedName) document.getElementById('worker-name').value = savedName;
}
function save(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }catch(e){ console.error('保存エラー', e); }
}

// ---------- Google Sheets送信 ----------
async function sendToSheet(record){
  if(!GAS_URL) return; // URL未設定なら何もしない
  try{
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(record)
    });
  }catch(e){
    console.warn('シート送信エラー', e);
  }
}

// ---------- header date ----------
function renderHeaderDate(){
  document.getElementById('header-date').textContent =
    new Date().toLocaleDateString('ja-JP', {month:'numeric', day:'numeric', weekday:'short'});
}

// ---------- record view ----------
function renderToday(){
  document.getElementById('today-display').textContent =
    new Date().toLocaleDateString('ja-JP', {month:'long', day:'numeric', weekday:'short'});

  const todayStr = fmtDate(new Date());
  const todays = records.filter(r => r.date === todayStr).sort((a,b)=>a.time.localeCompare(b.time));
  const wrap = document.getElementById('today-records');
  wrap.innerHTML = '';
  if(todays.length === 0){
    wrap.innerHTML = '<p class="empty">まだ記録がありません</p>';
    return;
  }
  todays.forEach(r => wrap.appendChild(recordItemEl(r)));
}

function recordItemEl(r){
  const div = document.createElement('div');
  div.className = 'record-item';
  const icon = r.type === 'in' ? '↗' : '↘';
  const label = r.type === 'in' ? '出社' : '退社';
  div.innerHTML = `<span class="record-icon">${icon}</span>
    <div class="rtext">
      <p class="rtitle">${label} ${r.time}　<span style="font-weight:normal;font-size:12px;">${escapeHtml(r.name)}</span></p>
      <p class="rsite">${escapeHtml(r.site)}</p>
    </div>`;
  return div;
}

async function recordEvent(type){
  const nameInput = document.getElementById('worker-name');
  const siteInput = document.getElementById('site-name');
  const name = nameInput.value.trim();
  const site = siteInput.value.trim();
  const statusEl = document.getElementById('status-msg');

  if(!name){
    statusEl.textContent = 'お名前を入力してください';
    statusEl.className = 'status-err';
    nameInput.focus();
    return;
  }
  if(!site){
    statusEl.textContent = '現場名を入力してください';
    statusEl.className = 'status-err';
    siteInput.focus();
    return;
  }

  // 名前を保存（次回入力省略）
  localStorage.setItem(NAME_KEY, name);

  const now = new Date();
  const record = { date: fmtDate(now), time: fmtTime(now), site, name, type, ts: now.getTime() };
  records.push(record);
  save();

  statusEl.textContent = (type==='in' ? '出社' : '退社') + 'を記録しました（' + fmtTime(now) + '）';
  statusEl.className = 'status-ok';

  // Googleスプレッドシートへ送信
  sendToSheet(record);

  renderToday();
  renderCalendar();
  renderHistory();
}

// ---------- calendar view ----------
function renderCalendar(){
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  document.getElementById('month-label').textContent = y + '年 ' + (m+1) + '月';

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  const dows = ['日','月','火','水','木','金','土'];
  dows.forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'cal-dow';
    cell.textContent = d;
    grid.appendChild(cell);
  });

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const todayStr = fmtDate(new Date());

  for(let i=0;i<firstDay;i++){
    const cell = document.createElement('div');
    cell.className = 'cal-day empty-day';
    grid.appendChild(cell);
  }

  for(let d=1; d<=daysInMonth; d++){
    const dateStr = y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const dayRecords = records.filter(r => r.date === dateStr);
    const hasIn = dayRecords.some(r=>r.type==='in');
    const hasOut = dayRecords.some(r=>r.type==='out');

    const cell = document.createElement('div');
    let cls = 'cal-day';
    if(dateStr === todayStr) cls += ' today';
    if(hasIn && hasOut) cls += ' done';
    else if(hasIn) cls += ' partial';
    cell.className = cls;
    cell.textContent = d;
    cell.addEventListener('click', () => showDayDetail(dateStr, dayRecords));
    grid.appendChild(cell);
  }

  document.getElementById('day-detail').innerHTML = '';
}

function showDayDetail(dateStr, dayRecords){
  const detail = document.getElementById('day-detail');
  const sorted = [...dayRecords].sort((a,b)=>a.time.localeCompare(b.time));
  const dateObj = new Date(dateStr + 'T00:00:00');

  let html = `<p class="day-detail-title">${dateObj.toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short'})}</p>`;
  if(sorted.length === 0){
    html += '<p class="empty">記録なし</p>';
  } else {
    html += '<div>';
    sorted.forEach(r => {
      const icon = r.type === 'in' ? '↗' : '↘';
      const label = r.type === 'in' ? '出社' : '退社';
      html += `<div class="record-item">
        <span class="record-icon">${icon}</span>
        <div class="rtext">
          <p class="rtitle">${label} ${r.time}　<span style="font-weight:normal;font-size:12px;">${escapeHtml(r.name)}</span></p>
          <p class="rsite">${escapeHtml(r.site)}</p>
        </div>
      </div>`;
    });
    html += '</div>';
  }
  detail.innerHTML = html;
}

// ---------- history view ----------
function renderHistory(){
  const wrap = document.getElementById('history-list');
  wrap.innerHTML = '';
  if(records.length === 0){
    wrap.innerHTML = '<p class="empty">記録がありません</p>';
    return;
  }
  const sorted = [...records].sort((a,b)=> b.ts - a.ts);
  let lastDate = null;
  sorted.forEach(r => {
    if(r.date !== lastDate){
      const dateHeader = document.createElement('p');
      dateHeader.className = 'section-title';
      dateHeader.style.marginTop = '12px';
      const dObj = new Date(r.date + 'T00:00:00');
      dateHeader.textContent = dObj.toLocaleDateString('ja-JP', {year:'numeric', month:'long', day:'numeric', weekday:'short'});
      wrap.appendChild(dateHeader);
      lastDate = r.date;
    }
    wrap.appendChild(recordItemEl(r));
  });
}

// ---------- tab switching ----------
function switchTab(tab){
  document.getElementById('view-record').style.display = tab === 'record' ? 'block' : 'none';
  document.getElementById('view-calendar').style.display = tab === 'calendar' ? 'block' : 'none';
  document.getElementById('view-history').style.display = tab === 'history' ? 'block' : 'none';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  if(tab === 'calendar') renderCalendar();
  if(tab === 'history') renderHistory();
}

// ---------- init ----------
document.getElementById('btn-checkin').addEventListener('click', () => recordEvent('in'));
document.getElementById('btn-checkout').addEventListener('click', () => recordEvent('out'));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('prev-month').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()-1, 1);
  renderCalendar();
});
document.getElementById('next-month').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()+1, 1);
  renderCalendar();
});

load();
renderHeaderDate();
renderToday();
renderCalendar();
renderHistory();
