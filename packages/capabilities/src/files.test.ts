import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileCapabilities, type FileRoot } from './index';

const context = {
  callId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};
const live = () => new AbortController().signal;

async function home() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'edi-files-')));
  for (const folder of [
    'Desktop',
    'Documents/Edi/Notes',
    'Downloads/Invoices',
    'Secret',
    'Library',
  ])
    await mkdir(join(base, folder), { recursive: true });
  await writeFile(join(base, 'Downloads/Invoices/march-invoice.txt'), 'Total: 42 EUR');
  await writeFile(join(base, 'Downloads/.hidden-invoice.txt'), 'hidden');
  await writeFile(
    join(base, 'Downloads/photo.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]),
  );
  await writeFile(join(base, 'Desktop/notes.md'), `# Plan\n${'x'.repeat(50_000)}`);
  await writeFile(join(base, 'Documents/Edi/Notes/list.md'), '- milk');
  await writeFile(join(base, 'Secret/passwords.txt'), 'nope');
  await symlink(join(base, 'Secret'), join(base, 'Downloads/escape'));
  const roots: FileRoot[] = [
    { name: 'Desktop', path: join(base, 'Desktop'), access: 'allowed' },
    { name: 'Documents', path: join(base, 'Documents'), access: 'allowed' },
    { name: 'Downloads', path: join(base, 'Downloads'), access: 'not-checked' },
  ];
  const trashed: string[] = [];
  const results: [string, boolean][] = [];
  const tools = fileCapabilities({
    home: base,
    roots: () => roots,
    workspace: join(base, 'Documents/Edi'),
    trash: async path => {
      trashed.push(path);
    },
    accessResult: (root, allowed) => results.push([root.name, allowed]),
    spotlight: async () => [],
  });
  const tool = (id: string) => tools.find(entry => entry.id === id)!;
  const run = async (id: string, input: unknown) =>
    (await tool(id).prepare(input as never, context)).execute(live());
  return { base, roots, trashed, results, tool, run };
}

test('a name retyped with plain spaces finds the macOS name with a narrow no-break space', async () => {
  const { base, run } = await home();
  const shot = 'Screenshot 2026-09-11 at 10.35.11 PM.png';
  await writeFile(join(base, 'Desktop', shot), 'png');
  await mkdir(join(base, 'Desktop/Screenshots'));
  const moved = await run('files.move', {
    moves: [
      {
        from: '~/Desktop/Screenshot 2026-09-11 at 10.35.11 PM.png',
        to: '~/Desktop/Screenshots/Screenshot 2026-09-11 at 10.35.11 PM.png',
      },
    ],
  });
  assert.equal(moved.summary, 'Moved 1 item.');
  assert.deepEqual(await readdir(join(base, 'Desktop/Screenshots')), [
    'Screenshot 2026-09-11 at 10.35.11 PM.png',
  ]);
  // Reading works the same way.
  await writeFile(join(base, 'Desktop', 'It’s done.txt'), 'yes');
  assert.equal(
    ((await run('files.read', { path: "~/Desktop/It's done.txt" })).output as { text: string })
      .text,
    'yes',
  );
});

test('search finds by name across allowed folders, skipping hidden items and refused folders', async () => {
  const { run, roots, results } = await home();
  const found = (await run('files.search', { query: 'invoice' })).output as {
    results: { path: string; kind: string }[];
  };
  assert.deepEqual(found.results.map(entry => entry.path).sort(), [
    '~/Downloads/Invoices',
    '~/Downloads/Invoices/march-invoice.txt',
  ]);
  // Touching Downloads recorded that macOS allowed it.
  assert.deepEqual(results, [['Downloads', true]]);

  roots[2] = { ...roots[2]!, access: 'off' };
  const none = (await run('files.search', { query: 'invoice' })).output as { results: unknown[] };
  assert.equal(none.results.length, 0);
  await assert.rejects(
    run('files.list', { path: '~/Downloads' }),
    /doesn’t have access to Downloads/,
  );
});

test('paths outside the allowed folders, including through a symlink, are refused', async () => {
  const { run } = await home();
  await assert.rejects(
    run('files.read', { path: '~/Secret/passwords.txt' }),
    /outside the folders/,
  );
  await assert.rejects(
    run('files.read', { path: '~/Downloads/escape/passwords.txt' }),
    /outside the folders/,
  );
  await assert.rejects(run('files.read', { path: 'Downloads/x' }), /full path/);
});

test('list and read: folders first, text in parts, binary refused', async () => {
  const { run } = await home();
  const listed = (await run('files.list', { path: '~/Downloads' })).output as {
    items: { name: string; kind: string }[];
  };
  assert.deepEqual(
    listed.items.map(item => [item.name, item.kind]),
    [
      ['escape', 'file'],
      ['Invoices', 'folder'],
      ['photo.png', 'file'],
    ].sort((a, b) => (a[1] === b[1] ? a[0]!.localeCompare(b[0]!) : a[1] === 'folder' ? -1 : 1)),
  );
  const first = (await run('files.read', { path: '~/Desktop/notes.md' })).output as {
    text: string;
    nextStartIndex?: number;
  };
  assert.equal(first.text.length, 40_000);
  assert.equal(first.nextStartIndex, 40_000);
  await assert.rejects(run('files.read', { path: '~/Downloads/photo.png' }), /isn’t text/);
  // Edi's workspace can be read, never changed, by these tools.
  const note = (await run('files.read', { path: '~/Documents/Edi/Notes/list.md' })).output as {
    text: string;
  };
  assert.equal(note.text, '- milk');
});

test('changes are previewed exactly and refuse the workspace, Library, roots and overwrites', async () => {
  const { base, run, tool, trashed } = await home();
  const prepared = await tool('files.move').prepare(
    {
      moves: [{ from: '~/Downloads/Invoices/march-invoice.txt', to: '~/Desktop/march.txt' }],
    } as never,
    context,
  );
  assert.equal(prepared.preview.action, 'Move');
  assert.deepEqual(prepared.preview.fields, [
    { label: 'From', value: '~/Downloads/Invoices/march-invoice.txt' },
    { label: 'To', value: '~/Desktop/march.txt' },
  ]);
  await prepared.execute(live());
  assert.ok((await readdir(join(base, 'Desktop'))).includes('march.txt'));

  const rename = await tool('files.move').prepare(
    { moves: [{ from: '~/Desktop/march.txt', to: '~/Desktop/notes.md' }] } as never,
    context,
  );
  assert.equal(rename.preview.action, 'Rename');
  await assert.rejects(rename.execute(live()), /already exists/);

  for (const path of ['~/Documents/Edi/Notes/list.md', '~/Downloads', '~/Library/x'])
    await assert.rejects(
      tool('files.trash').prepare({ paths: [path] } as never, context) as Promise<unknown>,
      /workspace|Downloads itself|Library/,
    );

  await run('files.create_folder', { paths: ['~/Desktop/Receipts'] });
  assert.ok((await readdir(join(base, 'Desktop'))).includes('Receipts'));
  await run('files.trash', { paths: ['~/Desktop/Receipts'] });
  assert.deepEqual(trashed, [join(base, 'Desktop/Receipts')]);
});

test('a batch is reviewed once, runs every item and reports the ones that did not work', async () => {
  const { base, tool } = await home();
  for (const name of ['a.png', 'b.png', 'c.png'])
    await writeFile(join(base, 'Desktop', name), 'png');
  const folders = await tool('files.create_folder').prepare(
    { paths: ['~/Desktop/Screenshots', '~/Desktop/Screenshots/Old'] } as never,
    context,
  );
  assert.equal(folders.preview.summary, 'Create 2 folders.');
  await folders.execute(live());

  const batch = await tool('files.move').prepare(
    {
      moves: ['a.png', 'b.png', 'c.png', 'notes.md'].map(name => ({
        from: `~/Desktop/${name}`,
        to: `~/Desktop/Screenshots/${name}`,
      })),
    } as never,
    context,
  );
  assert.equal(batch.preview.summary, 'Move 4 items into ~/Desktop/Screenshots.');
  assert.equal(batch.preview.body, 'a.png\nb.png\nc.png\nnotes.md');
  await writeFile(join(base, 'Desktop/Screenshots/notes.md'), 'already here');
  const result = await batch.execute(live());
  assert.match(result.summary, /^Moved 3 items; 1 didn’t work \(notes\.md\)\.$/);
  assert.deepEqual((await readdir(join(base, 'Desktop/Screenshots'))).sort(), [
    'Old',
    'a.png',
    'b.png',
    'c.png',
    'notes.md',
  ]);
  await assert.rejects(
    tool('files.move').prepare(
      {
        moves: [
          { from: '~/Desktop/notes.md', to: '~/Desktop/x.md' },
          { from: '~/Downloads/photo.png', to: '~/Desktop/x.md' },
        ],
      } as never,
      context,
    ) as Promise<unknown>,
    /Two items would be moved/,
  );
});

test('search ranks what a person means: named documents first, code projects and tool folders last', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'edi-rank-')));
  const files = [
    'Documents/code/app/.git/HEAD',
    'Documents/code/app/src/resume-worker.ts',
    'Documents/code/app/src/parser.ts',
    'Documents/code/env/my-venv/lib/site-packages/resume.py',
    'Documents/Whyte Peter/Docs/Whyte Peter Resume .pdf',
    'Documents/Whyte Peter/Docs/Cover letter.pdf',
    'Documents/notes/resume ideas.md',
  ];
  for (const file of files) {
    await mkdir(join(base, file, '..'), { recursive: true });
    await writeFile(join(base, file), 'resume');
  }
  const asked: string[] = [];
  const [search] = fileCapabilities({
    home: base,
    roots: () => [{ name: 'Documents', path: join(base, 'Documents'), access: 'allowed' }],
    workspace: join(base, 'Documents/Edi'),
    trash: async () => {},
    // Spotlight's own order puts code first; content matches include files without the word in
    // their name.
    spotlight: async (_root, _query, _signal, by) => {
      asked.push(by);
      const all = files.filter(file => !file.includes('.git/')).map(file => join(base, file));
      return by === 'name' ? all.filter(path => /resume/i.test(path.split('/').pop()!)) : all;
    },
  });
  const result = await (
    await search!.prepare({ query: 'resume' } as never, context)
  ).execute(live());
  const paths = (result.output as { results: { path: string }[] }).results.map(entry => entry.path);
  assert.deepEqual(asked, ['name', 'content']);
  assert.deepEqual(paths.slice(0, 2).sort(), [
    '~/Documents/Whyte Peter/Docs/Whyte Peter Resume .pdf',
    '~/Documents/notes/resume ideas.md',
  ]);
  assert.equal(paths[2], '~/Documents/code/app/src/resume-worker.ts');
  assert.ok(!paths.some(path => path.includes('site-packages')));
  assert.ok(
    paths.indexOf('~/Documents/Whyte Peter/Docs/Cover letter.pdf') <
      paths.indexOf('~/Documents/code/app/src/parser.ts'),
  );
});

test('PDFs and pictures of documents are read through the native helper', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'edi-docs-')));
  await mkdir(join(base, 'Documents'), { recursive: true });
  for (const name of ['resume.pdf', 'slip.jpg', 'blank.png', 'locked.pdf'])
    await writeFile(join(base, 'Documents', name), Buffer.from([0x25, 0x50, 0, 0]));
  const [, , read] = fileCapabilities({
    home: base,
    roots: () => [{ name: 'Documents', path: join(base, 'Documents'), access: 'allowed' }],
    workspace: join(base, 'Documents/Edi'),
    trash: async () => {},
    documentText: async path =>
      path.endsWith('resume.pdf')
        ? 'Education\nUniversity of Abuja'
        : path.endsWith('slip.jpg')
          ? 'RESULT SLIP'
          : path.endsWith('blank.png')
            ? ''
            : null,
  });
  const run = async (path: string) =>
    (await read!.prepare({ path } as never, context)).execute(live());
  assert.equal(read!.id, 'files.read');
  assert.match(((await run('~/Documents/resume.pdf')).output as { text: string }).text, /Abuja/);
  assert.equal(
    ((await run('~/Documents/slip.jpg')).output as { text: string }).text,
    'RESULT SLIP',
  );
  await assert.rejects(run('~/Documents/blank.png'), /no readable text/);
  await assert.rejects(run('~/Documents/locked.pdf'), /couldn’t open/);
});
