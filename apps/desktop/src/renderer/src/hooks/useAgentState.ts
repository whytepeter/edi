import { useEffect, useState } from 'react';
import { emptyAgentState } from '@edi/contracts';
import '../lib/bridge';

/** Live agent state from main: snapshot first, then pushed updates. */
export function useAgentState() {
  const [state, setState] = useState(emptyAgentState);
  const [loading, setLoading] = useState(Boolean(window.edi));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    const unsubscribe = window.edi.onAgent(value => alive && setState(value));
    window.edi
      .agent()
      .then(value => alive && setState(value))
      .catch(() => alive && setError('Could not load the connection.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { state, loading, error };
}
