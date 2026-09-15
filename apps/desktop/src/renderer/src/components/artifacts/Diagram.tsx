import { useEffect, useId, useState } from 'react';

type Mermaid = (typeof import('mermaid'))['default'];

let loading: Promise<Mermaid> | null = null;
/** Mermaid is large: it loads the first time a diagram is drawn, never at startup. */
function loadMermaid() {
  loading ??= import('mermaid').then(module => module.default);
  return loading;
}

const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * A Mermaid diagram, drawn by the bundled Mermaid in strict mode: labels are sanitized, links and
 * scripts in the source are refused, and nothing is fetched. `onRendered` receives the SVG so
 * Download can save exactly what's on screen.
 */
export function Diagram({
  source,
  onRendered,
}: {
  source: string;
  onRendered?: (svg: string | null) => void;
}) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const [result, setResult] = useState<{ source: string; svg?: string; error?: string }>({
    source: '',
  });
  const [scheme, setScheme] = useState(dark);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setScheme(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: scheme ? 'dark' : 'default',
          fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
          flowchart: { htmlLabels: false },
        });
        const { svg } = await mermaid.render(`${id}-${scheme ? 'd' : 'l'}`, source);
        if (!alive) return;
        setResult({ source, svg });
        onRendered?.(svg);
      } catch {
        if (!alive) return;
        setResult({ source, error: 'This diagram has a mistake Edi couldn’t draw.' });
        onRendered?.(null);
      }
    })();
    return () => {
      alive = false;
    };
    // `onRendered` is a callback from the window; redrawing only follows source and theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, scheme, id]);

  if (result.source !== source) return <p className="artifact-diagram-status">Drawing…</p>;
  if (result.error)
    return (
      <div className="artifact-diagram-error">
        <p role="alert">{result.error}</p>
        <pre>{source}</pre>
      </div>
    );
  return (
    <div
      className="artifact-diagram"
      role="img"
      aria-label="Diagram"
      // Mermaid's strict mode sanitizes the SVG it returns.
      dangerouslySetInnerHTML={{ __html: result.svg ?? '' }}
    />
  );
}
