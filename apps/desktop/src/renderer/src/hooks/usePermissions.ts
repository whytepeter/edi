import { useEffect, useState } from 'react';
import { emptyPermissionSnapshot } from '@edi/contracts';
import '../lib/bridge';

/** Current OS permission state plus the feature-triggered prompt queue. */
export function usePermissions() {
  const [snapshot, setSnapshot] = useState(emptyPermissionSnapshot);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    const unsubscribe = window.edi.onPermissions(value => alive && setSnapshot(value));
    void window.edi.permissions().then(value => alive && setSnapshot(value));
    const refresh = () => void window.edi?.command({ type: 'permissions-refresh' });
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return snapshot;
}
