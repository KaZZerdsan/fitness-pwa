// Тренировки: список, редактор шаблона, просмотр (план → факт)
import { db } from './db.js';
import { esc, uid, nowISO, toast, confirmAction, fmtDate, fmtDur, fmtTime, tempoStr, num, plural } from './util.js';
import { startWorkout, cancelWorkout, repeatWorkout } from './workout-ops.js';

function rerender() { window.dispatchEvent(new HashChangeEvent('hashchange')); }
const fmtN = n => String(n ?? '').replace('.', ',');

const STATUS = {
  created: ['b-created', 'создана'],
  in_progress: ['b-progress', 'выполняется'],
  completed: ['b-done', 'завершена'],
};

function defaultBlock() {
  return { title: '', exerciseId: '', weight: '', sets: 3, reps: 10, tempo: [3, 0, 1, 0], restSec: 90 };
}

function planLine(b) {
  return `${fmtN(b.weight)} кг · ${b.sets}×${b.reps} · темп ${tempoStr(b.tempo)} · отдых ${b.restSec} с`;
}

/* ==================== СПИСОК ==================== */
export async function render(root) {
  const workouts = await db.getAll('workouts');
  const by = st => workouts.filter(w => w.status === st)
    .sort((a, b) => ((b.startedAt || b.createdAt) || '').localeCompare((a.startedAt || a.createdAt) || ''));

  const item = (w, action) => `
    <div class="card click" data-go="${action}/${w.id}">
      <div class="row between">
        <div class="grow">
          <b style="font-size:16px">${esc(w.name)}</b>
          <div class="muted small">${(w.blocks || []).length} ${plural((w.blocks || []).length, ['блок', 'блока', 'блоков'])}${w.finishedAt ? ` · ${fmtDate(w.finishedAt)}` : ''}</div>
        </div>
        <span class="badge ${STATUS[w.status][0]}">${STATUS[w.status][1]}</span>
      </div>
    </div>`;

  root.innerHTML = `
    <div class="page-title row between">
      <span>Тренировки</span>
      <a class="btn primary sm" href="#/workout-form/">+ Создать</a>
    </div>
    ${by('in_progress').length ? `<div class="section-title">Выполняется</div>${by('in_progress').map(w => item(w, 'session')).join('')}` : ''}
    <div class="section-title">Созданы</div>
    ${by('created').length ? by('created').map(w => item(w, 'workout-form')).join('') : '<div class="empty">Нет созданных тренировок</div>'}
    ${by('completed').length ? `<div class="section-title">Завершены</div>${by('completed').map(w => item(w, 'workout')).join('')}` : ''}
  `;

  root.querySelectorAll('[data-go]').forEach(c => c.addEventListener('click', () => {
    location.hash = `#/${c.dataset.go}`;
  }));
}

/* ==================== РЕДАКТОР ШАБЛОНА ==================== */
export async function renderWorkoutForm(root, id) {
  const existing = id ? await db.get('workouts', id) : null;
  if (existing && existing.status !== 'created') {
    toast('Редактировать можно только тренировку в статусе «создана»');
    location.hash = `#/workout/${existing.id}`;
    return;
  }
  const exercises = (await db.getAll('exercises'))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

  const draft = existing
    ? { ...existing, blocks: existing.blocks.map(b => ({ ...b, tempo: [...b.tempo] })) }
    : { id: uid(), name: '', status: 'created', createdAt: nowISO(), blocks: [defaultBlock()] };

  root.innerHTML = `
    <div class="page-title">${existing ? 'Редактирование' : 'Новая тренировка'}</div>
    <div class="card">
      <div class="field">
        <label>Название *</label>
        <input id="w-name" type="text" maxlength="80" placeholder="Например: Ноги, база" value="${esc(draft.name)}">
      </div>
    </div>
    <div class="section-title">Блоки</div>
    <div id="blocks"></div>
    <button class="btn ghost" style="width:100%" id="b-add">+ Добавить блок</button>
    ${!exercises.length ? '<div class="card" style="margin-top:12px"><div class="err">Сначала добавьте упражнения в разделе «Упражнения».</div></div>' : ''}
    <div class="btn-row">
      <a class="btn ghost" href="#/workouts">Отмена</a>
      <button class="btn primary" id="w-save">Сохранить</button>
    </div>
    ${existing ? '<button class="btn danger" style="width:100%;margin-top:10px" id="w-del">Удалить тренировку</button>' : ''}
  `;

  const blocksEl = root.querySelector('#blocks');

  function exOptions(sel) {
    return `<option value="">— выберите —</option>` + exercises
      .map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  }

  const TEMPO_LBL = [
    ['Опускание', 'сек на опускание веса'],
    ['Пауза внизу', 'пауза после опускания'],
    ['Поднятие', 'сек на поднятие веса'],
    ['Пауза вверху', 'пауза после поднятия'],
  ];

  function blockHTML(b, i) {
    return `
      <div class="block-card" data-i="${i}">
        <div class="block-head">
          <span class="block-num">${i + 1}</span>
          <div class="spacer"></div>
          <button class="btn icon" data-act="up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn icon" data-act="down" ${i === draft.blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn icon" data-act="dup" title="Дублировать">⧉</button>
          <button class="btn icon danger" data-act="del" title="Удалить">✕</button>
        </div>
        <div class="field">
          <label>Упражнение *</label>
          <select data-f="exerciseId">${exOptions(b.exerciseId)}</select>
        </div>
        <div class="field">
          <label>Комментарий к блоку (необязательно)</label>
          <input data-f="title" type="text" maxlength="60" placeholder="Например: разогрев" value="${esc(b.title || '')}">
        </div>
        <div class="grid2">
          <div class="field">
            <label>Вес, кг</label>
            <input data-f="weight" type="number" inputmode="decimal" min="0" step="any" value="${esc(b.weight)}">
          </div>
          <div class="field">
            <label>Отдых, сек</label>
            <input data-f="restSec" type="number" inputmode="numeric" min="0" step="1" value="${esc(b.restSec)}">
          </div>
          <div class="field">
            <label>Подходов</label>
            <input data-f="sets" type="number" inputmode="numeric" min="1" step="1" value="${esc(b.sets)}">
          </div>
          <div class="field">
            <label>Повторений</label>
            <input data-f="reps" type="number" inputmode="numeric" min="1" step="1" value="${esc(b.reps)}">
          </div>
        </div>
        <div class="field">
          <label title="${TEMPO_LBL.map(x => x[1]).join(' · ')}">Темп (опускание — пауза — поднятие — пауза)</label>
          <div class="grid4">
            ${TEMPO_LBL.map((t, ti) => `
              <div class="field">
                <label title="${t[1]}">${t[0]}</label>
                <input data-t="${ti}" type="number" inputmode="numeric" min="0" step="1" value="${esc(b.tempo[ti])}">
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function renderBlocks() {
    blocksEl.innerHTML = draft.blocks.map(blockHTML).join('');
    // значения → draft
    blocksEl.querySelectorAll('.block-card').forEach(card => {
      const b = draft.blocks[+card.dataset.i];
      card.querySelectorAll('[data-f]').forEach(inp => {
        inp.addEventListener('input', () => { b[inp.dataset.f] = inp.value; });
      });
      card.querySelectorAll('[data-t]').forEach(inp => {
        inp.addEventListener('input', () => { b.tempo[+inp.dataset.t] = num(inp.value) ?? 0; });
      });
    });
    // структурные операции
    blocksEl.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.closest('.block-card').dataset.i;
        const act = btn.dataset.act;
        if (act === 'up' && i > 0) [draft.blocks[i - 1], draft.blocks[i]] = [draft.blocks[i], draft.blocks[i - 1]];
        if (act === 'down' && i < draft.blocks.length - 1) [draft.blocks[i + 1], draft.blocks[i]] = [draft.blocks[i], draft.blocks[i + 1]];
        if (act === 'dup') draft.blocks.splice(i + 1, 0, { ...b_clone(draft.blocks[i]), tempo: [...draft.blocks[i].tempo] });
        if (act === 'del') {
          if (draft.blocks.length === 1) { toast('Должен остаться хотя бы один блок'); return; }
          draft.blocks.splice(i, 1);
        }
        renderBlocks();
      });
    });
  }
  const b_clone = b => ({ ...b });

  renderBlocks();

  root.querySelector('#b-add').addEventListener('click', () => {
    draft.blocks.push(defaultBlock());
    renderBlocks();
    blocksEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  root.querySelector('#w-name').addEventListener('input', e => { draft.name = e.target.value; });

  root.querySelector('#w-save').addEventListener('click', async () => {
    draft.name = root.querySelector('#w-name').value.trim();
    const errs = [];
    if (!draft.name) errs.push('укажите название');
    if (!exercises.length) errs.push('добавьте упражнения в справочник');
    draft.blocks.forEach((b, i) => {
      if (!b.exerciseId) errs.push(`блок ${i + 1}: выберите упражнение`);
      if (!(num(b.weight) >= 0)) errs.push(`блок ${i + 1}: вес`);
      if (!(num(b.sets) >= 1)) errs.push(`блок ${i + 1}: подходы`);
      if (!(num(b.reps) >= 1)) errs.push(`блок ${i + 1}: повторения`);
      if (!(num(b.restSec) >= 0)) errs.push(`блок ${i + 1}: отдых`);
    });
    if (errs.length) { toast('Проверьте: ' + errs[0]); return; }

    // нормализуем числа
    draft.blocks = draft.blocks.map(b => ({
      title: (b.title || '').trim(),
      exerciseId: b.exerciseId,
      weight: num(b.weight) || 0,
      sets: Math.round(num(b.sets)),
      reps: Math.round(num(b.reps)),
      tempo: b.tempo.map(t => Math.max(0, Math.round(num(t) || 0))),
      restSec: Math.round(num(b.restSec) || 0),
    }));

    await db.put('workouts', draft);
    toast('Тренировка сохранена');
    location.hash = '#/workouts';
  });

  root.querySelector('#w-del')?.addEventListener('click', async () => {
    if (await confirmAction(`Удалить тренировку «${draft.name || 'без названия'}»?`)) {
      await db.delete('workouts', draft.id);
      toast('Удалено');
      location.hash = '#/workouts';
    }
  });
}

/* ==================== ПРОСМОТР (в т.ч. завершённой) ==================== */
/** блоки «план → факт» с отклонениями */
export function blocksCompareHTML(blocks, actual, exMap) {
  return (blocks || []).map((b, i) => {
    const f = actual?.[i];
    const name = esc(exMap[b.exerciseId] || 'Упражнение удалено');
    let fact = '<span class="muted">—</span>';
    let deltas = '';
    if (f) {
      if (f.skipped) {
        fact = '<span class="badge b-out">Пропущен</span>';
      } else {
        fact = `${fmtN(f.weight)} кг · ${f.sets}×${f.reps} · темп ${tempoStr(f.tempo)}`;
        const parts = [];
        const dw = (+f.weight || 0) - (+b.weight || 0);
        const ds = (+f.sets || 0) - (+b.sets || 0);
        const dr = (+f.reps || 0) - (+b.reps || 0);
        if (dw) parts.push(`<span class="delta ${dw > 0 ? 'pos' : 'neg'}">Вес ${dw > 0 ? '+' : '−'}${fmtN(Math.abs(dw))} кг</span>`);
        if (ds) parts.push(`<span class="delta ${ds > 0 ? 'pos' : 'neg'}">Подходы ${ds > 0 ? '+' : '−'}${Math.abs(ds)}</span>`);
        if (dr) parts.push(`<span class="delta ${dr > 0 ? 'pos' : 'neg'}">Повтор. ${dr > 0 ? '+' : '−'}${Math.abs(dr)}</span>`);
        deltas = parts.length ? `<div class="pf-deltas">${parts.join('')}</div>` : '<div class="pf-deltas"><span class="delta pos">Точно по плану</span></div>';
      }
    }
    return `
      <div class="pf-row">
        <div class="pf-name">${i + 1}. ${name}${b.title ? ` <span class="muted small">· ${esc(b.title)}</span>` : ''}</div>
        <div class="pf-plan">План: ${planLine(b)}</div>
        <div class="pf-fact">Факт: ${fact}</div>
        ${deltas}
      </div>`;
  }).join('');
}

export async function renderWorkoutView(root, id) {
  const [w, exercises] = await Promise.all([db.get('workouts', id), db.getAll('exercises')]);
  if (!w) { toast('Тренировка не найдена'); location.hash = '#/workouts'; return; }
  if (w.status === 'in_progress') { location.hash = `#/session/${w.id}`; return; }
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));

  if (w.status === 'created') {
    root.innerHTML = `
      <div class="page-title">${esc(w.name)}</div>
      <div class="card plan-fact">
        ${(w.blocks || []).map((b, i) => `
          <div class="pf-row">
            <div class="pf-name">${i + 1}. ${esc(exMap[b.exerciseId] || 'Упражнение удалено')}${b.title ? ` <span class="muted small">· ${esc(b.title)}</span>` : ''}</div>
            <div class="pf-plan">${planLine(b)}</div>
          </div>`).join('')}
      </div>
      <a class="btn primary xl" href="#" id="v-start">▶ Начать тренировку</a>
      <div class="btn-row">
        <a class="btn ghost" href="#/workout-form/${w.id}">✏️ Изменить</a>
        <button class="btn ghost" id="v-repeat">⧉ Повторить</button>
        <button class="btn danger" id="v-del">🗑️</button>
      </div>`;
    root.querySelector('#v-start').addEventListener('click', async e => {
      e.preventDefault();
      await startWorkout(w);
      location.hash = `#/session/${w.id}`;
    });
    root.querySelector('#v-repeat').addEventListener('click', async () => {
      const copy = await repeatWorkout(w);
      toast('Создана копия');
      location.hash = `#/workout-form/${copy.id}`;
    });
    root.querySelector('#v-del').addEventListener('click', async () => {
      if (await confirmAction(`Удалить тренировку «${w.name}»?`)) {
        await db.delete('workouts', w.id);
        toast('Удалено');
        location.hash = '#/workouts';
      }
    });
    return;
  }

  // завершённая: только чтение
  const dur = w.startedAt && w.finishedAt ? fmtDur(new Date(w.finishedAt) - new Date(w.startedAt)) : null;
  const diffCount = (w.blocks || []).filter((b, i) => {
    const f = w.actualBlocks?.[i];
    if (!f || f.skipped) return !!f && f.skipped;
    return (+f.weight !== +b.weight) || (+f.sets !== +b.sets) || (+f.reps !== +b.reps);
  }).length;

  root.innerHTML = `
    <div class="page-title">${esc(w.name)} <span class="badge ${STATUS.completed[0]}">${STATUS.completed[1]}</span></div>
    <div class="card">
      <div class="stat-line">
        <span>📅 ${fmtDate(w.finishedAt)}</span>
        <span>🕐 ${fmtTime(w.startedAt)}–${fmtTime(w.finishedAt)}${dur ? ` · ${dur}` : ''}</span>
      </div>
      ${w.stats?.calories || w.stats?.avgHr ? `
        <hr class="sep">
        <div class="stat-line">
          ${w.stats?.calories ? `<span>🔥 <b>${esc(w.stats.calories)}</b> ккал</span>` : ''}
          ${w.stats?.avgHr ? `<span>❤️ <b>${esc(w.stats.avgHr)}</b> уд/мин</span>` : ''}
        </div>` : ''}
      <hr class="sep">
      <div class="stat-line"><span>${diffCount ? `Отклонения от плана в ${diffCount} ${plural(diffCount, ['блоке', 'блоках', 'блоках'])}` : 'Точно по плану 👏'}</span></div>
    </div>
    <div class="card plan-fact">${blocksCompareHTML(w.blocks, w.actualBlocks, exMap)}</div>
    <a class="btn primary xl" href="#" id="v-repeat">⧉ Повторить эту тренировку</a>
    <div class="btn-row">
      <a class="btn ghost" href="#/history">В историю</a>
      <button class="btn danger" id="v-del">Удалить</button>
    </div>`;

  root.querySelector('#v-repeat').addEventListener('click', async e => {
    e.preventDefault();
    const copy = await repeatWorkout(w);
    toast('Копия создана со статусом «создана»');
    location.hash = `#/workout-form/${copy.id}`;
  });
  root.querySelector('#v-del').addEventListener('click', async () => {
    if (await confirmAction(`Удалить запись о тренировке «${w.name}» из истории?`)) {
      await db.delete('workouts', w.id);
      toast('Удалено');
      location.hash = '#/history';
    }
  });
}
