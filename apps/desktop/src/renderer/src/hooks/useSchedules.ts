import { useEffect, useState } from 'react';
import type { Schedule } from '@edi/contracts';

/** Schedules and watches, kept live from main. Null until the first list arrives. */
export function useSchedules() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    void window.edi
      .schedules()
      .then(list => alive && setSchedules(list))
      .catch(() => alive && setSchedules([]));
    const unsubscribe = window.edi.onSchedules(list => alive && setSchedules(list));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return schedules;
}
