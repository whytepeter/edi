import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artifactContentSchema,
  artifactExport,
  artifactPreview,
  viewAsk,
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

test('a view is plain data: each block says what it needs, and nothing else is accepted', () => {
  const view = (blocks: unknown[]) =>
    artifactContentSchema.safeParse({ kind: 'view', title: 'Trip', blocks });
  assert.ok(
    view([
      { type: 'heading', text: 'Lisbon' },
      { type: 'stat', text: 'Total', value: '$952', detail: '4 nights' },
      { type: 'progress', text: 'Budget used', values: [0.63] },
      { type: 'chart', style: 'ring', items: ['Flights', 'Hotel'], values: [412, 540] },
      { type: 'choice', text: 'Which hotel?', items: ['Alfama Loft'], ask: 'Book the hotel:' },
      { type: 'input', text: 'Anything to add?' },
      { type: 'button', text: 'Add to calendar', ask: 'Add the trip to my calendar' },
      { type: 'divider' },
    ]).success,
  );
  const problem = (block: unknown) => view([block]).error?.issues[0]?.message;
  assert.equal(
    problem({ type: 'stat', text: 'Total' }),
    'A stat needs `text` (its label) and `value`.',
  );
  assert.match(problem({ type: 'progress', text: 'Done', values: [63] })!, /between 0 and 1/);
  assert.match(problem({ type: 'chart', items: ['A', 'B'], values: [1] })!, /same number/);
  assert.match(problem({ type: 'choice', text: 'Pick' })!, /needs `items`/);
  // No markup, script or unknown block can ride along.
  assert.equal(view([{ type: 'text', text: 'Hi', html: '<b>x</b>' }]).success, false);
  assert.equal(view([{ type: 'iframe', text: 'x' }]).success, false);
  assert.equal(view([]).success, false);
});

test('a tap in a view becomes the person’s next request, with what they typed', () => {
  const choice = { type: 'choice' as const, text: 'Which hotel?', items: ['Baixa House'] };
  // Without `ask`, the option is the request; with it, the option completes it.
  assert.equal(viewAsk(choice, 'Baixa House'), 'Baixa House');
  assert.equal(
    viewAsk({ ...choice, ask: 'Book the hotel:' }, 'Baixa House'),
    'Book the hotel: Baixa House',
  );
  const button = { type: 'button' as const, text: 'Add to calendar' };
  assert.equal(viewAsk(button, null), 'Add to calendar');
  assert.equal(
    viewAsk({ ...button, ask: 'Add the trip to my calendar' }, null, [
      { label: 'Note', value: ' Late checkout ' },
      { label: 'Empty', value: '  ' },
    ]),
    'Add the trip to my calendar (Note: Late checkout)',
  );
});

test('a view copies and previews as what it says, without what could be tapped', () => {
  const content = {
    kind: 'view' as const,
    title: 'Trip',
    blocks: [
      { type: 'stat' as const, text: 'Total', value: '$952', detail: '4 nights' },
      { type: 'progress' as const, text: 'Budget used', values: [0.63] },
      { type: 'chart' as const, items: ['Thu', 'Fri'], values: [310, 180] },
      { type: 'button' as const, text: 'Add to calendar', ask: 'Add it' },
    ],
  };
  assert.equal(
    artifactExport(content).copy,
    '# Trip\n\n- **Total:** $952 (4 nights)\n- Budget used: 63%\n- Thu: 310\n- Fri: 180\n',
  );
  assert.equal(
    artifactPreview(content),
    '• Total: $952 (4 nights)\n• Budget used: 63%\n• Thu: 310\n• Fri: 180',
  );
  assert.deepEqual(exportFormats.view, ['md']);
});
