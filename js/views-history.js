// История завершённых тренировок + прогресс по упражнению
import { db } from './db.js';
import { esc, fmtDate, fmtDur, fmtDateShort, chartSvg, plural } from './util.js';
import { getWorkouts, blockHasDiff } from './workout-ops.js';

export async function render(root) {
  const workouts = (await getWorkouts())
    .filter(w => w.status === 'completed')
    .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''));

  root.innerHTML = `
    <div class="page-title row between">
      <span>История</span>
      <a class="btn sm ghost" href="#/progress">📈 Прогресс</a>
    </div>
    ${workouts.length ? workouts.map(w => {
      const diffCount = (w.blocks || []).filter((b, i) => blockHasDiff(b, w.actualBlocks?.[i])).length;
      return `
        <div class="card click" data-id="${w.id}">
          <div class="row between">
            <div class="grow">
              <b style="font-size:16px">${esc(w.name)}</b>
              <div class="muted small">${fmtDate(w.finishedAt)}${w.startedAt ? ' · ' + fmtDur(new Date(w.finishedAt) - new Date(w.startedAt)) : ''}</div>
            </div>
            <div style="text-align:right">
              ${diffCount
                ? `<span class="badge b-out">Δ ${diffCount} ${plural(diffCount, ['блок', 'блока', 'блоков'])}</span>`
                : '<span class="badge b-ok">по плану</span>'}
              ${w.stats?.calories ? `<div class="muted small" style="margin-top:4px">🔥 ${esc(w.stats.calories)} ккал</div>` : ''}
            </div>
          </div>
        </div>`;
    }).join('')
    : '<div class="empty"><span class="big">📚</span>Завершённых тренировок пока нет.<br>Первая появится здесь после выполнения.</div>'}
  `;

  root.querySelectorAll('[data-id]').forEach(c => c.addEventListener('click', () => {
    location.hash = `#/workout/${c.dataset.id}`;
  }));
}

/* ---- прогресс по упражнению ---- */
export async function renderProgress(root) {
  const [workouts, exercises] = await Promise.all([getWorkouts(), db.getAll('exercises')]);
  const done = workouts.filter(w => w.status === 'completed')
    .sort((a, b) => (a.finishedAt || '').localeCompare(b.finishedAt || ''));

  // упражнения с фактическими данными (по элементам суперсетов и их подходам)
  const byEx = new Map(); // exerciseId -> [{w, item, fItem}]
  for (const w of done) {
    (w.blocks || []).forEach((b, i) => {
      const f = w.actualBlocks?.[i];
      if (!f || f.skipped) return;
      b.items.forEach((it, j) => {
        const fi = f.items?.[j];
        if (!fi) return;
        if (!byEx.has(it.exerciseId)) byEx.set(it.exerciseId, []);
        byEx.get(it.exerciseId).push({ w, item: it, fItem: fi });
      });
    });
  }

  const opts = [...byEx.entries()]
    .map(([id, arr]) => ({ id, name: exercises.find(e => e.id === id)?.name || 'Упражнение удалено', n: arr.length }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  root.innerHTML = `
    <div class="page-title row between">
      <span>Прогресс</span>
      <a class="btn sm ghost" href="#/history">← История</a>
    </div>
    ${opts.length ? `
      <div class="card">
        <div class="field">
          <label>Упражнение</label>
          <select id="p-ex">${opts.map(o => `<option value="${o.id}">${esc(o.name)} (${o.n})</option>`).join('')}</select>
        </div>
        <div id="p-chart"></div>
      </div>
      <div id="p-table"></div>`
    : '<div class="empty"><span class="big">📈</span>Пока нет завершённых тренировок с фактом.<br>Данные появятся после первых тренировок.</div>'}
  `;

  if (!opts.length) return;

  const fmtKg = v => String(v).replace('.', ',');

  const draw = () => {
    const id = root.querySelector('#p-ex').value;
    const arr = byEx.get(id) || [];
    // по тренировке берём подход с максимальным фактическим весом
    const perWorkout = new Map();
    for (const e of arr) {
      for (const fs of (e.fItem.actualSets || [])) {
        if (fs.skipped) continue;
        const cur = perWorkout.get(e.w.id);
        if (!cur || (+fs.weight || 0) > (+cur.fs.weight || 0)) perWorkout.set(e.w.id, { w: e.w, fs });
      }
    }
    const pts = [...perWorkout.values()].map(({ w, fs }) => ({
      x: fmtDateShort(w.finishedAt),
      y: +fs.weight || 0,
      label: `${fmtKg(fs.weight)}×${fs.reps}`,
    }));
    root.querySelector('#p-chart').innerHTML = chartSvg(pts);

    const name = opts.find(o => o.id === id)?.name || '';
    root.querySelector('#p-table').innerHTML = `
      <div class="section-title">${esc(name)} — все выполнения</div>
      ${arr.slice().reverse().map(({ w, item, fItem }) => {
        const fact = (fItem.actualSets || []).map(s => s.skipped ? '✕' : `${fmtKg(s.weight)}×${s.reps}`).join(', ');
        const plan = item.setsList.map(s => `${fmtKg(s.weight)}×${s.reps}`).join(', ');
        return `
        <div class="card">
          <div class="row between">
            <div class="grow">
              <b>${esc(w.name)}</b>
              <div class="muted small">${fmtDate(w.finishedAt)}</div>
            </div>
            <div style="text-align:right">
              <b>${fact}</b>
              <div class="muted small">план: ${plan}</div>
            </div>
          </div>
        </div>`;
      }).join('')}`;
  };

  root.querySelector('#p-ex').addEventListener('change', draw);
  draw();
}
