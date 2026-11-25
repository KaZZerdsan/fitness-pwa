// Операции жизненного цикла тренировки + нормализация формата блоков
import { db } from './db.js';
import { uid, nowISO } from './util.js';

/** число кругов блока = максимум подходов среди его упражнений */
export const blockRounds = b =>
  Math.max(1, ...(b.items || []).map(i => i.setsList?.length || 0));

const normTempo = t => (Array.isArray(t) ? t.map(x => Math.max(0, Math.round(+x || 0))) : [3, 0, 1, 0]);

/* ---- нормализация: старые форматы → текущий (подходы внутри упражнения) ---- */
export function normalizeWorkout(w) {
  if (!w || !Array.isArray(w.blocks)) return w;

  // v0 (одно упражнение в блоке) → промежуточный (items[])
  if (w.blocks.length && !w.blocks[0].items) {
    w.blocks = w.blocks.map(b => ({
      title: b.title || '',
      restSec: Math.max(0, Math.round(+b.restSec || 0)),
      _rounds: Math.max(1, Math.round(+b.sets || 1)),
      items: [{ exerciseId: b.exerciseId, weight: +b.weight || 0, reps: +b.reps || 0, tempo: b.tempo }],
    }));
  }

  // план → v2 (подходы внутри упражнения)
  w.blocks.forEach(b => {
    const rounds = Math.max(1, Math.round(+b.sets || +b._rounds || 0) || 1);
    delete b._rounds;
    b.restSec = Math.max(0, Math.round(+b.restSec || 0));
    b.items = (b.items || []).map(it => {
      if (Array.isArray(it.setsList)) {
        return {
          exerciseId: it.exerciseId,
          comment: it.comment || '',
          tempo: normTempo(it.tempo),
          setsList: it.setsList.map(s => ({ weight: +s.weight || 0, reps: Math.max(1, Math.round(+s.reps || 1)) })),
        };
      }
      // v1: один вес/повторы на упражнение, круги задавались на блоке
      const set = { weight: +it.weight || 0, reps: Math.max(1, Math.round(+it.reps || 1)) };
      return {
        exerciseId: it.exerciseId,
        comment: it.comment || '',
        tempo: normTempo(it.tempo),
        setsList: Array.from({ length: rounds }, () => ({ ...set })),
      };
    });
    delete b.sets;
  });

  // факт
  if (Array.isArray(w.actualBlocks) && w.actualBlocks.length) {
    if (!w.actualBlocks[0].items) {
      // v0 факт → промежуточный (items[])
      w.actualBlocks = w.actualBlocks.map((f, i) => ({
        title: f.title || w.blocks[i]?.title || '',
        restSec: w.blocks[i]?.restSec ?? 0,
        skipped: !!f.skipped,
        items: [{ exerciseId: f.exerciseId, actualWeight: +f.weight || 0, actualReps: +f.reps || 0 }],
      }));
    }
    w.actualBlocks.forEach((f, i) => {
      const planItems = w.blocks[i]?.items || [];
      f.skipped = !!f.skipped;
      f.restSec = w.blocks[i]?.restSec ?? f.restSec ?? 0;
      const oldRounds = Math.round(+f.setsActual || 0); // сколько кругов сделано в старом формате
      delete f.sets; delete f.setsActual;
      f.items = (f.items || []).map((it, j) => {
        const plan = planItems[j];
        if (Array.isArray(it.actualSets)) {
          return {
            exerciseId: it.exerciseId,
            comment: plan?.comment || '',
            tempo: normTempo(plan?.tempo ?? it.tempo),
            setsList: (plan?.setsList || []).map(s => ({ ...s })),
            actualSets: it.actualSets.map(s => ({
              weight: +s.weight || 0,
              reps: Math.max(0, Math.round(+s.reps || 0)),
              skipped: !!s.skipped,
            })),
          };
        }
        // v1 факт: actualWeight/actualReps на упражнении (+ число кругов на блоке)
        const planSets = plan?.setsList || [];
        return {
          exerciseId: it.exerciseId,
          comment: plan?.comment || '',
          tempo: normTempo(plan?.tempo ?? it.tempo),
          setsList: planSets.map(s => ({ ...s })),
          actualSets: planSets.map((_, k) => ({
            weight: +it.actualWeight || 0,
            reps: Math.max(0, Math.round(+it.actualReps || 0)),
            skipped: oldRounds > 0 && k >= oldRounds,
          })),
        };
      });
    });
  }
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
  return (b.items || []).some((it, i) => {
    const fi = f.items?.[i];
    if (!fi) return true;
    const plan = it.setsList || [];
    const fact = fi.actualSets || [];
    if (fact.length !== plan.length) return true;
    return plan.some((s, k) => {
      const a = fact[k];
      if (!a || a.skipped) return true;
      return (+a.weight !== +s.weight) || (+a.reps !== +s.reps);
    });
  });
}

/** запустить тренировку: created → in_progress (с копией блоков в факт) */
export async function startWorkout(w) {
  if (w.status === 'in_progress') return w;
  w.status = 'in_progress';
  w.startedAt = nowISO();
  w.actualBlocks = w.blocks.map(b => ({
    title: b.title,
    restSec: b.restSec,
    skipped: false,
    items: b.items.map(it => ({
      exerciseId: it.exerciseId,
      comment: it.comment,
      tempo: [...it.tempo],
      setsList: it.setsList.map(s => ({ ...s })),
      actualSets: it.setsList.map(s => ({ weight: s.weight, reps: s.reps, skipped: false })),
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
      restSec: b.restSec,
      items: b.items.map(it => ({
        exerciseId: it.exerciseId,
        comment: it.comment || '',
        tempo: [...it.tempo],
        setsList: it.setsList.map(s => ({ ...s })),
      })),
    })),
    actualBlocks: [],
    stats: {},
  };
  return db.put('workouts', copy);
}
