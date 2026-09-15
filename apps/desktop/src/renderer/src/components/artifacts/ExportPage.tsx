import { useEffect, useRef, useState } from 'react';
import type { Artifact, ArtifactRef } from '@edi/contracts';
import { ArtifactBody } from './Artifact';
import './artifacts.css';
import './export-page.css';

type Format = 'pdf' | 'png' | 'svg';

const ready = (result: { svg?: string; png?: string; failed?: boolean }) =>
  window.edi?.command({ type: 'export-ready', ...result });

/** Two frames after layout, so what main prints is what was drawn. */
const settled = () =>
  new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

/**
 * The drawn diagram as a file of its own: explicit size from its viewBox and a white ground,
 * serialized from the live element so the markup is always well-formed XML.
 */
function standaloneSvg(element: SVGSVGElement) {
  const copy = element.cloneNode(true) as SVGSVGElement;
  const [, , width, height] = (copy.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (width && height) {
    copy.setAttribute('width', String(Math.ceil(width)));
    copy.setAttribute('height', String(Math.ceil(height)));
  }
  copy.setAttribute('style', 'background-color: #ffffff');
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { svg: new XMLSerializer().serializeToString(copy), width, height };
}

/** A PNG at twice the drawn size (capped), on white. */
async function rasterize(svg: string, width = 800, height = 600) {
  const scale = Math.min(2, 8000 / Math.max(width, height));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** A document's own first heading already names it; everything else gets its title on top. */
function showsTitle(artifact: Artifact) {
  if (artifact.kind === 'document' || artifact.kind === 'note')
    return !/^\s*#\s/.test(artifact.markdown);
  return artifact.kind !== 'html';
}

/**
 * Never shown. Main opens this page hidden to export content: it draws the artifact on white,
 * page-width, with the same components as the artifact window, then reports that it's ready.
 * Main prints it to PDF; for a diagram picture, the page hands back the SVG or PNG itself.
 */
export function ExportPage({ reference, format }: { reference: ArtifactRef | null; format: Format }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const root = useRef<HTMLElement>(null);
  const reported = useRef(false);
  const report = (result: Parameters<typeof ready>[0]) => {
    if (reported.current) return;
    reported.current = true;
    void ready(result);
  };

  useEffect(() => {
    if (!reference || !window.edi) return report({ failed: true });
    window.edi
      .artifact(reference)
      .then(setArtifact)
      .catch(() => report({ failed: true }));
    // Main opens one page per export; the reference never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything but a diagram is ready once laid out and its fonts have loaded.
  useEffect(() => {
    if (!artifact || artifact.kind === 'diagram') return;
    void document.fonts.ready.then(settled).then(() => report({}));
  }, [artifact]);

  const onDiagram = async (svg: string | null) => {
    if (!svg) return report({ failed: true });
    try {
      // Mermaid hands over its SVG before React has put it on the page.
      await settled();
      const element = root.current?.querySelector<SVGSVGElement>('.artifact-diagram svg');
      if (!element) return report({ failed: true });
      const file = standaloneSvg(element);
      if (format === 'png') return report({ png: await rasterize(file.svg, file.width, file.height) });
      // A PDF prints this page; the SVG lets main turn a wide diagram's page sideways.
      report({ svg: file.svg });
    } catch {
      report({ failed: true });
    }
  };

  if (!artifact || !reference) return null;
  return (
    <main ref={root} className="export-page" data-kind={artifact.kind}>
      {showsTitle(artifact) && <h1 className="export-title">{artifact.title}</h1>}
      <ArtifactBody
        artifact={artifact}
        reference={reference}
        light
        onDiagram={svg => void onDiagram(svg)}
      />
    </main>
  );
}
