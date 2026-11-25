// Главный экран: активная тренировка или список предстоящих + бэкап
import { db, exportAll, importAll } from './db.js';
import { esc, fmtDate, fmtTime, fmtDur, todayISO, toast, confirmAction, downloadFile, plural } from './util.js';
import { startWorkout, cancelWorkout } from './workout-ops.js';

function rerender() { window.dispatchEvent(new HashChangeEvent('hashchange')); }

export async function render(root) {
  const [workouts, exercises] = await Promise.all([db.getAll('workouts'), db.getAll('exercises')]);
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));
  const active = workouts.find(w => w.status === 'in_progress');
  const upcoming = workouts.filter(w => w.status === 'created')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const lastDone = workouts.filter(w => w.status === 'completed')
    .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''))[0];

  const blocksInfo = w => {
    const n = (w.blocks || []).length;
    return `${n} ${plural(n, ['блок', 'блока', 'блоков'])}`;
  };

  let html = '';

  if (active) {
    const b = active.blocks?.[active.progress?.blockIndex ?? 0] || active.blocks?.[0];
    const totalSets = (active.blocks || []).reduce((s, x) => s + (+x.sets || 0), 0);
    const doneSets = (active.blocks || []).slice(0, active.progress?.blockIndex ?? 0)
      .reduce((s, x) => s + (+x.sets || 0), 0) + (active.progress?.setIndex ?? 0);
    const pct = totalSets ? Math.round(doneSets / totalSets * 100) : 0;
    html += `
      <div class="card" style="border-color: var(--warn)">
        <div class="row between">
          <span class="badge b-progress">● Идёт тренировка</span>
          <span class="muted small">с ${fmtTime(active.startedAt)}</span>
        </div>
        <div class="s-ex-name" style="margin-top:8px">${esc(active.name)}</div>
        ${b ? `<div class="muted">${esc(exMap[b.exerciseId] || 'Упражнение')} · подход ${(active.progress?.setIndex ?? 0) + 1} из ${+b.sets || 0}</div>` : ''}
        <div class="progress-track" style="margin:12px 0 6px"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="muted small">${doneSets} из ${totalSets} подходов · ${pct}%</div>
        <div class="btn-row">
          <a class="btn primary xl" href="#/session/${active.id}">Продолжить</a>
        </div>
        <div class="btn-row">
          <a class="btn ghost sm" href="#/summary/${active.id}">Завершить и подвести итоги</a>
          <button class="btn danger sm" id="btn-cancel-active">Отменить</button>
        </div>
      </div>`;
  } else {
    html += `<div class="page-title">Тренировки</div>`;
    html += `<div class="section-title">Предстоящие</div>`;
    if (upcoming.length) {
      html += upcoming.map(w => `
        <div class="card click" data-open="${w.id}">
          <div class="row between">
            <div class="grow">
              <b style="font-size:16.5px">${esc(w.name)}</b>
              <div class="muted small">${blocksInfo(w)}</div>
            </div>
            <button class="btn primary sm" data-start="${w.id}">▶ Начать</button>
          </div>
        </div>`).join('');
    } else {
      html += `<div class="empty"><span class="big">🏋️</span>Нет запланированных тренировок.<br>Создайте первую — и в зал!</div>`;
    }
    html += `<a class="btn ghost" style="width:100%" href="#/workout-form/">+ Создать тренировку</a>`;
  }

  if (lastDone) {
    html += `
      <div class="section-title">Последняя завершённая</div>
      <div class="card click" data-open-done="${lastDone.id}">
        <div class="row between">
          <div class="grow">
            <b>${esc(lastDone.name)}</b>
            <div class="muted small">${fmtDate(lastDone.finishedAt)} · ${fmtDur(new Date(lastDone.finishedAt) - new Date(lastDone.startedAt || lastDone.finishedAt))}</div>
          </div>
          ${lastDone.stats?.calories ? `<span class="badge b-ok">🔥 ${esc(lastDone.stats.calories)} ккал</span>` : ''}
        </div>
        ${lastDone.stats?.avgHr ? `<div class="muted small" style="margin-top:4px">Средняя ЧСС: ${esc(lastDone.stats.avgHr)} уд/мин</div>` : ''}
      </div>`;
  }

  // Резервная копия
  html += `
    <div class="section-title">Данные</div>
    <div class="card">
      <div class="muted small" style="margin-bottom:10px">Все данные хранятся только на этом устройстве. Периодически сохраняйте резервную копию.</div>
      <div class="row">
        <button class="btn grow" id="btn-export">Экспорт JSON</button>
        <button class="btn grow" id="btn-import">Импорт JSON</button>
      </div>
      <input type="file" id="file-import" accept=".json,application/json" hidden>
    </div>`;

  root.innerHTML = html;

  root.querySelectorAll('[data-start]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const w = workouts.find(x => x.id === btn.dataset.start);
    if (!w) return;
    await startWorkout(w);
    location.hash = `#/session/${w.id}`;
  }));
  root.querySelectorAll('[data-open]').forEach(card => card.addEventListener('click', () => {
    location.hash = `#/workout-form/${card.dataset.open}`;
  }));
  root.querySelectorAll('[data-open-done]').forEach(card => card.addEventListener('click', () => {
    location.hash = `#/workout/${card.dataset.openDone}`;
  }));

  root.querySelector('#btn-cancel-active')?.addEventListener('click', async () => {
    if (await confirmAction('Отменить выполнение? Тренировка вернётся в статус «создана», прогресс будет сброшен.')) {
      await cancelWorkout(active);
      toast('Выполнение отменено');
      rerender();
    }
  });

  root.querySelector('#btn-export')?.addEventListener('click', async () => {
    const data = await exportAll();
    downloadFile(`trenazhorka-backup-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Резервная копия сохранена');
  });

  const fileInput = root.querySelector('#file-import');
  root.querySelector('#btn-import')?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const n = await importAll(data);
      toast(`Импортировано записей: ${n}`);
      rerender();
    } catch (e) {
      toast('Не удалось импортировать: ' + e.message);
    }
  });
}
