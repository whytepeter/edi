import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artifactExport,
  artifactTextExport,
  exportFileName,
  exportFormats,
  placeArtifact,
} from './index';

test('artifact exports: Markdown to copy, Markdown or CSV to save', () => {
  const doc = artifactExport({ kind: 'document', title: 'Report', markdown: '# Hi\n\nText' });
  assert.deepEqual(doc, { copy: '# Hi\n\nText', extension: 'md', file: '# Hi\n\nText\n' });

  const list = artifactExport({
    kind: 'checklist',
    title: 'Packing',
    items: [
      { text: 'Passport', done: true },
      { text: 'Charger', done: false },
    ],
  });
  assert.equal(list.extension, 'md');
  assert.equal(list.copy, '# Packing\n\n- [x] Passport\n- [ ] Charger\n');

  const table = artifactExport({
    kind: 'table',
    title: 'Models',
    columns: ['Name', 'Note'],
    rows: [['Flash', 'fast, cheap'], ['Opus | deep']],
  });
  assert.equal(table.extension, 'csv');
  assert.equal(table.file, 'Name,Note\nFlash,"fast, cheap"\nOpus | deep\n');
  assert.equal(
    table.copy,
    '| Name | Note |\n| --- | --- |\n| Flash | fast, cheap |\n| Opus \\| deep |  |\n',
  );
});

test('the artifact window opens beside the card, away from Edi, inside the display', () => {
  const area = { x: 0, y: 25, width: 1800, height: 1144 };
  const size = { width: 560, height: 640 };
  const card = { x: 900, y: 400, width: 424, height: 496 };
  // Edi to the right of the card: the window goes left of it.
  const left = placeArtifact(card, { x: 1330, y: 800, width: 112, height: 120 }, area, size);
  assert.equal(left.x + left.width <= card.x, true);
  assert.equal(left.y, card.y);
  // Edi to the left: the window goes right.
  const middle = { ...card, x: 600 };
  const right = placeArtifact(middle, { x: 400, y: 800, width: 112, height: 120 }, area, size);
  assert.equal(right.x >= middle.x + middle.width, true);
  // No room on Edi's far side: it takes the other side.
  const edge = { ...card, x: 200 };
  const flipped = placeArtifact(edge, { x: 640, y: 800, width: 112, height: 120 }, area, size);
  assert.equal(flipped.x >= edge.x + edge.width, true);
  // Near the bottom, it moves up to stay on screen.
  const low = placeArtifact(
    { ...card, y: 900 },
    { x: 1330, y: 1000, width: 112, height: 120 },
    area,
    size,
  );
  assert.equal(low.y + low.height <= area.y + area.height, true);
});

test('exports: each kind offers its formats, text formats come from the content', () => {
  assert.deepEqual(exportFormats.table, ['csv', 'pdf', 'md']);
  assert.deepEqual(exportFormats.diagram, ['png', 'svg', 'pdf', 'mmd']);
  const table = {
    kind: 'table' as const,
    title: 'Costs',
    columns: ['Item', 'Amount'],
    rows: [['Hosting', '1,200']],
  };
  assert.equal(artifactTextExport(table, 'csv'), 'Item,Amount\nHosting,"1,200"\n');
  assert.equal(
    artifactTextExport(table, 'md'),
    '# Costs\n\n| Item | Amount |\n| --- | --- |\n| Hosting | 1,200 |\n',
  );
  const diagram = { kind: 'diagram' as const, title: 'Flow', mermaid: 'flowchart LR\n  a --> b' };
  assert.equal(artifactTextExport(diagram, 'mmd'), 'flowchart LR\n  a --> b\n');
  // PDFs and pictures are drawn by the host; a kind never exports as a format it lacks.
  assert.throws(() => artifactTextExport(diagram, 'png'));
  assert.throws(() => artifactTextExport(table, 'html'));
});

test('export file names keep the title but nothing Finder refuses', () => {
  assert.equal(exportFileName('Costs / Q3: plan?', 'pdf'), 'Costs - Q3- plan-.pdf');
  assert.equal(exportFileName('..hidden', 'md'), 'hidden.md');
  assert.equal(exportFileName('a\u0007b', 'csv'), 'a-b.csv');
  assert.equal(exportFileName('   ', 'png'), 'Edi.png');
});
