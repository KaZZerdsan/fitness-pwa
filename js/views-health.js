// Показатели здоровья: записи, справочник анализов, превью, выгрузка
import { db } from './db.js';
import { esc, uid, nowISO, todayISO, toast, confirmAction, num, isOut, parseNorm, fmtDate, fmtDateShort, chartSvg, downloadFile, plural } from './util.js';

function rerender() { window.dispatchEvent(new HashChangeEvent('hashchange')); }
const fmtV = v => String(v ?? '').replace('.', ',');

/* ==================== ОСНОВНОЙ ЭКРАН (сегмент) ==================== */
export async function render(root, seg = 'records') {
  if (seg !== 'analyses') seg = 'records';

  root.innerHTML = `
    <div class="page-title">Показатели</div>
    <div class="seg">
      <a href="#/health/records" class="${seg === 'records' ? 'active' : ''}">Записи</a>
      <a href="#/health/analyses" class="${seg === 'analyses' ? 'active' : ''}">Анализы</a>
    </div>
    <div id="seg-body"></div>
    ${seg === 'records'
      ? '<div class="fab"><button class="btn" id="rec-add">+</button></div>'
      : '<div class="fab"><button class="btn" id="an-add">+</button></div>'}
  `;

  if (seg === 'records') await renderRecords(root.querySelector('#seg-body'));
  else await renderAnalyses(root.querySelector('#seg-body'));

  root.querySelector('#rec-add')?.addEventListener('click', () => { location.hash = '#/record-form/'; });
  root.querySelector('#an-add')?.addEventListener('click', () => openAnalysisForm(root, null, rerender));
}

async function renderRecords(el) {
  const records = (await db.getAll('records'))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (!records.length) {
    el.innerHTML = '<div class="empty"><span class="big">🩺</span>Добавьте результаты анализов — например, после диспансеризации.</div>';
    return;
  }

  el.innerHTML = records.map(r => {
    const out = (r.results || []).filter(x => isOut(x.value, x.norm)).length;
    return `
      <div class="card click" data-id="${r.id}">
        <div class="row between">
          <div class="grow">
            <b style="font-size:16px">${fmtDate(r.date)}</b>
            <div class="muted small">${(r.results || []).length} ${plural((r.results || []).length, ['показатель', 'показателя', 'показателей'])}${r.note ? ` · ${esc(r.note)}` : ''}</div>
          </div>
          ${out ? `<span class="badge b-out">⚠ ${out} вне нормы</span>` : '<span class="badge b-ok">в норме</span>'}
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('[data-id]').forEach(c => c.addEventListener('click', () => {
    location.hash = `#/record/${c.dataset.id}`;
  }));
}

async function renderAnalyses(el) {
  const [analyses, records] = await Promise.all([db.getAll('analyses'), db.getAll('records')]);
  const list = analyses.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="big">📋</span>Справочник пуст. Добавьте виды анализов: гемоглобин, глюкоза и т.д.</div>';
    return;
  }

  el.innerHTML = list.map(a => {
    const uses = records.filter(r => (r.results || []).some(x => x.analysisId === a.id)).length;
    return `
      <div class="card click" data-id="${a.id}">
        <div class="row between">
          <div class="grow">
            <b style="font-size:16px">${esc(a.name)}</b>
            <div class="muted small">${esc(a.unit || '—')} · норма: ${esc(a.norm || '—')} · записей: ${uses}</div>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn icon" data-edit="${a.id}">✏️</button>
            <button class="btn icon danger" data-del="${a.id}">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('[data-id]').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('[data-edit],[data-del]')) return;
    location.hash = `#/analysis/${c.dataset.id}`;
  }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    openAnalysisForm(el, list.find(a => a.id === b.dataset.edit), rerender);
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const a = list.find(x => x.id === b.dataset.del);
    if (await confirmAction(`Удалить анализ «${a.name}» из справочника?\nВ существующих записях значения останутся.`)) {
      await db.delete('analyses', a.id);
      toast('Анализ удалён из справочника');
      rerender();
    }
  }));
}

/** форма анализа (оверлей) */
function openAnalysisForm(parent, an, after) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <h3>${an ? 'Изменить анализ' : 'Новый анализ'}</h3>
      <div class="field">
        <label>Название *</label>
        <input id="a-name" type="text" maxlength="80" placeholder="Например: Гемоглобин" value="${esc(an?.name || '')}">
      </div>
      <div class="grid2">
        <div class="field">
          <label>Единица измерения</label>
          <input id="a-unit" type="text" maxlength="20" placeholder="г/л" value="${esc(an?.unit || '')}">
        </div>
        <div class="field">
          <label>Норма</label>
          <input id="a-norm" type="text" maxlength="40" placeholder="130–160" value="${esc(an?.norm || '')}">
        </div>
      </div>
      <div class="muted small" style="margin-bottom:12px">Норма вида «130–160» позволит подсвечивать значения вне диапазона.</div>
      <div class="btn-row">
        <button class="btn ghost" id="a-cancel">Отмена</button>
        <button class="btn primary" id="a-save">Сохранить</button>
      </div>
    </div>`;
  parent.appendChild(overlay);
  overlay.querySelector('#a-name').focus();
  const close = () => overlay.remove();
  overlay.querySelector('#a-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#a-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#a-name').value.trim();
    if (!name) { toast('Укажите название'); return; }
    const norm = overlay.querySelector('#a-norm').value.trim();
    if (norm && !parseNorm(norm)) toast('Норму не удалось распознать как диапазон — сохраню как есть');
    await db.put('analyses', {
      id: an?.id || uid(),
      name,
      unit: overlay.querySelector('#a-unit').value.trim(),
      norm,
      createdAt: an?.createdAt || nowISO(),
    });
    toast('Сохранено');
    close();
    after && after();
  });
}

/* ==================== ФОРМА ЗАПИСИ ==================== */
export async function renderRecordForm(root, id) {
  const existing = id ? await db.get('records', id) : null;
  const analyses = (await db.getAll('analyses'))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

  const draft = existing
    ? { ...existing, results: existing.results.map(r => ({ ...r })) }
    : { id: uid(), date: todayISO(), note: '', results: analyses.length ? [{ analysisId: analyses[0].id, value: '' }] : [] };

  root.innerHTML = `
    <div class="page-title">${existing ? 'Изменить запись' : 'Новая запись показаний'}</div>
    <div class="card">
      <div class="grid2">
        <div class="field">
          <label>Дата *</label>
          <input id="r-date" type="date" value="${esc(draft.date)}">
        </div>
        <div class="field">
          <label>Заметка</label>
          <input id="r-note" type="text" maxlength="60" placeholder="например: утренние" value="${esc(draft.note || '')}">
        </div>
      </div>
    </div>
    <div class="section-title">Показатели</div>
    <div id="r-rows"></div>
    <button class="btn ghost" style="width:100%" id="r-add">+ Добавить показатель</button>
    <div class="btn-row">
      <a class="btn ghost" href="#/health/records">Отмена</a>
      <button class="btn primary" id="r-save">Сохранить</button>
    </div>`;

  const rowsEl = root.querySelector('#r-rows');
  let analysisList = [...analyses]; // может пополниться новыми

  function anOptions(sel) {
    return analysisList.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${a.norm ? ` (${esc(a.norm)})` : ''}</option>`).join('');
  }

  function rowHTML(r, i) {
    return `
      <div class="block-card" data-i="${i}">
        <div class="block-head">
          <span class="block-num">${i + 1}</span>
          <div class="spacer"></div>
          <button class="btn icon danger" data-act="del" title="Убрать">✕</button>
        </div>
        <div class="grid2">
          <div class="field">
            <label>Анализ</label>
            <select data-f="analysisId">${anOptions(r.analysisId)}</select>
          </div>
          <div class="field">
            <label>Значение *</label>
            <input data-f="value" type="number" inputmode="decimal" step="any" placeholder="—" value="${esc(r.value)}">
          </div>
        </div>
        <div class="muted small" data-norm></div>
      </div>`;
  }

  function renderRows() {
    rowsEl.innerHTML = draft.results.map(rowHTML).join('');
    rowsEl.querySelectorAll('.block-card').forEach(card => {
      const r = draft.results[+card.dataset.i];
      const sel = card.querySelector('select');
      sel.addEventListener('change', () => {
        r.analysisId = sel.value;
        showNorm(card, r);
      });
      card.querySelector('[data-f="value"]').addEventListener('input', e => { r.value = e.target.value; });
      showNorm(card, r);
      card.querySelector('[data-act="del"]').addEventListener('click', () => {
        draft.results.splice(+card.dataset.i, 1);
        renderRows();
      });
    });
  }

  function showNorm(card, r) {
    const a = analysisList.find(x => x.id === r.analysisId);
    card.querySelector('[data-norm]').textContent = a ? `единица: ${a.unit || '—'} · норма: ${a.norm || '—'}` : '';
  }

  renderRows();

  root.querySelector('#r-add').addEventListener('click', () => {
    if (!analysisList.length) {
      openAnalysisForm(root, null, async () => {
        analysisList = (await db.getAll('analyses')).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
        draft.results.push({ analysisId: analysisList[analysisList.length - 1]?.id || '', value: '' });
        renderRows();
      });
      return;
    }
    draft.results.push({ analysisId: '', value: '' });
    renderRows();
    rowsEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  root.querySelector('#r-save').addEventListener('click', async () => {
    draft.date = root.querySelector('#r-date').value;
    draft.note = root.querySelector('#r-note').value.trim();
    if (!draft.date) { toast('Укажите дату'); return; }
    if (!draft.results.length) { toast('Добавьте хотя бы один показатель'); return; }
    for (let i = 0; i < draft.results.length; i++) {
      const r = draft.results[i];
      if (!r.analysisId) { toast(`Строка ${i + 1}: выберите анализ`); return; }
      if (num(r.value) == null) { toast(`Строка ${i + 1}: укажите значение`); return; }
    }
    // снапшот полей анализа
    draft.results = draft.results.map(r => {
      const a = analysisList.find(x => x.id === r.analysisId);
      return {
        analysisId: a.id,
        analysisName: a.name,
        unit: a.unit || '',
        norm: a.norm || '',
        value: num(r.value),
      };
    });
    await db.put('records', draft);
    toast('Запись сохранена');
    location.hash = `#/record/${draft.id}`;
  });
}

/* ==================== ПРОСМОТР ЗАПИСИ (превью + выгрузка) ==================== */
export async function renderRecordView(root, id) {
  const r = await db.get('records', id);
  if (!r) { toast('Запись не найдена'); location.hash = '#/health/records'; return; }

  const rows = r.results || [];
  const outCount = rows.filter(x => isOut(x.value, x.norm)).length;

  root.innerHTML = `
    <div class="page-title row between">
      <span>Запись показаний</span>
      <a class="btn sm ghost" href="#/health/records">← К записям</a>
    </div>
    <div class="preview-card" id="preview">
      <div class="p-head">
        <span class="p-title">Показатели</span>
        <span class="p-date">${fmtDate(r.date)}${r.note ? ` · ${esc(r.note)}` : ''}</span>
      </div>
      ${rows.length ? `
        <table class="p-table">
          <tr><th>Анализ</th><th style="text-align:right">Значение</th><th style="text-align:right">Норма</th></tr>
          ${rows.map(x => {
            const out = isOut(x.value, x.norm);
            const arrow = out ? (num(x.value) > parseNorm(x.norm).max ? ' ↑' : ' ↓') : '';
            return `<tr>
              <td>${esc(x.analysisName)}</td>
              <td class="num${out ? ' val-out' : ''}">${fmtV(x.value)}${x.unit ? ` ${esc(x.unit)}` : ''}${arrow}</td>
              <td class="norm">${esc(x.norm || '—')}</td>
            </tr>`;
          }).join('')}
        </table>`
      : '<div class="p-note">Нет показателей</div>'}
      ${outCount ? `<div class="p-note" style="color:#d32f2f;font-weight:700">⚠ ${outCount} ${plural(outCount, ['значение', 'значения', 'значений'])} вне нормы</div>` : '<div class="p-note" style="color:#2e7d32;font-weight:700">✓ Все значения в норме</div>'}
    </div>
    <div class="card">
      <div class="row" style="gap:10px">
        <button class="btn grow" id="pv-share">📤 Поделиться</button>
        <button class="btn grow" id="pv-csv">📄 CSV</button>
      </div>
      <div class="btn-row">
        <a class="btn ghost grow" href="#/record-form/${r.id}">✏️ Изменить</a>
        <button class="btn danger grow" id="pv-del">🗑️ Удалить</button>
      </div>
    </div>`;

  const shareText = () => {
    const lines = [`Показатели — ${fmtDate(r.date)}`];
    if (r.note) lines.push(r.note);
    for (const x of rows) {
      const out = isOut(x.value, x.norm);
      lines.push(`• ${x.analysisName}: ${fmtV(x.value)}${x.unit ? ' ' + x.unit : ''}${x.norm ? ` (норма: ${x.norm})` : ''}${out ? ' ⚠ вне нормы' : ' ✓'}`);
    }
    return lines.join('\n');
  };

  root.querySelector('#pv-share').addEventListener('click', async () => {
    const text = shareText();
    if (navigator.share) {
      try { await navigator.share({ title: 'Показатели', text }); return; } catch { /* отменили — копируем */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Скопировано в буфер обмена');
    } catch {
      toast('Не удалось поделиться');
    }
  });

  root.querySelector('#pv-csv').addEventListener('click', () => {
    const csv = [
      'Анализ;Значение;Единица;Норма',
      ...rows.map(x => `"${String(x.analysisName).replace(/"/g, '""')}";${fmtV(x.value)};"${x.unit || ''}";"${x.norm || ''}"`),
    ].join('\r\n');
    downloadFile(`pokazateli-${r.date}.csv`, '\uFEFF' + csv, 'text/csv');
    toast('CSV сохранён');
  });

  root.querySelector('#pv-del').addEventListener('click', async () => {
    if (await confirmAction('Удалить запись показаний?')) {
      await db.delete('records', r.id);
      toast('Удалено');
      location.hash = '#/health/records';
    }
  });
}

/* ==================== ИСТОРИЯ ПО АНАЛИЗУ ==================== */
export async function renderAnalysisView(root, id) {
  const [a, records] = await Promise.all([db.get('analyses', id), db.getAll('records')]);
  if (!a) { toast('Анализ не найден'); location.hash = '#/health/analyses'; return; }

  const entries = [];
  for (const r of records) {
    for (const x of (r.results || [])) {
      if (x.analysisId === a.id) entries.push({ date: r.date, note: r.note, value: num(x.value), norm: x.norm || a.norm });
    }
  }
  entries.sort((x, y) => (x.date || '').localeCompare(y.date || ''));

  root.innerHTML = `
    <div class="page-title row between">
      <span>${esc(a.name)}</span>
      <a class="btn sm ghost" href="#/health/analyses">← К анализам</a>
    </div>
    <div class="card">
      <div class="stat-line">
        <span>Единица: <b>${esc(a.unit || '—')}</b></span>
        <span>Норма: <b>${esc(a.norm || '—')}</b></span>
        <span>Записей: <b>${entries.length}</b></span>
      </div>
      <div style="margin-top:10px">
        ${chartSvg(entries.map(e => ({
          x: fmtDateShort(e.date),
          y: e.value ?? 0,
          label: fmtV(e.value),
          out: isOut(e.value, e.norm),
        })))}
      </div>
    </div>
    <div class="section-title">Значения</div>
    ${entries.length ? entries.slice().reverse().map(e => `
      <div class="card">
        <div class="row between">
          <div class="grow">
            <b style="font-size:16px">${fmtV(e.value)} ${esc(a.unit || '')}</b>
            <div class="muted small">${fmtDate(e.date)}${e.note ? ` · ${esc(e.note)}` : ''}</div>
          </div>
          ${isOut(e.value, e.norm) ? '<span class="badge b-out">вне нормы</span>' : '<span class="badge b-ok">в норме</span>'}
        </div>
      </div>`).join('')
    : '<div class="empty">Для этого анализа ещё нет значений.<br>Добавьте их в разделе «Записи».</div>'}
    <div class="btn-row">
      <button class="btn ghost grow" id="an-edit">✏️ Изменить анализ</button>
      <button class="btn danger grow" id="an-del">🗑️ Удалить</button>
    </div>`;

  root.querySelector('#an-edit').addEventListener('click', () => {
    openAnalysisForm(root, a, () => rerender());
  });
  root.querySelector('#an-del').addEventListener('click', async () => {
    if (await confirmAction(`Удалить анализ «${a.name}» из справочника?\nЗначения в записях останутся.`)) {
      await db.delete('analyses', a.id);
      toast('Удалено');
      location.hash = '#/health/analyses';
    }
  });
}
