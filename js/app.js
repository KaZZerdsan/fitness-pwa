// Роутер приложения: hash-навигация, активная вкладка, immersive-режим
import { esc } from './util.js';
import { render as renderHome } from './views-home.js';
import { render as renderExercises } from './views-exercises.js';
import { render as renderWorkouts, renderWorkoutForm, renderWorkoutView } from './views-workouts.js';
import { renderSession, renderSummary } from './views-session.js';
import { render as renderHistory, renderProgress } from './views-history.js';
import { render as renderHealth, renderRecordForm, renderRecordView, renderAnalysisView } from './views-health.js';

const routes = [
  { re: /^#\/(?:home)?$/, view: renderHome, tab: 'home' },
  { re: /^#\/exercises$/, view: renderExercises, tab: 'exercises' },
  { re: /^#\/workouts$/, view: renderWorkouts, tab: 'workouts' },
  { re: /^#\/workout-form\/([\w-]*)$/, view: renderWorkoutForm, tab: 'workouts' },
  { re: /^#\/workout\/([\w-]+)$/, view: renderWorkoutView, tab: 'workouts' },
  { re: /^#\/session\/([\w-]+)$/, view: renderSession, immersive: true },
  { re: /^#\/summary\/([\w-]+)$/, view: renderSummary, tab: 'home' },
  { re: /^#\/health(?:\/(records|analyses))?$/, view: renderHealth, tab: 'health' },
  { re: /^#\/record-form\/([\w-]*)$/, view: renderRecordForm, tab: 'health' },
  { re: /^#\/record\/([\w-]+)$/, view: renderRecordView, tab: 'health' },
  { re: /^#\/analysis\/([\w-]+)$/, view: renderAnalysisView, tab: 'health' },
  { re: /^#\/history$/, view: renderHistory, tab: 'history' },
  { re: /^#\/progress$/, view: renderProgress, tab: 'history' },
];

let cleanup = null;

function parseRoute() {
  const h = location.hash || '#/home';
  for (const r of routes) {
    const m = h.match(r.re);
    if (m) return { r, arg: m[1] };
  }
  return null;
}

async function renderRoute() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }

  const p = parseRoute();
  if (!p) { location.hash = '#/home'; return; }

  document.body.classList.toggle('immersive', !!p.r.immersive);
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === p.r.tab));

  const view = document.getElementById('view');
  view.innerHTML = '';
  try {
    cleanup = await p.r.view(view, p.arg) || null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><div class="err">Ошибка экрана: ${esc(e.message)}</div></div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', renderRoute);
renderRoute();
