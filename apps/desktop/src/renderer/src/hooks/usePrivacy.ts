import { useEffect, useState } from 'react';
import type { PrivacyState } from '@edi/contracts';
import '../lib/bridge';

/** Privacy mode now: whether Edi is looking, and the app sharing the screen when one is. */
export function usePrivacy() {
  const [state, setState] = useState<PrivacyState>({ paused: null, sharingApp: null });
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    const unsubscribe = window.edi.onPrivacy(value => alive && setState(value));
    void window.edi
      .privacy()
      .then(value => alive && setState(value))
      .catch(() => {});
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return state;
}
