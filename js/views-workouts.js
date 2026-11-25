// Тренировки: список, редактор шаблона (подходы внутри упражнения), просмотр план/факт
import { db } from './db.js';
import { esc, uid, nowISO, toast, confirmAction, fmtDate, fmtDur, fmtTime, tempoStr, num, plural } from './util.js';
import { startWorkout, repeatWorkout, getWorkouts, getWorkout, blockHasDiff, blockRounds } from './workout-ops.js';

const fmtN = n => String(n ?? '').replace('.', ',');

const STATUS = {
  created: ['b-created', 'создана'],
  in_progress: ['b-progress', 'выполняется'],
  completed: ['b-done', 'завершена'],
};

const defaultItem = () => ({ exerciseId: '', comment: '', tempo: [2, 0, 2, 0], setsList: [{ weight: '', reps: 10 }] });
const defaultBlock = () => ({ title: '', restSec: 120, items: [defaultItem()] });

const TEMPO_LBL = [
  ['Опускание', 'сек на опускание веса'],
  ['Пауза', 'пауза после опускания'],
  ['Поднятие', 'сек на поднятие веса'],
  ['Пауза', 'пауза после поднятия'],
];

/* ==================== СПИСОК ==================== */
export async function render(root) {
  const workouts = await getWorkouts();
  const by = st => workouts.filter(w => w.status === st)
    .sort((a, b) => ((b.startedAt || b.createdAt) || '').localeCompare((a.startedAt || a.createdAt) || ''));

  const exCount = w => (w.blocks || []).reduce((s, b) => s + (b.items || []).length, 0);

  const item = (w, action) => `
    <div class="card click" data-go="${action}/${w.id}">
      <div class="row between">
        <div class="grow">
          <b style="font-size:16px">${esc(w.name)}</b>
          <div class="muted small">${(w.blocks || []).length} ${plural((w.blocks || []).length, ['блок', 'блока', 'блоков'])} · ${exCount(w)} ${plural(exCount(w), ['упражнение', 'упражнения', 'упражнений'])}${w.finishedAt ? ` · ${fmtDate(w.finishedAt)}` : ''}</div>
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
  const existing = id ? await getWorkout(id) : null;
  if (existing && existing.status !== 'created') {
    toast('Редактировать можно только тренировку в статусе «создана»');
    location.hash = `#/workout/${existing.id}`;
    return;
  }
  const exercises = (await db.getAll('exercises'))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

  const draft = existing
    ? {
        ...existing, blocks: existing.blocks.map(b => ({
          ...b,
          items: b.items.map(it => ({ ...it, tempo: [...it.tempo], setsList: it.setsList.map(s => ({ ...s })) })),
        })),
      }
    : { id: uid(), name: '', status: 'created', createdAt: nowISO(), blocks: [defaultBlock()] };

  root.innerHTML = `
    <div class="page-title">${existing ? 'Редактирование' : 'Новая тренировка'}</div>
    <div class="card">
      <div class="field">
        <label>Название *</label>
        <input id="w-name" type="text" maxlength="80" placeholder="Например: Ноги, база" value="${esc(draft.name)}">
      </div>
    </div>
    <div class="section-title">Блоки (суперсеты)</div>
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

  const exOptions = sel =>
    `<option value="">— выберите —</option>` + exercises
      .map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');

  function setRowHTML(si, s, canDel) {
    return `
      <div class="set-row" data-set="${si}">
        <span class="sn">${si + 1}</span>
        <div class="field">
          <label>Вес, кг</label>
          <input data-sf="weight" type="number" inputmode="decimal" min="0" step="any" value="${esc(s.weight)}">
        </div>
        <div class="field">
          <label>Повторений</label>
          <input data-sf="reps" type="number" inputmode="numeric" min="1" step="1" value="${esc(s.reps)}">
        </div>
        <button class="btn icon sm danger" data-setdel ${canDel ? '' : 'disabled'} title="Удалить подход">✕</button>
      </div>`;
  }

  function itemHTML(bi, it, ii) {
    const rounds = Math.max(...draft.blocks[bi].items.map(x => x.setsList.length));
    return `
      <div class="item-card" data-i="${ii}">
        <div class="row between" style="margin-bottom:6px">
          <span class="muted small" style="font-weight:700">${bi + 1}.${ii + 1}</span>
          <div class="row" style="gap:4px">
            <button class="btn icon sm" data-iact="up" ${ii === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn icon sm" data-iact="down" ${ii === draft.blocks[bi].items.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn icon sm" data-iact="dup">⧉</button>
            <button class="btn icon sm danger" data-iact="del">✕</button>
          </div>
        </div>
        <div class="field">
          <label>Упражнение *</label>
          <select data-if="exerciseId">${exOptions(it.exerciseId)}</select>
        </div>
        <div class="field">
          <label>Комментарий (необязательно)</label>
          <input data-if="comment" type="text" maxlength="80" placeholder="например: можно дробно" value="${esc(it.comment || '')}">
        </div>
        <div class="field">
          <label title="${TEMPO_LBL.map(x => x[1]).join(' · ')}">Темп</label>
          <div class="grid4">
            ${TEMPO_LBL.map((t, ti) => `
              <div class="field">
                <label title="${t[1]}">${t[0]}</label>
                <input data-it="${ti}" type="number" inputmode="numeric" min="0" step="1" value="${esc(it.tempo[ti])}">
              </div>`).join('')}
          </div>
        </div>
        <div class="set-head">
          <label>Подходы (${it.setsList.length})</label>
          <span class="muted small">${it.setsList.length === rounds ? 'кругов: ' + rounds : 'из ' + rounds + ' кругов'}</span>
        </div>
        ${it.setsList.map((s, si) => setRowHTML(si, s, it.setsList.length > 1)).join('')}
        <button class="btn ghost sm" data-addset style="width:100%;margin-bottom:4px">+ Подход</button>
      </div>`;
  }

  function blockHTML(b, bi) {
    return `
      <div class="block-card" data-b="${bi}">
        <div class="block-head">
          <span class="block-num">${bi + 1}</span>
          <div class="spacer"></div>
          <button class="btn icon" data-bact="up" ${bi === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn icon" data-bact="down" ${bi === draft.blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn icon" data-bact="dup" title="Дублировать блок">⧉</button>
          <button class="btn icon danger" data-bact="del" title="Удалить блок">✕</button>
        </div>
        <div class="field">
          <label>Комментарий к блоку (необязательно)</label>
          <input data-bf="title" type="text" maxlength="60" placeholder="Например: суперсет" value="${esc(b.title || '')}">
        </div>
        <div class="field">
          <label title="Отдых между кругами, в секундах">Отдых между кругами, сек</label>
          <input data-bf="restSec" type="number" inputmode="numeric" min="0" step="1" value="${esc(b.restSec)}">
        </div>
        <div class="section-title" style="margin:8px 2px 6px">Упражнения (${b.items.length}) — выполняются кругом, друг за другом</div>
        ${b.items.map((it, ii) => itemHTML(bi, it, ii)).join('')}
        <button class="btn ghost sm" data-additem style="width:100%;margin-bottom:8px">+ Упражнение в блок</button>
      </div>`;
  }

  function renderBlocks() {
    blocksEl.innerHTML = draft.blocks.map(blockHTML).join('');
    blocksEl.querySelectorAll('.block-card').forEach(card => {
      const bi = +card.dataset.b;
      const b = draft.blocks[bi];

      card.querySelectorAll('[data-bf]').forEach(inp => {
        inp.addEventListener('input', () => { b[inp.dataset.bf] = inp.value; });
      });

      card.querySelectorAll('.item-card').forEach(icard => {
        const ii = +icard.dataset.i;
        const it = b.items[ii];

        icard.querySelectorAll('[data-if]').forEach(inp => {
          inp.addEventListener('input', () => { it[inp.dataset.if] = inp.value; });
        });
        icard.querySelectorAll('[data-it]').forEach(inp => {
          inp.addEventListener('input', () => { it.tempo[+inp.dataset.it] = num(inp.value) ?? 0; });
        });

        // подходы
        icard.querySelectorAll('.set-row').forEach(row => {
          const si = +row.dataset.set;
          const s = it.setsList[si];
          row.querySelectorAll('[data-sf]').forEach(inp => {
            inp.addEventListener('input', () => { s[inp.dataset.sf] = inp.value; });
          });
          row.querySelector('[data-setdel]')?.addEventListener('click', () => {
            if (it.setsList.length === 1) { toast('Должен остаться хотя бы один подход'); return; }
            it.setsList.splice(si, 1);
            renderBlocks();
          });
        });
        icard.querySelector('[data-addset]').addEventListener('click', () => {
          // предзаполнение из последнего подхода
          const last = it.setsList[it.setsList.length - 1] || { weight: '', reps: 10 };
          it.setsList.push({ ...last });
          renderBlocks();
          icard.scrollIntoView({ behavior: 'smooth', block: 'end' });
        });

        // операции над упражнением
        icard.querySelectorAll('[data-iact]').forEach(btn => {
          btn.addEventListener('click', () => {
            const act = btn.dataset.iact;
            const items = b.items;
            if (act === 'up' && ii > 0) [items[ii - 1], items[ii]] = [items[ii], items[ii - 1]];
            if (act === 'down' && ii < items.length - 1) [items[ii + 1], items[ii]] = [items[ii], items[ii + 1]];
            if (act === 'dup') items.splice(ii + 1, 0, { ...it, tempo: [...it.tempo], setsList: it.setsList.map(s => ({ ...s })) });
            if (act === 'del') {
              if (items.length === 1) { toast('В блоке должно остаться хотя бы одно упражнение'); return; }
              items.splice(ii, 1);
            }
            renderBlocks();
          });
        });
      });

      // операции над блоком
      card.querySelectorAll('[data-bact]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.bact;
          const arr = draft.blocks;
          if (act === 'up' && bi > 0) [arr[bi - 1], arr[bi]] = [arr[bi], arr[bi - 1]];
          if (act === 'down' && bi < arr.length - 1) [arr[bi + 1], arr[bi]] = [arr[bi], arr[bi + 1]];
          if (act === 'dup') arr.splice(bi + 1, 0, {
            title: arr[bi].title,
            restSec: arr[bi].restSec,
            items: arr[bi].items.map(x => ({ ...x, tempo: [...x.tempo], setsList: x.setsList.map(s => ({ ...s })) })),
          });
          if (act === 'del') {
            if (arr.length === 1) { toast('Должен остаться хотя бы один блок'); return; }
            arr.splice(bi, 1);
          }
          renderBlocks();
        });
      });
      card.querySelector('[data-additem]').addEventListener('click', () => {
        b.items.push(defaultItem());
        renderBlocks();
        card.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    });
  }

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
      if (!(num(b.restSec) >= 0)) errs.push(`блок ${i + 1}: отдых`);
      b.items.forEach((it, j) => {
        if (!it.exerciseId) errs.push(`блок ${i + 1}, упражнение ${j + 1}: выберите упражнение`);
        if (!it.setsList.length) errs.push(`блок ${i + 1}, упражнение ${j + 1}: добавьте подход`);
        it.setsList.forEach((s, k) => {
          if (!(num(s.weight) >= 0)) errs.push(`блок ${i + 1}, упр. ${j + 1}, подход ${k + 1}: вес`);
          if (!(num(s.reps) >= 1)) errs.push(`блок ${i + 1}, упр. ${j + 1}, подход ${k + 1}: повторения`);
        });
      });
    });
    if (errs.length) { toast('Проверьте: ' + errs[0]); return; }

    draft.blocks = draft.blocks.map(b => ({
      title: (b.title || '').trim(),
      restSec: Math.round(num(b.restSec) || 0),
      items: b.items.map(it => ({
        exerciseId: it.exerciseId,
        comment: (it.comment || '').trim(),
        tempo: it.tempo.map(t => Math.max(0, Math.round(num(t) || 0))),
        setsList: it.setsList.map(s => ({
          weight: num(s.weight) || 0,
          reps: Math.round(num(s.reps)),
        })),
      })),
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
const setsPlanStr = list => (list || []).map(s => `${fmtN(s.weight)}×${s.reps}`).join(', ');

/** блоки «план → факт» с отклонениями (подходы внутри упражнений) */
export function blocksCompareHTML(blocks, actual, exMap) {
  return (blocks || []).map((b, i) => {
    const f = actual?.[i];
    const rounds = blockRounds(b);
    const head = `
      <div class="pf-name">Блок ${i + 1}${b.title ? ` <span class="muted small">· ${esc(b.title)}</span>` : ''}</div>
      <div class="pf-plan">План: до ${rounds} ${plural(rounds, ['круга', 'кругов', 'кругов'])} · отдых ${b.restSec} с</div>`;

    if (f && f.skipped) {
      return `<div class="pf-row">${head}<div class="pf-fact"><span class="badge b-out">Пропущен</span></div></div>`;
    }

    const itemsRows = b.items.map((it, j) => {
      const fi = f?.items?.[j];
      const name = esc(exMap[it.exerciseId] || 'Упражнение удалено');
      let factSets = '<span class="muted">—</span>';
      let deltas = '';
      if (fi) {
        const fact = fi.actualSets || [];
        factSets = fact.map(s => s.skipped ? '<span class="muted">✕</span>' : `${fmtN(s.weight)}×${s.reps}`).join(', ');
        const parts = [];
        it.setsList.forEach((s, k) => {
          const a = fact[k];
          if (!a) return;
          if (a.skipped) { parts.push(`<span class="delta skip">П${k + 1} пропущен</span>`); return; }
          const dw = (+a.weight || 0) - (+s.weight || 0);
          const dr = (+a.reps || 0) - (+s.reps || 0);
          const seg = [];
          if (dw) seg.push(`${dw > 0 ? '+' : '−'}${fmtN(Math.abs(dw))} кг`);
          if (dr) seg.push(`${dr > 0 ? '+' : '−'}${Math.abs(dr)} повт`);
          if (seg.length) parts.push(`<span class="delta ${dw < 0 || dr < 0 ? 'neg' : 'pos'}">П${k + 1}: ${seg.join(', ')}</span>`);
        });
        const done = fact.filter(s => !s.skipped).length;
        deltas = `<div class="pf-deltas">${parts.length ? parts.join('') : `<span class="delta pos">${done} из ${it.setsList.length} по плану</span>`}</div>`;
      }
      return `
        <div class="pf-item">
          <div><b>${j + 1}. ${name}</b>${it.comment ? ` <span class="muted small">💬 ${esc(it.comment)}</span>` : ''}</div>
          <div class="pf-plan">План: ${setsPlanStr(it.setsList)} · темп ${tempoStr(it.tempo)}</div>
          <div class="pf-fact">Факт: ${factSets}</div>
          ${deltas}
        </div>`;
    }).join('');

    return `<div class="pf-row">${head}${itemsRows}</div>`;
  }).join('');
}

export async function renderWorkoutView(root, id) {
  const [w, exercises] = await Promise.all([getWorkout(id), db.getAll('exercises')]);
  if (!w) { toast('Тренировка не найдена'); location.hash = '#/workouts'; return; }
  if (w.status === 'in_progress') { location.hash = `#/session/${w.id}`; return; }
  const exMap = Object.fromEntries(exercises.map(e => [e.id, e.name]));

  if (w.status === 'created') {
    root.innerHTML = `
      <div class="page-title">${esc(w.name)}</div>
      <div class="card plan-fact">
        ${(w.blocks || []).map((b, i) => `
          <div class="pf-row">
            <div class="pf-name">Блок ${i + 1}${b.title ? ` <span class="muted small">· ${esc(b.title)}</span>` : ''}</div>
            <div class="pf-plan">${blockRounds(b)} ${plural(blockRounds(b), ['круг', 'круга', 'кругов'])} · отдых ${b.restSec} с</div>
            ${b.items.map((it, j) => `
              <div class="pf-item">
                <div><b>${j + 1}. ${esc(exMap[it.exerciseId] || 'Упражнение удалено')}</b>${it.comment ? ` <span class="muted small">💬 ${esc(it.comment)}</span>` : ''}</div>
                <div class="pf-plan">${setsPlanStr(it.setsList)} · темп ${tempoStr(it.tempo)}</div>
              </div>`).join('')}
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
  const diffCount = (w.blocks || []).filter((b, i) => blockHasDiff(b, w.actualBlocks?.[i])).length;

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
