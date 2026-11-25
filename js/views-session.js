// Выполнение тренировки (суперсеты) + экран итогов
import { db } from './db.js';
import { esc, toast, confirmAction, fmtClock, fmtDur, tempoStr, num, nowISO, beep, vibrate, acquireWakeLock, plural } from './util.js';
import { cancelWorkout, getWorkout } from './workout-ops.js';

/* ==================== ВЫПОЛНЕНИЕ ==================== */
export async function renderSession(root, id) {
  const [w, exercises] = await Promise.all([getWorkout(id), db.getAll('exercises')]);
  if (!w || w.status !== 'in_progress') { location.hash = '#/home'; return; }
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e]));

  w.progress ??= { blockIndex: 0, setIndex: 0, itemIndex: 0, restEndsAt: null };
  w.progress.blockIndex = Math.min(w.progress.blockIndex, Math.max(0, w.blocks.length - 1));

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

      <div class="round-items" id="s-items"></div>

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

      <button class="btn primary xl" id="s-mark" style="margin-top:10px"></button>
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
  const curItem = () => {
    const b = curBlock();
    return b?.items[Math.min(w.progress.itemIndex, b.items.length - 1)];
  };
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
    if (w.startedAt) $('#s-elapsed').textContent = fmtClock((Date.now() - new Date(w.startedAt).getTime()) / 1000);
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

  /* ---- отрисовка текущего положения ---- */
  function renderUI() {
    const b = curBlock();
    if (!b) return;
    const p = w.progress;
    const it = curItem();
    const ex = exMap[it?.exerciseId];

    $('#s-blocknum').textContent = `Блок ${p.blockIndex + 1} из ${w.blocks.length} · круг ${Math.min(p.setIndex + 1, b.sets)} из ${b.sets}`;
    $('#s-ex').textContent = ex?.name || 'Упражнение удалено';
    $('#s-ex-note').textContent = b.title ? `💬 ${b.title}` : '';
    $('#s-video').innerHTML = ex?.videoUrl
      ? `<a class="icon-link" href="${esc(ex.videoUrl)}" target="_blank" rel="noopener">▶ Посмотреть видео</a>`
      : '';
    $('#s-weight').innerHTML = `${esc(String(it?.weight ?? '').replace('.', ','))} <span>кг</span>`;
    $('#s-reps').textContent = it?.reps ?? '—';
    $('#s-tempo').textContent = tempoStr(it?.tempo);
    $('#s-rest').textContent = b.restSec;

    // список упражнений текущего круга
    $('#s-items').innerHTML = b.items.map((x, i) => {
      const xe = exMap[x.exerciseId];
      const state = i < p.itemIndex ? 'done' : i === p.itemIndex ? 'now' : '';
      return `<div class="ri ${state}">${i < p.itemIndex ? '✓' : i === p.itemIndex ? '▶' : '•'} ${esc(xe?.name || 'Упражнение')} <span class="muted">— ${String(x.weight).replace('.', ',')} кг × ${x.reps}</span></div>`;
    }).join('');

    // точки по кругам
    $('#s-setnum').textContent = `Круг ${Math.min(p.setIndex + 1, b.sets)} из ${b.sets}`;
    $('#s-dots').innerHTML = Array.from({ length: +b.sets || 0 }, (_, i) =>
      `<span class="set-dot ${i < p.setIndex ? 'done' : i === p.setIndex ? 'now' : ''}"></span>`).join('');

    // общий прогресс в «единицах» (упражнение × круг)
    const units = blk => (+blk.sets || 0) * (blk.items?.length || 0);
    const total = w.blocks.reduce((s, x) => s + units(x), 0);
    const done = w.blocks.slice(0, p.blockIndex).reduce((s, x) => s + units(x), 0)
      + Math.min(p.setIndex, +b.sets || 0) * (b.items?.length || 0)
      + Math.min(p.itemIndex, b.items?.length || 0);
    $('#s-bar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';

    // подпись главной кнопки
    const lastItem = p.itemIndex >= b.items.length - 1;
    const lastRound = p.setIndex >= b.sets - 1;
    $('#s-mark').textContent = !lastItem
      ? '✓ Упражнение выполнено'
      : !lastRound
        ? '✓ Круг выполнен'
        : isLastBlock() ? 'Завершить тренировку →' : 'Следующий блок →';

    if (!w.progress.restEndsAt) restVisible(false);
  }

  /* ---- переходы ---- */
  function goBlock(idx) {
    w.progress.blockIndex = Math.max(0, Math.min(idx, w.blocks.length - 1));
    w.progress.setIndex = 0;
    w.progress.itemIndex = 0;
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
  async function markDone() {
    const b = curBlock();
    const p = w.progress;
    vibrate(80);
    if (p.itemIndex < b.items.length - 1) {
      p.itemIndex++;                    // следующее упражнение круга — без отдыха
      persist();
      renderUI();
    } else {
      p.itemIndex = 0;
      p.setIndex++;                     // круг завершён
      if (p.setIndex >= b.sets) {
        persist();
        renderUI();
        nextBlock();
        return;
      }
      persist();
      renderUI();
      startRest(b.restSec);            // отдых между кругами
    }
  }

  /* ---- события ---- */
  $('#s-mark').addEventListener('click', markDone);
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
  const [w, exercises] = await Promise.all([getWorkout(id), db.getAll('exercises')]);
  if (!w || w.status !== 'in_progress') { location.hash = '#/home'; return; }
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));

  const dur = w.startedAt ? fmtDur(Date.now() - new Date(w.startedAt).getTime()) : null;
  const fmtN = v => String(v ?? '').replace('.', ',');

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

  const factBlock = i => w.actualBlocks?.[i];

  function itemRow(bi, it, ii, fi) {
    return `
      <div class="item-card" data-item="${ii}">
        <div class="row between" style="margin-bottom:6px">
          <div>
            <b style="font-size:14.5px">${bi + 1}.${ii + 1} ${esc(exMap[it.exerciseId] || 'Упражнение удалено')}</b>
            <div class="muted small">План: ${fmtN(it.weight)} кг × ${it.reps}</div>
          </div>
          <span data-item-deltas></span>
        </div>
        <div class="grid2">
          <div class="field">
            <label>Вес, кг</label>
            <input data-a="weight" type="number" inputmode="decimal" min="0" step="any" value="${esc(fi?.actualWeight ?? it.weight)}">
          </div>
          <div class="field">
            <label>Повторений</label>
            <input data-a="reps" type="number" inputmode="numeric" min="0" step="1" value="${esc(fi?.actualReps ?? it.reps)}">
          </div>
        </div>
      </div>`;
  }

  function blockForm(b, i) {
    const f = factBlock(i);
    return `
      <div class="block-card" data-i="${i}">
        <div class="row between" style="margin-bottom:8px">
          <div class="grow">
            <b>Блок ${i + 1}${b.title ? ` · ${esc(b.title)}` : ''}</b>
            <div class="muted small">План: ${b.sets} ${plural(b.sets, ['круг', 'круга', 'кругов'])} × ${b.items.length} ${plural(b.items.length, ['упражнение', 'упражнения', 'упражнений'])}</div>
          </div>
          <label class="checkbox-row small" style="padding:0">
            <input type="checkbox" data-sk> пропущен
          </label>
        </div>
        <div class="field">
          <label>Кругов выполнено</label>
          <input data-a="sets" type="number" inputmode="numeric" min="0" step="1" value="${esc(f?.setsActual ?? b.sets)}">
          <div class="pf-deltas" data-round-deltas style="margin-top:4px"></div>
        </div>
        ${b.items.map((it, ii) => itemRow(i, it, ii, f?.items?.[ii])).join('')}
      </div>`;
  }

  function renderBlocks() {
    blocksEl.innerHTML = w.blocks.map(blockForm).join('');
    blocksEl.querySelectorAll('.block-card').forEach(card => {
      const i = +card.dataset.i;
      const b = w.blocks[i];

      const upd = () => {
        const skipped = card.querySelector('[data-sk]').checked;
        card.querySelectorAll('input:not([data-sk])').forEach(x => { x.disabled = skipped; });
        const roundEl = card.querySelector('[data-round-deltas]');
        if (skipped) {
          roundEl.innerHTML = '<span class="delta skip">Блок пропущен</span>';
          card.querySelectorAll('[data-item-deltas]').forEach(el => el.innerHTML = '');
          return;
        }
        // Δ кругов
        const ds = (num(card.querySelector('[data-a="sets"]').value) ?? 0) - b.sets;
        roundEl.innerHTML = ds
          ? `<span class="delta ${ds > 0 ? 'pos' : 'neg'}">Круги ${ds > 0 ? '+' : '−'}${Math.abs(ds)}</span>`
          : '<span class="delta pos">Круги по плану</span>';
        // Δ по упражнениям
        card.querySelectorAll('.item-card').forEach(ic => {
          const ii = +ic.dataset.item;
          const it = b.items[ii];
          const el = ic.querySelector('[data-item-deltas]');
          const parts = [];
          const dw = (num(ic.querySelector('[data-a="weight"]').value) ?? 0) - it.weight;
          const dr = (num(ic.querySelector('[data-a="reps"]').value) ?? 0) - it.reps;
          if (dw) parts.push(`<span class="delta ${dw > 0 ? 'pos' : 'neg'}">Вес ${dw > 0 ? '+' : '−'}${String(Math.abs(dw)).replace('.', ',')} кг</span>`);
          if (dr) parts.push(`<span class="delta ${dr > 0 ? 'pos' : 'neg'}">Повтор. ${dr > 0 ? '+' : '−'}${Math.abs(dr)}</span>`);
          el.innerHTML = parts.join(' ');
        });
      };

      card.querySelectorAll('input').forEach(x => x.addEventListener('input', upd));
      upd();
    });
  }
  renderBlocks();

  root.querySelector('#sum-save').addEventListener('click', async () => {
    const cards = [...blocksEl.querySelectorAll('.block-card')];
    const actual = [];
    for (let i = 0; i < w.blocks.length; i++) {
      const b = w.blocks[i];
      const card = cards.find(c => +c.dataset.i === i);
      if (card.querySelector('[data-sk]').checked) {
        actual.push({
          title: b.title, sets: b.sets, restSec: b.restSec, skipped: true, setsActual: 0,
          items: b.items.map(it => ({ exerciseId: it.exerciseId, weight: it.weight, reps: it.reps, tempo: it.tempo, actualWeight: 0, actualReps: 0 })),
        });
        continue;
      }
      const setsActual = num(card.querySelector('[data-a="sets"]').value);
      if (setsActual == null || setsActual < 0) {
        toast(`Блок ${i + 1}: укажите число выполненных кругов (или «пропущен»)`);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const items = [];
      for (let j = 0; j < b.items.length; j++) {
        const it = b.items[j];
        const ic = card.querySelector(`.item-card[data-item="${j}"]`);
        const aw = num(ic.querySelector('[data-a="weight"]').value);
        const ar = num(ic.querySelector('[data-a="reps"]').value);
        if (aw == null || aw < 0 || ar == null || ar < 0) {
          toast(`Блок ${i + 1}, упражнение ${j + 1}: заполните вес и повторения (или «пропущен»)`);
          ic.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        items.push({ exerciseId: it.exerciseId, weight: it.weight, reps: it.reps, tempo: it.tempo, actualWeight: aw, actualReps: Math.round(ar) });
      }
      actual.push({ title: b.title, sets: b.sets, restSec: b.restSec, skipped: false, setsActual: Math.round(setsActual), items });
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
