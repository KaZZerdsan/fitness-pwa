// Показатели здоровья: записи, справочник анализов (зоны нормы), превью, выгрузка
import { db } from './db.js';
import { esc, uid, nowISO, todayISO, toast, confirmAction, num, chartSvg, downloadFile, plural,
  zonesFromNorm, zoneText, zonesText, matchZone, valueStatus } from './util.js';

function rerender() { window.dispatchEvent(new HashChangeEvent('hashchange')); }
const fmtV = v => String(v ?? '').replace('.', ',');

/* ---- нормализация при чтении: старое поле norm (строка) → zones ---- */
const normAnalysis = a => a && { ...a, zones: zonesFromNorm(a.zones ?? a.norm), norm: undefined };
const normRecord = r => r && {
  ...r,
  results: (r.results || []).map(x => ({ ...x, zones: zonesFromNorm(x.zones ?? x.norm), norm: undefined })),
};

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
  const records = (await db.getAll('records')).map(normRecord)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (!records.length) {
    el.innerHTML = '<div class="empty"><span class="big">🩺</span>Добавьте результаты анализов — например, после диспансеризации.</div>';
    return;
  }

  el.innerHTML = records.map(r => {
    const bad = (r.results || []).filter(x => valueStatus(x.value, x.zones) === 'bad').length;
    const hasNorms = (r.results || []).some(x => (x.zones || []).length);
    return `
      <div class="card click" data-id="${r.id}">
        <div class="row between">
          <div class="grow">
            <b style="font-size:16px">${fmtDateLocal(r.date)}</b>
            <div class="muted small">${(r.results || []).length} ${plural((r.results || []).length, ['показатель', 'показателя', 'показателей'])}${r.note ? ` · ${esc(r.note)}` : ''}</div>
          </div>
          ${!hasNorms ? '' : bad
            ? `<span class="badge b-out">⚠ ${bad} вне нормы</span>`
            : '<span class="badge b-ok">в норме</span>'}
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('[data-id]').forEach(c => c.addEventListener('click', () => {
    location.hash = `#/record/${c.dataset.id}`;
  }));
}

function fmtDateLocal(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
}

async function renderAnalyses(el) {
  const [analyses, recordsRaw] = await Promise.all([db.getAll('analyses'), db.getAll('records')]);
  const records = recordsRaw.map(normRecord);
  const list = analyses.map(normAnalysis).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="big">📋</span>Справочник пуст. Добавьте виды анализов: гемоглобин, глюкоза и т.д.</div>';
    return;
  }

  el.innerHTML = list.map(a => {
    const uses = records.filter(r => (r.results || []).some(x => x.analysisId === a.id)).length;
    const normLine = (a.zones || []).length ? esc(zonesText(a.zones)) : 'не задана';
    return `
      <div class="card click" data-id="${a.id}">
        <div class="row between">
          <div class="grow">
            <b style="font-size:16px">${esc(a.name)}</b>
            <div class="muted small">${esc(a.unit || '—')} · норма: ${normLine} · записей: ${uses}</div>
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

/** форма анализа (оверлей) с конструктором зон нормы */
function openAnalysisForm(parent, an, after) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  // черновик зон: минимум одна строка
  const zones = (an?.zones || []).map(z => ({ ...z }));
  if (!zones.length) zones.push({ label: '', min: null, max: null, isNorm: true });

  overlay.innerHTML = `
    <div class="sheet">
      <h3>${an ? 'Изменить анализ' : 'Новый анализ'}</h3>
      <div class="field">
        <label>Название *</label>
        <input id="a-name" type="text" maxlength="80" placeholder="Например: Гемоглобин" value="${esc(an?.name || '')}">
      </div>
      <div class="field">
        <label>Единица измерения</label>
        <input id="a-unit" type="text" maxlength="20" placeholder="г/л" value="${esc(an?.unit || '')}">
      </div>
      <div class="set-head">
        <label>Зоны нормы</label>
        <button class="btn sm ghost" id="z-add" type="button">+ Зона</button>
      </div>
      <div id="z-rows"></div>
      <div class="muted small" style="margin:6px 0 12px">
        Укажите «От» и/или «До» (пустое поле = без границы). Пример:
        «Низкий» до 6 · «Норма» 6–12 · «Повышенный» от 12.
        Галочка ✓ — это нормальная зона. Одинаковые «От» и «До» = точное значение.
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="a-cancel">Отмена</button>
        <button class="btn primary" id="a-save">Сохранить</button>
      </div>
    </div>`;
  parent.appendChild(overlay);
  overlay.querySelector('#a-name').focus();

  const rowsEl = overlay.querySelector('#z-rows');

  const zoneVal = v => (v == null ? '' : v);

  function rowHTML(z, i) {
    return `
      <div class="zone-row" data-z="${i}">
        <label class="chk-skip" title="Это нормальная зона">
          <input type="checkbox" data-zf="isNorm" ${z.isNorm ? 'checked' : ''}>
        </label>
        <div class="field">
          <label>Пояснение</label>
          <input data-zf="label" type="text" maxlength="30" placeholder="Низкий / Норма…" value="${esc(z.label || '')}">
        </div>
        <div class="field">
          <label>От</label>
          <input data-zf="min" type="number" inputmode="decimal" step="any" placeholder="—" value="${zoneVal(z.min)}">
        </div>
        <span class="zn">—</span>
        <div class="field">
          <label>До</label>
          <input data-zf="max" type="number" inputmode="decimal" step="any" placeholder="—" value="${zoneVal(z.max)}">
        </div>
        <button class="btn icon sm danger" data-zdel ${zones.length === 1 ? 'disabled' : ''} title="Удалить зону">✕</button>
      </div>`;
  }

  function renderRows() {
    rowsEl.innerHTML = zones.map(rowHTML).join('');
    rowsEl.querySelectorAll('.zone-row').forEach(row => {
      const z = zones[+row.dataset.z];
      row.querySelectorAll('[data-zf]').forEach(inp => {
        inp.addEventListener('input', () => {
          const f = inp.dataset.zf;
          z[f] = f === 'isNorm' ? inp.checked : f === 'label' ? inp.value : num(inp.value);
        });
      });
      row.querySelector('[data-zdel]').addEventListener('click', () => {
        if (zones.length === 1) return;
        zones.splice(+row.dataset.z, 1);
        renderRows();
      });
    });
  }
  renderRows();

  overlay.querySelector('#z-add').addEventListener('click', () => {
    zones.push({ label: '', min: null, max: null, isNorm: false });
    renderRows();
    rowsEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  const close = () => overlay.remove();
  overlay.querySelector('#a-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#a-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#a-name').value.trim();
    if (!name) { toast('Укажите название'); return; }
    const clean = zones
      .map(z => ({
        label: (z.label || '').trim(),
        min: z.min ?? null,
        max: z.max ?? null,
        isNorm: !!z.isNorm,
      }))
      .filter(z => z.min != null || z.max != null)
      .map(z => {
        const a = { ...z };
        if (a.min != null && a.max != null && a.min > a.max) [a.min, a.max] = [a.max, a.min];
        return a;
      });
    if (zones.some(z => z.label && z.min == null && z.max == null)) {
      toast('У зоны с пояснением укажите хотя бы одну границу');
      return;
    }
    await db.put('analyses', {
      id: an?.id || uid(),
      name,
      unit: overlay.querySelector('#a-unit').value.trim(),
      zones: clean,
      createdAt: an?.createdAt || nowISO(),
    });
    toast('Сохранено');
    close();
    after && after();
  });
}

/* ==================== ФОРМА ЗАПИСИ ==================== */
export async function renderRecordForm(root, id) {
  const existing = id ? normRecord(await db.get('records', id)) : null;
  const analyses = (await db.getAll('analyses')).map(normAnalysis)
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
  let analysisList = [...analyses];

  function anOptions(sel) {
    return analysisList.map(a => {
      const norm = (a.zones || []).length ? ` (${zonesText(a.zones)})` : '';
      return `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}${esc(norm)}</option>`;
    }).join('');
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
    card.querySelector('[data-norm]').textContent = a
      ? `единица: ${a.unit || '—'}${(a.zones || []).length ? ' · норма: ' + zonesText(a.zones) : ' · норма не задана'}`
      : '';
  }

  renderRows();

  root.querySelector('#r-add').addEventListener('click', () => {
    if (!analysisList.length) {
      openAnalysisForm(root, null, async () => {
        analysisList = (await db.getAll('analyses')).map(normAnalysis)
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
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
    // снапшот полей анализа (включая зоны нормы)
    draft.results = draft.results.map(r => {
      const a = analysisList.find(x => x.id === r.analysisId);
      return {
        analysisId: a.id,
        analysisName: a.name,
        unit: a.unit || '',
        zones: (a.zones || []).map(z => ({ ...z })),
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
  const r = normRecord(await db.get('records', id));
  if (!r) { toast('Запись не найдена'); location.hash = '#/health/records'; return; }

  const rows = r.results || [];
  const badCount = rows.filter(x => valueStatus(x.value, x.zones) === 'bad').length;
  const hasNorms = rows.some(x => (x.zones || []).length);

  const valueCell = x => {
    const status = valueStatus(x.value, x.zones);
    const z = matchZone(x.value, x.zones);
    const cls = status === 'bad' ? ' val-out' : '';
    // пояснение зоны — в тултип, чтобы не растягивать таблицу
    const tip = z ? (z.label ? `${z.label}: ${zoneText(z)}` : zoneText(z)) : '';
    const arrow = status === 'bad' && z && z.min != null && z.max == null ? ' ↑'
      : status === 'bad' && z && z.max != null && z.min == null ? ' ↓' : '';
    return `<td class="num${cls}"${tip ? ` title="${esc(tip)}"` : ''}>${fmtV(x.value)}${x.unit ? ` ${esc(x.unit)}` : ''}${arrow}</td>`;
  };

  root.innerHTML = `
    <div class="page-title row between">
      <span>Запись показаний</span>
      <a class="btn sm ghost" href="#/health/records">← К записям</a>
    </div>
    <div class="preview-card" id="preview">
      <div class="p-head">
        <span class="p-title">Показатели</span>
        <span class="p-date">${fmtDateLocal(r.date)}${r.note ? ` · ${esc(r.note)}` : ''}</span>
      </div>
      ${rows.length ? `
        <table class="p-table">
          <tr><th>Анализ</th><th style="text-align:right">Значение</th><th style="text-align:right">Норма</th></tr>
          ${rows.map(x => `<tr>
            <td>${esc(x.analysisName)}</td>
            ${valueCell(x)}
            <td class="norm">${esc((x.zones || []).length ? zonesText(x.zones) : '—')}</td>
          </tr>`).join('')}
        </table>`
      : '<div class="p-note">Нет показателей</div>'}
      ${!hasNorms ? '<div class="p-note">Нормы не заданы</div>'
        : badCount ? `<div class="p-note" style="color:#d32f2f;font-weight:700">⚠ ${badCount} ${plural(badCount, ['значение', 'значения', 'значений'])} вне нормы</div>`
        : '<div class="p-note" style="color:#2e7d32;font-weight:700">✓ Все значения в норме</div>'}
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
    const lines = [`Показатели — ${fmtDateLocal(r.date)}`];
    if (r.note) lines.push(r.note);
    for (const x of rows) {
      const status = valueStatus(x.value, x.zones);
      const z = matchZone(x.value, x.zones);
      let tail = '';
      if ((x.zones || []).length) {
        if (z) tail = ` (${z.label ? z.label + ': ' : ''}${zoneText(z)}${status === 'ok' ? ' ✓' : ' ⚠'})`;
        else tail = ' ⚠ вне диапазонов';
      }
      lines.push(`• ${x.analysisName}: ${fmtV(x.value)}${x.unit ? ' ' + x.unit : ''}${tail}`);
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
      'Анализ;Значение;Единица;Норма;Статус',
      ...rows.map(x => {
        const status = valueStatus(x.value, x.zones);
        const z = matchZone(x.value, x.zones);
        const st = !(x.zones || []).length ? '' : status === 'ok' ? 'норма' : (z ? (z.label || 'вне нормы') : 'вне диапазонов');
        return `"${String(x.analysisName).replace(/"/g, '""')}";${fmtV(x.value)};"${x.unit || ''}";"${(x.zones || []).length ? zonesText(x.zones) : ''}";"${st}"`;
      }),
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
  const [aRaw, recordsRaw] = await Promise.all([db.get('analyses', id), db.getAll('records')]);
  if (!aRaw) { toast('Анализ не найден'); location.hash = '#/health/analyses'; return; }
  const a = normAnalysis(aRaw);
  const records = recordsRaw.map(normRecord);

  const entries = [];
  for (const r of records) {
    for (const x of (r.results || [])) {
      if (x.analysisId === a.id) entries.push({ date: r.date, note: r.note, value: num(x.value), zones: x.zones || a.zones });
    }
  }
  entries.sort((x, y) => (x.date || '').localeCompare(y.date || ''));

  const zoneBadge = e => {
    const status = valueStatus(e.value, e.zones);
    if (status === 'none') return '<span class="badge b-ok">без нормы</span>';
    if (status === 'ok') {
      const z = matchZone(e.value, e.zones);
      return `<span class="badge b-ok">${z?.label ? esc(z.label) : 'в норме'}</span>`;
    }
    const z = matchZone(e.value, e.zones);
    return `<span class="badge b-out">${z?.label ? esc(z.label) : 'вне нормы'}</span>`;
  };

  root.innerHTML = `
    <div class="page-title row between">
      <span>${esc(a.name)}</span>
      <a class="btn sm ghost" href="#/health/analyses">← К анализам</a>
    </div>
    <div class="card">
      <div class="stat-line">
        <span>Единица: <b>${esc(a.unit || '—')}</b></span>
        <span>Записей: <b>${entries.length}</b></span>
      </div>
      ${(a.zones || []).length ? `
        <div style="margin-top:8px">
          ${(a.zones || []).map(z => `
            <div class="row between small" style="padding:3px 0">
              <span>${z.label ? esc(z.label) : '<span class="muted">без пояснения</span>'} ${zoneText(z)}</span>
              ${z.isNorm ? '<span class="badge b-ok">норма</span>' : ''}
            </div>`).join('')}
        </div>` : '<div class="muted small" style="margin-top:6px">Норма не задана</div>'}
      <div style="margin-top:10px">
        ${chartSvg(entries.map(e => ({
          x: e.date ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(e.date)) : '',
          y: e.value ?? 0,
          label: fmtV(e.value),
          out: valueStatus(e.value, e.zones) === 'bad',
        })))}
      </div>
    </div>
    <div class="section-title">Значения</div>
    ${entries.length ? entries.slice().reverse().map(e => `
      <div class="card">
        <div class="row between">
          <div class="grow">
            <b style="font-size:16px">${fmtV(e.value)} ${esc(a.unit || '')}</b>
            <div class="muted small">${fmtDateLocal(e.date)}${e.note ? ` · ${esc(e.note)}` : ''}</div>
          </div>
          ${zoneBadge(e)}
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
