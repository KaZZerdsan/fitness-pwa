// Справочник упражнений: название + ссылка на видео
import { db } from './db.js';
import { esc, uid, nowISO, toast, confirmAction } from './util.js';

function rerender() { window.dispatchEvent(new HashChangeEvent('hashchange')); }

export async function render(root) {
  const exercises = (await db.getAll('exercises'))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

  root.innerHTML = `
    <div class="page-title row between">
      <span>Упражнения</span>
      <button class="btn primary sm" id="btn-add">+ Добавить</button>
    </div>
    ${exercises.length ? exercises.map(e => `
      <div class="card">
        <div class="row between">
          <div class="grow">
            <b style="font-size:16px">${esc(e.name)}</b>
            ${e.videoUrl ? `<div><a class="icon-link" href="${esc(e.videoUrl)}" target="_blank" rel="noopener">▶ Видео</a></div>` : '<div class="muted small">без видео</div>'}
          </div>
          <div class="row" style="gap:6px">
            <button class="btn icon" data-edit="${e.id}" title="Изменить">✏️</button>
            <button class="btn icon danger" data-del="${e.id}" title="Удалить">🗑️</button>
          </div>
        </div>
      </div>`).join('')
      : '<div class="empty"><span class="big">🎬</span>Добавьте упражнения — позже выберете их в блоках тренировки.</div>'}
  `;

  root.querySelector('#btn-add').addEventListener('click', () => openForm(root, null));

  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const ex = exercises.find(x => x.id === b.dataset.edit);
    openForm(root, ex);
  }));

  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const ex = exercises.find(x => x.id === b.dataset.del);
    if (await confirmAction(`Удалить упражнение «${ex.name}»?\nВ существующих тренировках блоки останутся, но без названия.`)) {
      await db.delete('exercises', ex.id);
      toast('Упражнение удалено');
      rerender();
    }
  }));
}

/** модальная форма добавления/редактирования */
function openForm(root, ex) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <h3>${ex ? 'Изменить упражнение' : 'Новое упражнение'}</h3>
      <div class="field">
        <label>Название *</label>
        <input id="f-name" type="text" maxlength="80" placeholder="Например: Приседания со штангой" value="${esc(ex?.name || '')}">
      </div>
      <div class="field">
        <label>Ссылка на видео (необязательно)</label>
        <input id="f-url" type="url" inputmode="url" placeholder="https://..." value="${esc(ex?.videoUrl || '')}">
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="f-cancel">Отмена</button>
        <button class="btn primary" id="f-save">Сохранить</button>
      </div>
    </div>`;
  root.appendChild(overlay);

  const nameEl = overlay.querySelector('#f-name');
  nameEl.focus();

  const close = () => overlay.remove();
  overlay.querySelector('#f-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#f-save').addEventListener('click', async () => {
    const name = nameEl.value.trim();
    if (!name) { toast('Укажите название'); nameEl.focus(); return; }
    let url = overlay.querySelector('#f-url').value.trim();
    if (url && !/^(https?:\/\/|www\.)/i.test(url)) url = 'https://' + url;
    await db.put('exercises', {
      id: ex?.id || uid(),
      name,
      videoUrl: url,
      createdAt: ex?.createdAt || nowISO(),
    });
    toast('Сохранено');
    close();
    rerender();
  });
}
