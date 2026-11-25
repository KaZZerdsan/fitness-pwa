// Операции жизненного цикла тренировки + нормализация формата блоков
import { db } from './db.js';
import { uid, nowISO } from './util.js';

/* ---- нормализация: старый формат (1 упражнение в блоке) → новый (items[]) ---- */
export function normalizeWorkout(w) {
  if (!w || !Array.isArray(w.blocks)) return w;

  // план
  if (w.blocks.length && !w.blocks[0].items) {
    w.blocks = w.blocks.map(b => ({
      title: b.title || '',
      sets: Math.max(1, Math.round(+b.sets || 1)),
      restSec: Math.max(0, Math.round(+b.restSec || 0)),
      items: [{
        exerciseId: b.exerciseId,
        weight: +b.weight || 0,
        reps: +b.reps || 0,
        tempo: Array.isArray(b.tempo) ? b.tempo : [3, 0, 1, 0],
      }],
    }));
  }
  w.blocks.forEach(b => {
    b.sets = Math.max(1, Math.round(+b.sets || 1));
    b.restSec = Math.max(0, Math.round(+b.restSec || 0));
    b.items = (b.items || []).map(it => ({
      exerciseId: it.exerciseId,
      weight: +it.weight || 0,
      reps: +it.reps || 0,
      tempo: Array.isArray(it.tempo) ? it.tempo : [3, 0, 1, 0],
    }));
  });

  // факт
  if (Array.isArray(w.actualBlocks) && w.actualBlocks.length && !w.actualBlocks[0].items) {
    w.actualBlocks = w.actualBlocks.map((f, i) => {
      const plan = w.blocks[i] || { title: '', sets: 1, restSec: 0, items: [] };
      return {
        title: f.title || plan.title,
        sets: plan.sets,
        restSec: plan.restSec,
        skipped: !!f.skipped,
        setsActual: +f.sets || 0,
        items: [{
          exerciseId: f.exerciseId,
          weight: plan.items[0]?.weight ?? (+f.weight || 0),
          reps: plan.items[0]?.reps ?? (+f.reps || 0),
          tempo: plan.items[0]?.tempo ?? f.tempo ?? [3, 0, 1, 0],
          actualWeight: +f.weight || 0,
          actualReps: +f.reps || 0,
        }],
      };
    });
  }
  (w.actualBlocks || []).forEach((f, i) => {
    const plan = w.blocks[i];
    f.sets = plan?.sets ?? f.sets;
    f.restSec = plan?.restSec ?? f.restSec;
    f.setsActual = +f.setsActual ?? 0;
    f.items = (f.items || []).map((it, j) => ({
      exerciseId: it.exerciseId,
      weight: plan?.items?.[j]?.weight ?? (+it.weight || 0),
      reps: plan?.items?.[j]?.reps ?? (+it.reps || 0),
      tempo: plan?.items?.[j]?.tempo ?? it.tempo ?? [3, 0, 1, 0],
      actualWeight: +it.actualWeight ?? 0,
      actualReps: +it.actualReps ?? 0,
    }));
  });
  return w;
}

export async function getWorkouts() {
  return (await db.getAll('workouts')).map(normalizeWorkout);
}

export async function getWorkout(id) {
  return normalizeWorkout(await db.get('workouts', id));
}

/** есть ли у блока отклонения факта от плана */
export function blockHasDiff(b, f) {
  if (!f) return false;
  if (f.skipped) return true;
  if (Math.round(+f.setsActual || 0) !== +b.sets) return true;
  return (b.items || []).some((it, i) => {
    const fi = f.items?.[i];
    if (!fi) return true;
    return (+fi.actualWeight !== +it.weight) || (+fi.actualReps !== +it.reps);
  });
}

/** запустить тренировку: created → in_progress (с копией блоков в факт) */
export async function startWorkout(w) {
  if (w.status === 'in_progress') return w;
  w.status = 'in_progress';
  w.startedAt = nowISO();
  w.actualBlocks = w.blocks.map(b => ({
    title: b.title,
    sets: b.sets,
    restSec: b.restSec,
    skipped: false,
    setsActual: b.sets,
    items: b.items.map(it => ({
      exerciseId: it.exerciseId,
      weight: it.weight,
      reps: it.reps,
      tempo: [...it.tempo],
      actualWeight: it.weight,
      actualReps: it.reps,
    })),
  }));
  w.progress = { blockIndex: 0, setIndex: 0, itemIndex: 0, restEndsAt: null };
  w.stats = {};
  return db.put('workouts', w);
}

/** отмена выполнения: in_progress → created, всё выполненное сбрасывается */
export async function cancelWorkout(w) {
  w.status = 'created';
  w.startedAt = null;
  w.actualBlocks = [];
  w.progress = null;
  w.stats = {};
  return db.put('workouts', w);
}

/** копия тренировки со статусом «создана» (план без факта) */
export async function repeatWorkout(w) {
  const copy = {
    id: uid(),
    name: w.name,
    status: 'created',
    createdAt: nowISO(),
    startedAt: null,
    finishedAt: null,
    progress: null,
    blocks: w.blocks.map(b => ({
      title: b.title || '',
      sets: b.sets,
      restSec: b.restSec,
      items: b.items.map(it => ({
        exerciseId: it.exerciseId,
        weight: it.weight,
        reps: it.reps,
        tempo: [...it.tempo],
      })),
    })),
    actualBlocks: [],
    stats: {},
  };
  return db.put('workouts', copy);
}
