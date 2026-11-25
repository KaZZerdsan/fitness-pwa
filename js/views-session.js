// Выполнение тренировки + экран итогов
import { db } from './db.js';
import { esc, toast, confirmAction, fmtClock, fmtDur, tempoStr, num, nowISO, beep, vibrate, acquireWakeLock } from './util.js';
import { cancelWorkout } from './workout-ops.js';

/* ==================== ВЫПОЛНЕНИЕ ==================== */
export async function renderSession(root, id) {
  const [w, exercises] = await Promise.all([db.get('workouts', id), db.getAll('exercises')]);
  if (!w || w.status !== 'in_progress') { location.hash = '#/home'; return; }
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e]));

  w.progress ??= { blockIndex: 0, setIndex: 0, restEndsAt: null };
  w.progress.blockIndex = Math.min(w.progress.blockIndex, Math.max(0, w.blocks.length - 1));
  w.progress.setIndex = Math.min(w.progress.setIndex, 1e9);

  root.innerHTML = `
    <div class="session-top">
      <button class="btn icon" id="s-exit" title="Свернуть">✕</button>
      <div class="grow">
        <b>${esc(w.name)}</b>
        <div class="muted small" style="margin-top:2px"><span id="s-blocknum"></span> · ⏱ <span id="s-elapsed"></span></div>
      </div>
      <button class="btn sm ghost" id="s-finish">Завершить</button>
    </div>
    <div class="progress-track"><div class="progress-fill" id="s-bar"></div></div>

    <div id="s-main">
      <div class="s-ex-name" id="s-ex"></div>
      <div class="s-meta" id="s-ex-note"></div>
      <div id="s-video"></div>

      <div class="s-center">
        <div class="big-weight" id="s-weight"></div>
        <div class="s-targets">
          <div class="stat"><div class="v" id="s-reps"></div><div class="k">повторений</div></div>
          <div class="stat"><div class="v" id="s-tempo"></div><div class="k">темп</div></div>
          <div class="stat"><div class="v" id="s-rest"></div><div class="k">отдых, с</div></div>
        </div>
        <div class="tempo-legend">опускание — пауза — поднятие — пауза</div>
      </div>

      <div class="s-set">
        <b style="font-size:18px" id="s-setnum"></b>
        <div class="set-dots" id="s-dots"></div>
      </div>

      <div class="rest-card" id="rest-card" style="display:none">
        <div class="rest-ring">
          <svg width="150" height="150" viewBox="0 0 150 150">
            <circle class="track" cx="75" cy="75" r="62" fill="none" stroke-width="9"/>
            <circle class="bar" id="rest-bar" cx="75" cy="75" r="62" fill="none" stroke-width="9"
              stroke-linecap="round" stroke-dasharray="389.6" stroke-dashoffset="0"/>
          </svg>
          <div class="rest-time"><span id="rest-time">0:00</span><span class="k">отдых</span></div>
        </div>
        <div class="row" style="justify-content:center;gap:10px">
          <button class="btn sm" id="rest-plus15">+15 сек</button>
          <button class="btn sm ghost" id="rest-skip">Пропустить отдых</button>
        </div>
      </div>
      <div class="rest-done" id="rest-done" style="display:none">✅ Отдых окончен — выполняйте подход</div>

      <button class="btn primary xl" id="s-mark" style="margin-top:10px">✓ Подход выполнен</button>
      <div class="btn-row">
        <button class="btn ghost sm" id="s-prev">← Пред. блок</button>
        <button class="btn ghost sm" id="s-next">Пропустить блок →</button>
      </div>
      <button class="btn danger sm" id="s-cancel" style="margin-top:14px">Отменить тренировку</button>
    </div>`;

  const $ = s => root.querySelector(s);
  const RING_C = 389.6;
  let timer = null;
  let wakeLock = null;

  const curBlock = () => w.blocks[w.progress.blockIndex];
  const isLastBlock = () => w.progress.blockIndex >= w.blocks.length - 1;

  const persist = () => db.put('workouts', w);

  /* ---- отдых ---- */
  function restVisible(on) {
    $('#rest-card').style.display = on ? '' : 'none';
    if (!on) $('#rest-done').style.display = 'none';
  }
  function startRest(sec) {
    if (!sec || sec <= 0) return;
    w.progress.restEndsAt = Date.now() + sec * 1000;
    persist();
    restVisible(true);
  }
  function endRest(notify = true) {
    const had = w.progress.restEndsAt;
    w.progress.restEndsAt = null;
    persist();
    restVisible(false);
    if (had && notify) {
      beep();
      vibrate();
      $('#rest-done').style.display = '';
      setTimeout(() => { $('#rest-done').style.display = 'none'; }, 6000);
    }
  }
  function tick() {
    // прошедшее время
    if (w.startedAt) $('#s-elapsed').textContent = fmtClock((Date.now() - new Date(w.startedAt).getTime()) / 1000);
    // таймер отдыха
    if (w.progress.restEndsAt) {
      const leftMs = w.progress.restEndsAt - Date.now();
      if (leftMs <= 0) { endRest(true); return; }
      const total = curBlock()?.restSec || 60;
      const left = leftMs / 1000;
      $('#rest-time').textContent = fmtClock(left);
      const frac = Math.min(1, left / Math.max(1, total));
      $('#rest-bar').style.strokeDashoffset = String(RING_C * (1 - frac));
    }
  }

  /* ---- отрисовка текущего блока ---- */
  function renderUI() {
    const b = curBlock();
    if (!b) return;
    const p = w.progress;
    $('#s-blocknum').textContent = `Блок ${p.blockIndex + 1} из ${w.blocks.length}`;
    const ex = exMap[b.exerciseId];
    $('#s-ex').textContent = ex?.name || 'Упражнение удалено';
    $('#s-ex-note').textContent = b.title ? `💬 ${b.title}` : '';
    $('#s-video').innerHTML = ex?.videoUrl
      ? `<a class="icon-link" href="${esc(ex.videoUrl)}" target="_blank" rel="noopener">▶ Посмотреть видео</a>`
      : '';
    $('#s-weight').innerHTML = `${esc(String(b.weight).replace('.', ','))} <span>кг</span>`;
    $('#s-reps').textContent = b.reps;
    $('#s-tempo').textContent = tempoStr(b.tempo);
    $('#s-rest').textContent = b.restSec;

    const done = p.setIndex >= b.sets;
    $('#s-setnum').textContent = done
      ? (isLastBlock() ? 'Блок выполнен!' : 'Блок выполнен!')
      : `Подход ${p.setIndex + 1} из ${b.sets}`;
    $('#s-dots').innerHTML = Array.from({ length: +b.sets || 0 }, (_, i) =>
      `<span class="set-dot ${i < p.setIndex ? 'done' : i === p.setIndex ? 'now' : ''}"></span>`).join('');

    const totalSets = w.blocks.reduce((s, x) => s + (+x.sets || 0), 0);
    const doneSets = w.blocks.slice(0, p.blockIndex).reduce((s, x) => s + (+x.sets || 0), 0) + Math.min(p.setIndex, +b.sets || 0);
    $('#s-bar').style.width = (totalSets ? Math.round(doneSets / totalSets * 100) : 0) + '%';

    $('#s-mark').textContent = done
      ? (isLastBlock() ? 'Завершить тренировку →' : 'Следующий блок →')
      : '✓ Подход выполнен';

    if (!w.progress.restEndsAt) restVisible(false);
  }

  /* ---- переходы ---- */
  function goBlock(idx) {
    w.progress.blockIndex = Math.max(0, Math.min(idx, w.blocks.length - 1));
    w.progress.setIndex = 0;
    w.progress.restEndsAt = null;
    restVisible(false);
    persist();
    renderUI();
  }
  function nextBlock() {
    if (isLastBlock()) {
      endRest(false);
      location.hash = `#/summary/${w.id}`;
      return;
    }
    goBlock(w.progress.blockIndex + 1);
  }
  async function markSet() {
    const b = curBlock();
    const p = w.progress;
    vibrate(80);
    if (p.setIndex < b.sets) {
      p.setIndex++;
      if (p.setIndex >= b.sets) { persist(); renderUI(); nextBlock(); return; }
      persist();
      renderUI();
      startRest(b.restSec);
    } else {
      nextBlock();
    }
  }

  /* ---- события ---- */
  $('#s-mark').addEventListener('click', markSet);
  $('#s-prev').addEventListener('click', () => goBlock(w.progress.blockIndex - 1));
  $('#s-next').addEventListener('click', () => goBlock(w.progress.blockIndex + 1));
  $('#s-exit').addEventListener('click', () => { location.hash = '#/home'; });
  $('#s-finish').addEventListener('click', () => { endRest(false); location.hash = `#/summary/${w.id}`; });
  $('#rest-plus15').addEventListener('click', () => {
    if (w.progress.restEndsAt) { w.progress.restEndsAt += 15000; persist(); tick(); }
  });
  $('#rest-skip').addEventListener('click', () => endRest(false));
  $('#s-cancel').addEventListener('click', async () => {
    if (await confirmAction('Отменить выполнение? Тренировка вернётся в статус «создана», прогресс будет сброшен.')) {
      await cancelWorkout(w);
      toast('Выполнение отменено');
      location.hash = '#/home';
    }
  });

  /* ---- wake lock + таймеры ---- */
  const onVis = async () => {
    if (document.visibilityState === 'visible' && !wakeLock) wakeLock = await acquireWakeLock();
  };
  wakeLock = await acquireWakeLock();
  document.addEventListener('visibilitychange', onVis);

  // возобновление отдыха после закрытия приложения
  if (w.progress.restEndsAt && w.progress.restEndsAt <= Date.now()) endRest(true);
  else if (w.progress.restEndsAt) restVisible(true);

  renderUI();
  tick();
  timer = setInterval(tick, 400);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    try { wakeLock?.release(); } catch { /* ignore */ }
  };
}

/* ==================== ИТОГИ ==================== */
export async function renderSummary(root, id) {
  const [w, exercises] = await Promise.all([db.get('workouts', id), db.getAll('exercises')]);
  if (!w || w.status !== 'in_progress') { location.hash = '#/home'; return; }
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));

  const dur = w.startedAt ? fmtDur(Date.now() - new Date(w.startedAt).getTime()) : null;

  root.innerHTML = `
    <div class="page-title">Итоги тренировки</div>
    <div class="card">
      <b>${esc(w.name)}</b>
      <div class="stat-line" style="margin-top:6px">
        <span>🕐 ${dur || ''}</span>
        <span>📅 ${esc(new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }))}</span>
      </div>
    </div>

    <div class="section-title">Фактические значения по блокам</div>
    <div id="sum-blocks"></div>

    <div class="section-title">Показатели тренировки (необязательно)</div>
    <div class="card">
      <div class="grid2">
        <div class="field">
          <label>Калории, ккал</label>
          <input id="st-cal" type="number" inputmode="numeric" min="0" step="1" placeholder="—" value="${esc(w.stats?.calories ?? '')}">
        </div>
        <div class="field">
          <label>Средняя ЧСС, уд/мин</label>
          <input id="st-hr" type="number" inputmode="numeric" min="0" step="1" placeholder="—" value="${esc(w.stats?.avgHr ?? '')}">
        </div>
      </div>
      <div class="muted small">Если есть умные часы — перенесите значения сюда.</div>
    </div>

    <button class="btn primary xl" id="sum-save">Сохранить и завершить</button>
    <div class="btn-row">
      <a class="btn ghost" href="#/session/${w.id}">← Вернуться к выполнению</a>
    </div>`;

  const blocksEl = root.querySelector('#sum-blocks');

  const factOf = i => w.actualBlocks?.[i] || w.blocks[i];

  function blockForm(b, i) {
    const f = factOf(i);
    return `
      <div class="block-card" data-i="${i}">
        <div class="row between" style="margin-bottom:8px">
          <div>
            <b>${i + 1}. ${esc(exMap[b.exerciseId] || 'Упражнение удалено')}</b>
            <div class="muted small">План: ${b.weight} кг · ${b.sets}×${b.reps}</div>
          </div>
          <label class="checkbox-row small" style="padding:0">
            <input type="checkbox" data-sk> пропущен
          </label>
        </div>
        <div class="grid3cols">
          <div class="field"><label>Вес, кг</label>
            <input data-a="weight" type="number" inputmode="decimal" min="0" step="any" value="${esc(f.weight ?? b.weight)}"></div>
          <div class="field"><label>Подходы</label>
            <input data-a="sets" type="number" inputmode="numeric" min="0" step="1" value="${esc(f.sets ?? b.sets)}"></div>
          <div class="field"><label>Повторения</label>
            <input data-a="reps" type="number" inputmode="numeric" min="0" step="1" value="${esc(f.reps ?? b.reps)}"></div>
        </div>
        <div class="pf-deltas" data-deltas></div>
      </div>`;
  }

  function renderBlocks() {
    blocksEl.innerHTML = w.blocks.map(blockForm).join('');
    blocksEl.querySelectorAll('.block-card').forEach(card => {
      const i = +card.dataset.i;
      const b = w.blocks[i];
      const upd = () => {
        const skipped = card.querySelector('[data-sk]').checked;
        card.querySelectorAll('input[data-a]').forEach(x => x.disabled = skipped);
        const dEl = card.querySelector('[data-deltas]');
        if (skipped) {
          dEl.innerHTML = '<span class="delta skip">Блок пропущен</span>';
          return;
        }
        const g = f => num(card.querySelector(`[data-a="${f}"]`).value);
        const parts = [];
        const dw = (g('weight') ?? 0) - b.weight;
        const ds = (g('sets') ?? 0) - b.sets;
        const dr = (g('reps') ?? 0) - b.reps;
        const dl = (d, label, unit = '') => {
          if (d) parts.push(`<span class="delta ${d > 0 ? 'pos' : 'neg'}">${label} ${d > 0 ? '+' : '−'}${String(Math.abs(d)).replace('.', ',')}${unit}</span>`);
        };
        dl(dw, 'Вес', ' кг');
        dl(ds, 'Подходы');
        dl(dr, 'Повтор.');
        dEl.innerHTML = parts.length ? parts.join('') : '<span class="delta pos">Точно по плану</span>';
      };
      card.querySelectorAll('input').forEach(x => x.addEventListener('input', upd));
      upd();
    });
  }
  renderBlocks();

  root.querySelector('#sum-save').addEventListener('click', async () => {
    // собрать факт
    const cards = [...blocksEl.querySelectorAll('.block-card')];
    const actual = [];
    for (let i = 0; i < w.blocks.length; i++) {
      const b = w.blocks[i];
      const card = cards.find(c => +c.dataset.i === i);
      const skipped = card.querySelector('[data-sk]').checked;
      if (skipped) {
        actual.push({ ...b, weight: 0, sets: 0, reps: 0, skipped: true });
        continue;
      }
      const weight = num(card.querySelector('[data-a="weight"]').value);
      const sets = num(card.querySelector('[data-a="sets"]').value);
      const reps = num(card.querySelector('[data-a="reps"]').value);
      if (weight == null || weight < 0 || sets == null || sets < 0 || reps == null || reps < 0) {
        toast(`Блок ${i + 1}: заполните вес, подходы и повторения (или отметьте «пропущен»)`);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      actual.push({ ...b, weight, sets: Math.round(sets), reps: Math.round(reps), skipped: false });
    }
    const cal = num(root.querySelector('#st-cal').value);
    const hr = num(root.querySelector('#st-hr').value);

    w.actualBlocks = actual;
    w.stats = { calories: cal ?? null, avgHr: hr ?? null };
    w.status = 'completed';
    w.finishedAt = nowISO();
    w.progress = null;
    await db.put('workouts', w);
    toast('Тренировка завершена 🎉');
    location.hash = '#/home';
  });
}
