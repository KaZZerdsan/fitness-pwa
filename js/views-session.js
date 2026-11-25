// Выполнение тренировки (суперсеты с подходами внутри упражнений) + итоги
import { db } from './db.js';
import { esc, toast, confirmAction, fmtClock, fmtDur, tempoStr, num, nowISO, beep, vibrate, acquireWakeLock, plural } from './util.js';
import { cancelWorkout, getWorkout, blockRounds } from './workout-ops.js';

/* ==================== ВЫПОЛНЕНИЕ ==================== */
export async function renderSession(root, id) {
  const [w, exercises] = await Promise.all([getWorkout(id), db.getAll('exercises')]);
  if (!w || w.status !== 'in_progress') { location.hash = '#/home'; return; }
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e]));

  w.progress ??= { blockIndex: 0, setIndex: 0, itemIndex: 0, restEndsAt: null };
  w.progress.blockIndex = Math.min(w.progress.blockIndex, Math.max(0, w.blocks.length - 1));

  // активные упражнения круга (у которых есть подход с индексом round)
  const activeIdxs = (b, round) =>
    b.items.map((_, idx) => idx).filter(idx => (b.items[idx].setsList?.length || 0) > round);
  const nextActive = (b, round, after) =>
    activeIdxs(b, round).filter(idx => idx > after)[0] ?? -1;

  // восстановление корректной позиции
  {
    const b = w.blocks[w.progress.blockIndex];
    if (b) {
      const p = w.progress;
      const act = activeIdxs(b, p.setIndex);
      if (!act.includes(p.itemIndex)) {
        p.itemIndex = nextActive(b, p.setIndex, p.itemIndex);
        if (p.itemIndex < 0) p.itemIndex = act[0] ?? 0;
      }
    }
  }

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
    const rounds = blockRounds(b);
    const it = b.items[p.itemIndex];
    const set = it?.setsList?.[Math.min(p.setIndex, it.setsList.length - 1)];
    const ex = exMap[it?.exerciseId];

    $('#s-blocknum').textContent = `Блок ${p.blockIndex + 1} из ${w.blocks.length} · круг ${Math.min(p.setIndex + 1, rounds)} из ${rounds}`;
    $('#s-ex').textContent = ex?.name || 'Упражнение удалено';
    const notes = [b.title, it?.comment].filter(Boolean).join(' · ');
    $('#s-ex-note').textContent = notes ? `💬 ${notes}` : '';
    $('#s-video').innerHTML = ex?.videoUrl
      ? `<a class="icon-link" href="${esc(ex.videoUrl)}" target="_blank" rel="noopener">▶ Посмотреть видео</a>`
      : '';
    $('#s-weight').innerHTML = `${esc(String(set?.weight ?? '').replace('.', ','))} <span>кг</span>`;
    $('#s-reps').textContent = set?.reps ?? '—';
    $('#s-tempo').textContent = tempoStr(it?.tempo);
    $('#s-rest').textContent = b.restSec;

    // список упражнений текущего круга (только участвующие)
    $('#s-items').innerHTML = activeIdxs(b, p.setIndex).map(idx => {
      const x = b.items[idx];
      const xe = exMap[x.exerciseId];
      const xs = x.setsList[Math.min(p.setIndex, x.setsList.length - 1)];
      const state = idx < p.itemIndex ? 'done' : idx === p.itemIndex ? 'now' : '';
      return `<div class="ri ${state}">${state === 'done' ? '✓' : state === 'now' ? '▶' : '•'} ${esc(xe?.name || 'Упражнение')} <span class="muted">— ${String(xs?.weight ?? '').replace('.', ',')} кг × ${xs?.reps}</span></div>`;
    }).join('');

    // точки по кругам
    $('#s-setnum').textContent = `Круг ${Math.min(p.setIndex + 1, rounds)} из ${rounds}`;
    $('#s-dots').innerHTML = Array.from({ length: rounds }, (_, i) =>
      `<span class="set-dot ${i < p.setIndex ? 'done' : i === p.setIndex ? 'now' : ''}"></span>`).join('');

    // общий прогресс в подходах
    const slots = blk => (blk.items || []).reduce((s, i) => s + (i.setsList?.length || 0), 0);
    const total = w.blocks.reduce((s, x) => s + slots(x), 0);
    const done = w.blocks.slice(0, p.blockIndex).reduce((s, x) => s + slots(x), 0)
      + (b.items || []).reduce((s, i) => s + Math.min(p.setIndex, i.setsList?.length || 0), 0)
      + (b.items || []).filter((_, idx) => idx < p.itemIndex && (b.items[idx].setsList?.length || 0) > p.setIndex).length;
    $('#s-bar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';

    // подпись главной кнопки
    const moreInRound = nextActive(b, p.setIndex, p.itemIndex) >= 0;
    const lastRound = p.setIndex >= rounds - 1;
    $('#s-mark').textContent = !moreInRound
      ? !lastRound
        ? '✓ Круг выполнен'
        : isLastBlock() ? 'Завершить тренировку →' : 'Следующий блок →'
      : '✓ Подход выполнен';

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
    const nxt = nextActive(b, p.setIndex, p.itemIndex);
    if (nxt >= 0) {
      p.itemIndex = nxt;                       // следующее упражнение круга — без отдыха
      persist();
      renderUI();
    } else {
      const first = nextActive(b, p.setIndex + 1, -1);
      if (first >= 0) {
        p.setIndex++;                          // круг завершён, есть ещё круги
        p.itemIndex = first;
        persist();
        renderUI();
        startRest(b.restSec);
      } else {
        p.setIndex++;
        persist();
        renderUI();
        nextBlock();                           // блок завершён
      }
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

    <div class="section-title">Фактические значения по упражнениям</div>
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

  function factSetRow(j, k, planSet, factSet) {
    return `
      <div class="set-row" data-set="${k}">
        <span class="sn" title="План: ${fmtN(planSet.weight)}×${planSet.reps}">${k + 1}</span>
        <div class="field">
          <label>Вес, кг</label>
          <input data-a="weight" type="number" inputmode="decimal" min="0" step="any" value="${esc(factSet?.weight ?? planSet.weight)}">
        </div>
        <div class="field">
          <label>Повторений</label>
          <input data-a="reps" type="number" inputmode="numeric" min="0" step="1" value="${esc(factSet?.reps ?? planSet.reps)}">
        </div>
        <label class="chk-skip" title="Подход не выполнен">
          <input type="checkbox" data-askip ${factSet?.skipped ? 'checked' : ''}>
          <span>✕</span>
        </label>
      </div>`;
  }

  function itemForm(bi, it, ii, fi) {
    return `
      <div class="item-card" data-item="${ii}">
        <div class="row between" style="margin-bottom:6px">
          <div class="grow">
            <b style="font-size:14.5px">${bi + 1}.${ii + 1} ${esc(exMap[it.exerciseId] || 'Упражнение удалено')}</b>
            <div class="muted small">План: ${it.setsList.map(s => `${fmtN(s.weight)}×${s.reps}`).join(', ')}${it.comment ? ` · 💬 ${esc(it.comment)}` : ''}</div>
          </div>
        </div>
        ${it.setsList.map((s, k) => factSetRow(ii, k, s, fi?.actualSets?.[k])).join('')}
        <div class="pf-deltas" data-item-deltas></div>
      </div>`;
  }

  function blockForm(b, i) {
    const f = w.actualBlocks?.[i];
    return `
      <div class="block-card" data-i="${i}">
        <div class="row between" style="margin-bottom:8px">
          <div class="grow">
            <b>Блок ${i + 1}${b.title ? ` · ${esc(b.title)}` : ''}</b>
            <div class="muted small">${blockRounds(b)} ${plural(blockRounds(b), ['круг', 'круга', 'кругов'])} · отдых ${b.restSec} с</div>
          </div>
          <label class="checkbox-row small" style="padding:0">
            <input type="checkbox" data-sk> пропущен
          </label>
        </div>
        ${b.items.map((it, ii) => itemForm(i, it, ii, f?.items?.[ii])).join('')}
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
        card.querySelectorAll('.item-card').forEach(ic => {
          const ii = +ic.dataset.item;
          const it = b.items[ii];
          const dEl = ic.querySelector('[data-item-deltas]');
          if (skipped) { dEl.innerHTML = '<span class="delta skip">Блок пропущен</span>'; return; }
          const parts = [];
          let done = 0;
          ic.querySelectorAll('.set-row').forEach(row => {
            const k = +row.dataset.set;
            const plan = it.setsList[k];
            const isSk = row.querySelector('[data-askip]').checked;
            if (isSk) { parts.push(`<span class="delta skip">П${k + 1} пропущен</span>`); return; }
            done++;
            const aw = num(row.querySelector('[data-a="weight"]').value);
            const ar = num(row.querySelector('[data-a="reps"]').value);
            if (aw == null || aw < 0 || ar == null || ar < 0) return;
            const dw = aw - plan.weight;
            const dr = ar - plan.reps;
            const seg = [];
            if (dw) seg.push(`${dw > 0 ? '+' : '−'}${fmtN(Math.abs(dw))} кг`);
            if (dr) seg.push(`${dr > 0 ? '+' : '−'}${Math.abs(dr)} повт`);
            if (seg.length) parts.push(`<span class="delta ${dw < 0 || dr < 0 ? 'neg' : 'pos'}">П${k + 1}: ${seg.join(', ')}</span>`);
          });
          dEl.innerHTML = parts.length
            ? parts.join('') + ` <span class="muted small">${done} из ${it.setsList.length}</span>`
            : `<span class="delta pos">${done} из ${it.setsList.length} по плану</span>`;
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
          title: b.title, restSec: b.restSec, skipped: true,
          items: b.items.map(it => ({
            exerciseId: it.exerciseId, comment: it.comment, tempo: it.tempo,
            setsList: it.setsList.map(s => ({ ...s })),
            actualSets: it.setsList.map(() => ({ weight: 0, reps: 0, skipped: true })),
          })),
        });
        continue;
      }
      const items = [];
      for (let j = 0; j < b.items.length; j++) {
        const it = b.items[j];
        const ic = card.querySelector(`.item-card[data-item="${j}"]`);
        const actualSets = [];
        for (let k = 0; k < it.setsList.length; k++) {
          const row = ic.querySelector(`.set-row[data-set="${k}"]`);
          if (row.querySelector('[data-askip]').checked) {
            actualSets.push({ weight: 0, reps: 0, skipped: true });
            continue;
          }
          const aw = num(row.querySelector('[data-a="weight"]').value);
          const ar = num(row.querySelector('[data-a="reps"]').value);
          if (aw == null || aw < 0 || ar == null || ar < 0) {
            toast(`Блок ${i + 1}, упр. ${j + 1}, подход ${k + 1}: заполните вес и повторения (или ✕)`);
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          actualSets.push({ weight: aw, reps: Math.round(ar), skipped: false });
        }
        items.push({
          exerciseId: it.exerciseId, comment: it.comment, tempo: it.tempo,
          setsList: it.setsList.map(s => ({ ...s })),
          actualSets,
        });
      }
      actual.push({ title: b.title, restSec: b.restSec, skipped: false, items });
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
