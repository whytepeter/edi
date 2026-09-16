import { useEffect, useState } from 'react';
import type { Memory } from '@edi/contracts';
import '../lib/bridge';

/** What Edi remembers about the person, kept current as it remembers or forgets. */
export function useMemories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    const unsubscribe = window.edi.onMemories(value => alive && setMemories(value));
    void window.edi
      .memories()
      .then(value => alive && setMemories(value))
      .catch(() => {});
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return memories;
}
