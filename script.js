/* Daily Routine Tracker
 * State shape:
 *   tasks: [{ id, name }]                       master list, drives today onward
 *   days:  { 'YYYY-MM-DD': [{ id, name, done }] }  frozen snapshot per day
 * Each day stores its own roster so renaming or deleting a task never rewrites history.
 *
 * Storage: localStorage, written on every change. Export/Import Backup (.json)
 * moves the data between browsers or machines.
 */

const STORAGE_KEY = 'routineTracker.v1';

// Starter list for a first run only; after that the saved list is used.
// Empty means the app opens with no tasks and the user adds their own.
const DEFAULT_TASKS = [];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

let state = { tasks: [], days: {} };

/* ---------- date helpers (local time, never UTC) ---------- */

function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const todayKey = () => dateKey(new Date());

/* ---------- storage ---------- */

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.tasks) && saved.days
      ? { tasks: saved.tasks, days: saved.days }
      : null;
  } catch {
    return null;
  }
}

function load() {
  state = readSaved() || {
    tasks: DEFAULT_TASKS.map((name, i) => ({ id: `t${i}`, name })),
    days: {}
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tasks: state.tasks,
      days: state.days
    }));
  } catch (err) {
    console.error('Could not save routine data:', err);
  }
}

function newId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ---------- day snapshots ---------- */

// Bring today's snapshot in line with the master task list: add new tasks,
// drop deleted ones, pick up renames — all while preserving checked state.
function syncToday() {
  const key = todayKey();
  const previous = state.days[key] || [];
  const doneById = new Map(previous.map(t => [t.id, t.done]));

  state.days[key] = state.tasks.map(t => ({
    id: t.id,
    name: t.name,
    done: doneById.get(t.id) === true
  }));
}

const todayEntries = () => state.days[todayKey()] || [];

function percentFor(entries) {
  if (!entries.length) return 0;
  const done = entries.filter(t => t.done).length;
  return Math.round((done / entries.length) * 100);
}

function bandOf(percent) {
  if (percent >= 80) return 'good';
  if (percent >= 50) return 'ok';
  return 'bad';
}

const cssColor = name =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

/* ---------- task manager ---------- */

const taskManager = document.getElementById('taskManager');

function renderTaskManager() {
  taskManager.innerHTML = '';

  if (!state.tasks.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No routine tasks yet. Add one above to get started.';
    taskManager.appendChild(li);
    return;
  }

  state.tasks.forEach(task => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = task.name;

    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => renameTask(task.id));

    const remove = document.createElement('button');
    remove.className = 'icon-btn danger';
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => deleteTask(task.id));

    li.append(name, edit, remove);
    taskManager.appendChild(li);
  });
}

function addTask(name) {
  state.tasks.push({ id: newId(), name });
  commit();
}

function renameTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  const next = prompt('Rename task:', task.name);
  if (next === null) return;

  const trimmed = next.trim();
  if (!trimmed) return;

  task.name = trimmed;
  commit();
}

function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (!confirm(`Delete "${task.name}"? Past days keep their record.`)) return;

  state.tasks = state.tasks.filter(t => t.id !== id);
  commit();
}

/* ---------- today's checklist ---------- */

const checklistBody = document.getElementById('checklistBody');

function renderChecklist() {
  const entries = todayEntries();
  checklistBody.innerHTML = '';

  if (!entries.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = 'No tasks for today. Add a routine task to build your checklist.';
    row.appendChild(cell);
    checklistBody.appendChild(row);
    return;
  }

  const percent = percentFor(entries);
  const key = todayKey();

  entries.forEach(entry => {
    const row = document.createElement('tr');

    const date = document.createElement('td');
    date.className = 'cell-date';
    date.textContent = key;

    const name = document.createElement('td');
    name.className = 'task-name';
    name.textContent = entry.name;

    const status = document.createElement('td');
    status.className = 'cell-status';
    const badge = document.createElement('span');
    status.appendChild(badge);
    const paintBadge = () => {
      badge.className = `badge ${entry.done ? 'done' : 'pending'}`;
      badge.textContent = entry.done ? 'Completed' : 'Pending';
    };
    paintBadge();

    const checkCell = document.createElement('td');
    checkCell.className = 'center';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = entry.done;
    box.setAttribute('aria-label', `Mark ${entry.name} complete`);
    // Update in place rather than via commit(): a full re-render would replace
    // this checkbox and drop the user's focus mid-interaction.
    box.addEventListener('change', () => {
      entry.done = box.checked;
      paintBadge();
      save();
      refreshDerived();
    });
    checkCell.appendChild(box);

    const pct = document.createElement('td');
    pct.className = 'right row-percent';
    pct.textContent = `${percent}%`;

    row.append(date, name, checkCell, status, pct);
    checklistBody.appendChild(row);
  });
}

// Everything downstream of a checkbox toggle, minus the checklist rebuild.
function refreshDerived() {
  const percent = `${percentFor(todayEntries())}%`;
  checklistBody.querySelectorAll('.row-percent').forEach(cell => {
    cell.textContent = percent;
  });
  renderProgress();
  renderMonthly();
  renderChart();
}

function renderProgress() {
  const entries = todayEntries();
  const percent = percentFor(entries);
  const done = entries.filter(t => t.done).length;

  const fill = document.getElementById('progressFill');
  fill.style.width = `${percent}%`;
  fill.className = `progress-fill ${bandOf(percent)}`;

  document.getElementById('progressPercent').textContent = `${percent}%`;
  document.getElementById('progressSummary').textContent = entries.length
    ? `${done} of ${entries.length} tasks completed today.`
    : 'Add tasks to start tracking.';
}

function resetToday() {
  if (!confirm("Uncheck every task for today?")) return;
  todayEntries().forEach(entry => { entry.done = false; });
  commit();
}

/* ---------- monthly report ---------- */

const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');

function populateMonths() {
  MONTH_NAMES.forEach((name, i) => {
    monthSelect.add(new Option(name, String(i)));
  });
  monthSelect.value = String(new Date().getMonth());
}

// Rebuilt whenever data arrives from a file, so imported history gets its years.
function populateYears() {
  const now = new Date();
  const chosen = yearSelect.value;

  // Cover every year that has data, plus the current one, plus next year.
  const years = new Set(Object.keys(state.days).map(k => Number(k.slice(0, 4))));
  years.add(now.getFullYear());
  years.add(now.getFullYear() + 1);

  const sorted = [...years].sort((a, b) => a - b);
  yearSelect.innerHTML = '';
  sorted.forEach(y => yearSelect.add(new Option(String(y), String(y))));

  // Keep the user's pick if it survived the rebuild.
  yearSelect.value = sorted.map(String).includes(chosen) ? chosen : String(now.getFullYear());
}

// One entry per day of the selected month that has a snapshot.
function daysInSelectedMonth() {
  const month = Number(monthSelect.value);
  const year = Number(yearSelect.value);
  const total = new Date(year, month + 1, 0).getDate();
  const out = [];

  for (let day = 1; day <= total; day++) {
    const entries = state.days[dateKey(new Date(year, month, day))];
    if (entries && entries.length) {
      out.push({
        day,
        completed: entries.filter(t => t.done).length,
        total: entries.length,
        percent: percentFor(entries)
      });
    }
  }
  return { daysInMonth: total, records: out };
}

function renderMonthly() {
  const { records } = daysInSelectedMonth();

  const completed = records.reduce((sum, r) => sum + r.completed, 0);
  const available = records.reduce((sum, r) => sum + r.total, 0);
  const missed = available - completed;

  const monthly = available ? Math.round((completed / available) * 100) : 0;
  const average = records.length
    ? Math.round(records.reduce((sum, r) => sum + r.percent, 0) / records.length)
    : 0;

  document.getElementById('statMonthly').textContent = `${monthly}%`;
  document.getElementById('statDays').textContent = records.length;
  document.getElementById('statCompleted').textContent = completed;
  document.getElementById('statMissed').textContent = missed;
  document.getElementById('statAverage').textContent = `${average}%`;
}

/* ---------- bar chart ---------- */

const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');

function renderChart() {
  const { daysInMonth, records } = daysInSelectedMonth();
  const byDay = new Map(records.map(r => [r.day, r.percent]));

  const empty = document.getElementById('chartEmpty');
  empty.textContent = records.length
    ? ''
    : 'No data tracked for this month yet.';

  // Match the backing store to the CSS box so bars stay crisp on any display.
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 16, right: 12, bottom: 28, left: 38 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  if (plotW <= 0 || plotH <= 0) return;

  const muted = cssColor('muted');
  const border = cssColor('border');
  const yOf = percent => padding.top + plotH - (percent / 100) * plotH;

  // Gridlines and y-axis labels every 25%.
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;

  for (let p = 0; p <= 100; p += 25) {
    const y = Math.round(yOf(p)) + 0.5;
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotW, y);
    ctx.stroke();

    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${p}%`, padding.left - 8, y);
  }

  // Bars, one slot per calendar day so gaps read as missed days.
  const slot = plotW / daysInMonth;
  const barW = Math.max(2, Math.min(26, slot * 0.62));
  // Thin out labels until they fit the available width.
  const labelStep = Math.ceil(22 / slot) || 1;

  ctx.textAlign = 'center';

  for (let day = 1; day <= daysInMonth; day++) {
    const cx = padding.left + slot * (day - 0.5);
    const percent = byDay.get(day);

    if (percent !== undefined) {
      const y = yOf(percent);
      const h = Math.max(percent > 0 ? 2 : 0, padding.top + plotH - y);
      ctx.fillStyle = cssColor(bandOf(percent));
      ctx.beginPath();
      ctx.roundRect(cx - barW / 2, padding.top + plotH - h, barW, h, 3);
      ctx.fill();
    }

    if (day === 1 || day % labelStep === 0) {
      ctx.fillStyle = muted;
      ctx.textBaseline = 'top';
      ctx.fillText(String(day), cx, padding.top + plotH + 8);
      ctx.textBaseline = 'middle';
    }
  }

  // Baseline.
  ctx.strokeStyle = muted;
  ctx.beginPath();
  ctx.moveTo(padding.left, Math.round(padding.top + plotH) + 0.5);
  ctx.lineTo(padding.left + plotW, Math.round(padding.top + plotH) + 0.5);
  ctx.stroke();
}

/* ---------- export ---------- */

function buildExport() {
  const lines = [];
  lines.push('DAILY ROUTINE TRACKER — DATA EXPORT');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('='.repeat(52));
  lines.push('');

  const keys = Object.keys(state.days).sort();
  if (!keys.length) {
    lines.push('No data recorded yet.');
    return lines.join('\n');
  }

  let grandCompleted = 0;
  let grandTotal = 0;

  keys.forEach(key => {
    const entries = state.days[key];
    if (!entries.length) return;

    const completed = entries.filter(t => t.done).length;
    grandCompleted += completed;
    grandTotal += entries.length;

    lines.push(`Date: ${key}`);
    entries.forEach(entry => {
      lines.push(`  [${entry.done ? 'x' : ' '}] ${entry.name} — ${entry.done ? 'Completed' : 'Not Completed'}`);
    });
    lines.push(`  Daily Achievement: ${percentFor(entries)}%  (${completed}/${entries.length} tasks)`);
    lines.push('-'.repeat(52));
  });

  const overall = grandTotal ? Math.round((grandCompleted / grandTotal) * 100) : 0;
  lines.push('');
  lines.push('OVERALL SUMMARY');
  lines.push(`Days tracked:    ${keys.length}`);
  lines.push(`Tasks completed: ${grandCompleted}`);
  lines.push(`Tasks missed:    ${grandTotal - grandCompleted}`);
  lines.push(`Overall achievement: ${overall}%`);

  return lines.join('\n');
}

/* ---------- backups ----------
 * localStorage survives reboots and (with persist()) low-storage eviction, but
 * not "clear site data", uninstall, or a lost phone. The only real protection is
 * a copy off the device, so the app tracks how stale that copy is and nags. */

const BACKUP_KEY = 'routineTracker.lastBackup';
const NAG_AFTER_DAYS = 7;

function lastBackupAt() {
  try {
    const iso = localStorage.getItem(BACKUP_KEY);
    return iso ? new Date(iso) : null;
  } catch {
    return null;
  }
}

function markBackedUp() {
  try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch {}
  renderBackupUI();
}

const daysSince = date => Math.floor((Date.now() - date.getTime()) / 86400000);

function backupAgeText() {
  const at = lastBackupAt();
  if (!at) return null;
  const days = daysSince(at);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// Nag once there's something worth losing, not on day one.
function shouldNagAboutBackup() {
  const trackedDays = Object.keys(state.days).length;
  if (trackedDays < 2) return false;
  const at = lastBackupAt();
  return !at || daysSince(at) >= NAG_AFTER_DAYS;
}

/* The share sheet is the useful path on Android: it hands the file to Google
 * Drive, WhatsApp, email — a copy that survives losing the phone. Desktop has no
 * file share target, so it falls back to a download. */
async function backupNow() {
  const text = serializeBackup();
  const name = `routine-backup-${todayKey()}.json`;
  const file = new File([text], name, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Daily Routine Tracker backup' });
      markBackedUp();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user dismissed the sheet
      console.warn('Share failed, downloading instead:', err);
    }
  }

  download(text, name, 'application/json');
  markBackedUp();
}

/* ---------- backup UI ---------- */

const backupNotice = document.getElementById('backupNotice');
const backupNoticeTitle = document.getElementById('backupNoticeTitle');
const backupNoticeBody = document.getElementById('backupNoticeBody');
const backupStatus = document.getElementById('backupStatus');
const backupDot = document.getElementById('backupDot');

function renderBackupUI() {
  const age = backupAgeText();
  const trackedDays = Object.keys(state.days).length;

  backupStatus.textContent = age ? `Last backup: ${age}` : 'Never backed up';
  backupDot.className = 'dot ' + (!age ? 'off' : daysSince(lastBackupAt()) >= NAG_AFTER_DAYS ? 'pending' : 'saved');

  const nag = shouldNagAboutBackup();
  backupNotice.hidden = !nag;
  if (!nag) return;

  backupNoticeTitle.textContent = age ? `Last backup was ${age}` : 'Your data has no backup yet';
  backupNoticeBody.textContent = age
    ? `${trackedDays} days of history live only on this device. Save a copy somewhere safe.`
    : `${trackedDays} days of history live only on this device. If you clear browser data or lose the phone, it's gone.`;
}

function download(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportData() {
  download(buildExport(), `routine-tracker-${todayKey()}.txt`, 'text/plain;charset=utf-8');
}

// The .json backup round-trips exactly; the .txt report is for reading, not reimport.
function serializeBackup() {
  return JSON.stringify({
    app: 'Daily Routine Tracker',
    version: 1,
    savedAt: new Date().toISOString(),
    tasks: state.tasks,
    days: state.days
  }, null, 2);
}


// Accept only a shape we can actually run on, so a wrong file can't wipe good data.
function parseBackup(text) {
  const parsed = JSON.parse(text);
  const ok = parsed && Array.isArray(parsed.tasks) && parsed.days &&
    typeof parsed.days === 'object' && !Array.isArray(parsed.days);
  if (!ok) throw new Error('This file is not a Routine Tracker backup.');
  return { tasks: parsed.tasks, days: parsed.days };
}

async function importJson(file) {
  if (!file) return;
  try {
    state = parseBackup(await file.text());
    syncToday();
    populateYears();
    save();
    render();
    alert(`Imported ${file.name}`);
  } catch (err) {
    alert(`Could not import that file.\n\n${err.message}`);
  }
}

/* ---------- PWA ---------- */

// Ask Android not to evict our data when storage runs low. Installed PWAs are
// normally granted this without prompting; if it's refused the app still works,
// the data is just evictable — which is what Export Backup (.json) is for.
async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return;
  try {
    if (await navigator.storage.persisted()) return;
    const granted = await navigator.storage.persist();
    console.info(granted
      ? 'Storage is persistent — the browser will not evict your routine data.'
      : 'Storage is not persistent; the browser may clear data if the device runs low. Export a backup to be safe.');
  } catch (err) {
    console.warn('Could not request persistent storage:', err);
  }
}

// Service workers need http(s); opening index.html directly is file:// and skips this.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) {
    console.info('Service worker skipped (needs http/https — serve the folder to enable offline).');
    return;
  }
  navigator.serviceWorker.register('sw.js')
    .then(reg => console.info('Service worker registered, scope:', reg.scope))
    .catch(err => console.warn('Service worker registration failed:', err));
}

/* ---------- view routing ---------- */

const VIEWS = ['home', 'tasks', 'report'];

function showView(name) {
  const view = VIEWS.includes(name) ? name : 'home';

  VIEWS.forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === view);
  });
  document.querySelectorAll('.tab').forEach(tab => {
    const on = tab.dataset.view === view;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-current', on ? 'page' : 'false');
  });

  // The canvas has no size while hidden, so the chart must be drawn after
  // the report view becomes visible — not on initial render.
  if (view === 'report') renderChart();

  window.scrollTo(0, 0);
}

const viewFromHash = () => window.location.hash.replace('#', '');

/* ---------- wiring ---------- */

function render() {
  renderTaskManager();
  renderChecklist();
  renderProgress();
  renderMonthly();
  renderChart();
  renderBackupUI();
}

// Every mutation funnels through here: snapshot, persist, redraw.
function commit() {
  syncToday();
  save();
  render();
}

function init() {
  registerServiceWorker();
  requestPersistentStorage();

  load();
  syncToday();
  save();

  document.getElementById('todayLabel').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  populateMonths();
  populateYears();
  render();
  showView(viewFromHash());
  window.addEventListener('hashchange', () => showView(viewFromHash()));

  document.getElementById('addTaskForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.getElementById('taskInput');
    const name = input.value.trim();
    if (!name) return;
    addTask(name);
    input.value = '';
    input.focus();
  });

  document.getElementById('resetDayBtn').addEventListener('click', resetToday);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('backupBtn').addEventListener('click', backupNow);
  document.getElementById('backupNowBtn').addEventListener('click', backupNow);

  const importInput = document.getElementById('importInput');
  document.getElementById('importBtn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    importJson(importInput.files[0]);
    importInput.value = ''; // let the same file be picked again
  });


  monthSelect.addEventListener('change', () => { renderMonthly(); renderChart(); });
  yearSelect.addEventListener('change', () => { renderMonthly(); renderChart(); });

  window.addEventListener('resize', renderChart);
}

init();
