// Операции жизненного цикла тренировки
import { db } from './db.js';
import { uid, nowISO } from './util.js';

/** запустить тренировку: created → in_progress (с копией блоков в факт) */
export async function startWorkout(w) {
  if (w.status === 'in_progress') return w;
  w.status = 'in_progress';
  w.startedAt = nowISO();
  w.actualBlocks = w.blocks.map(b => ({ ...b, skipped: false }));
  w.progress = { blockIndex: 0, setIndex: 0, restEndsAt: null };
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
      exerciseId: b.exerciseId,
      weight: b.weight,
      sets: b.sets,
      reps: b.reps,
      tempo: [...(b.tempo || [3, 0, 1, 0])],
      restSec: b.restSec,
    })),
    actualBlocks: [],
    stats: {},
  };
  return db.put('workouts', copy);
}
