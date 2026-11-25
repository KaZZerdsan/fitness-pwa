// Общие утилиты: форматирование, звук, тосты, графики

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function nowISO() { return new Date().toISOString(); }

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DF = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const DF_SHORT = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });
const TF = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function fmtDate(iso) { return iso ? DF.format(new Date(iso)) : '—'; }
export function fmtDateShort(iso) { return iso ? DF_SHORT.format(new Date(iso)) : '—'; }
export function fmtTime(iso) { return iso ? TF.format(new Date(iso)) : '—'; }

export function plural(n, forms) {
  n = Math.abs(n) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

/** секунды → «1:30» */
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** мс → «43 мин» / «1 ч 05 мин» */
export function fmtDur(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
}

/** [3,0,1,0] → «3-0-1-0» */
export function tempoStr(t) {
  return Array.isArray(t) && t.length === 4 ? t.join('-') : '—';
}

/** строка → число или null */
export function num(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/* ---- зоны нормы анализа ---- */

/**
 * Приводит норму к массиву зон { label, min, max, isNorm }.
 * Понимает старый строковый формат: «130-160», «<6», «>12», «5»
 * и уже готовый массив зон.
 */
export function zonesFromNorm(norm) {
  if (Array.isArray(norm)) {
    return norm.map(z => ({
      label: z.label || '',
      min: z.min ?? null,
      max: z.max ?? null,
      isNorm: !!z.isNorm,
    }));
  }
  if (!norm) return [];
  const s = String(norm).replace(',', '.').trim();
  let m = s.match(/^<=?\s*(\d+(?:\.\d+)?)$/);
  if (m) return [{ label: '', min: null, max: +m[1], isNorm: true }];
  m = s.match(/^>=?\s*(\d+(?:\.\d+)?)$/);
  if (m) return [{ label: '', min: +m[1], max: null, isNorm: true }];
  m = s.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
  if (m) {
    let a = +m[1], b = +m[2];
    if (a > b) [a, b] = [b, a];
    return [{ label: '', min: a, max: b, isNorm: true }];
  }
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return [{ label: '', min: +m[1], max: +m[1], isNorm: true }];
  return [];
}

const fmtZ = v => String(v).replace('.', ',');

/** зона → текст: «< 6», «6–12», «> 12», «5» */
export function zoneText(z) {
  const hasMin = z.min != null, hasMax = z.max != null;
  if (hasMin && hasMax) return z.min === z.max ? fmtZ(z.min) : `${fmtZ(z.min)}–${fmtZ(z.max)}`;
  if (hasMax) return `< ${fmtZ(z.max)}`;
  if (hasMin) return `> ${fmtZ(z.min)}`;
  return '—';
}

/** все зоны одной строкой: «Низкий < 6 · Норма 6–12 · Повышенный > 12» */
export function zonesText(zones) {
  return (zones || []).map(z => (z.label ? `${z.label} ` : '') + zoneText(z)).join(' · ');
}

/** в какую зону попадает значение (null — ни в какую).
 *  Обе границы — включительно; одна граница — строго: «< 6» и «> 12». */
export function matchZone(value, zones) {
  const v = num(value);
  if (v == null) return null;
  for (const z of zones || []) {
    if (z.min != null && z.max != null) {
      if (v >= z.min && v <= z.max) return z;
    } else if (z.max != null) {
      if (v < z.max) return z;
    } else if (z.min != null) {
      if (v > z.min) return z;
    }
  }
  return null;
}

/** статус значения: 'ok' — в нормальной зоне, 'bad' — вне нормы, 'none' — нормы не заданы */
export function valueStatus(value, zones) {
  if (!zones || !zones.length) return 'none';
  const z = matchZone(value, zones);
  if (!z) return 'bad';
  return z.isNorm ? 'ok' : 'bad';
}

/* ---- тосты ---- */
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---- звук и вибрация (офлайн) ---- */
let audioCtx = null;
export function beep() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    [0, 0.22].forEach(off => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(0.35, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.18);
      o.start(t + off); o.stop(t + off + 0.2);
    });
  } catch { /* без звука */ }
}
export function vibrate(pattern = [250, 120, 250]) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* нет вибрации */ }
}

/* ---- диалог подтверждения ---- */
export function confirmAction(msg) {
  return Promise.resolve(window.confirm(msg));
}

/* ---- wake lock (экран не гаснет) ---- */
export async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen');
  } catch { /* не поддерживается */ }
  return null;
}

/* ---- скачивание файла ---- */
export function downloadFile(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---- SVG-график: points = [{x:'25.11', y:40, label:'40×10', out?:bool}] ---- */
export function chartSvg(points) {
  if (!points.length) return '<div class="empty">Нет данных для графика</div>';
  const W = 340, H = 160, P = { l: 36, r: 12, t: 16, b: 22 };
  const ys = points.map(p => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.18;
  min -= pad; max += pad;
  const X = i => points.length === 1 ? (W - P.l - P.r) / 2 + P.l : P.l + i * (W - P.l - P.r) / (points.length - 1);
  const Y = v => P.t + (max - v) / (max - min) * (H - P.t - P.b);
  const fmt = v => Math.round(v * 10) / 10;
  let grid = '';
  for (const f of [0, 0.5, 1]) {
    const val = min + f * (max - min);
    grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(val)}" y2="${Y(val)}" class="grid"/>` +
      `<text x="${P.l - 5}" y="${Y(val) + 3}" class="ax" text-anchor="end">${fmt(val)}</text>`;
  }
  const dots = points.map((p, i) =>
    `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3.4" class="dot${p.out ? ' out' : ''}"/>` +
    `<text x="${X(i)}" y="${Y(p.y) - 8}" class="val" text-anchor="middle">${esc(p.label ?? p.y)}</text>` +
    `<text x="${X(i)}" y="${H - 6}" class="ax" text-anchor="middle">${esc(p.x ?? '')}</text>`
  ).join('');
  const line = points.length > 1
    ? `<polyline points="${points.map((p, i) => `${X(i)},${Y(p.y)}`).join(' ')}" class="line"/>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">${grid}${line}${dots}</svg>`;
}
