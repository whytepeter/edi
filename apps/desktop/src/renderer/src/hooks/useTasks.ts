import { useEffect, useState } from 'react';
import type { Task } from '@edi/contracts';

/** Background tasks, kept live from main. Null until the first list arrives. */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    void window.edi
      .tasks()
      .then(list => alive && setTasks(list))
      .catch(() => alive && setTasks([]));
    const unsubscribe = window.edi.onTasks(list => alive && setTasks(list));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return tasks;
}
