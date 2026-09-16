import type { BrowserWindow, WebContents } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  artifactTextExport,
  exportFileName,
  exportFormatLabel,
  exportFormats,
  renderedExportFormats,
  type Artifact,
  type ArtifactRef,
  type ExportFormat,
} from '@edi/contracts';

type RenderedFormat = 'pdf' | 'png' | 'svg';
/** What the hidden export page reports once it has drawn the content. */
export interface ExportDrawing {
  svg?: string;
  png?: string;
  failed?: boolean;
}

export interface ExportResult {
  path: string;
  name: string;
  bytes: number;
}

interface ExporterDependencies {
  /** Documents › Edi › Exports. */
  folder(): string;
  resolve(ref: ArtifactRef): Promise<Artifact>;
  /** Opens the hidden page that draws `ref` for `format`. */
  draw(ref: ArtifactRef, format: RenderedFormat): BrowserWindow;
  pageSize(): 'A4' | 'Letter';
  timeoutMs?: number;
}

/** A wide diagram or table reads better across the page. */
function landscape(content: Artifact, svg?: string) {
  if (content.kind === 'table') return content.columns.length >= 6;
  const box = svg && /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
  return Boolean(box && Number(box[1]) > Number(box[2]) * 1.3);
}

/**
 * Export is a deliberate step apart from the working copy Edi keeps: a file to hand to someone.
 * Text formats come straight from the structured content; PDFs and pictures are drawn by a
 * hidden page using the same components as the artifact window, one at a time.
 */
export class Exporter {
  private drawing: { win: BrowserWindow; done(result: ExportDrawing): void } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** The most recent export, for Show in Finder. */
  lastPath: string | null = null;

  constructor(private readonly deps: ExporterDependencies) {}

  owns(sender: WebContents) {
    const win = this.drawing?.win;
    return Boolean(win && !win.isDestroyed() && win.webContents === sender);
  }

  ready(result: ExportDrawing) {
    this.drawing?.done(result);
  }

  /** Into the Exports folder under a free name, or to `destination` the person chose. */
  async export(ref: ArtifactRef, format: ExportFormat, destination?: string): Promise<ExportResult> {
    const content = await this.deps.resolve(ref);
    if (!exportFormats[content.kind].includes(format))
      throw new Error(
        `A ${content.kind} can't be exported as ${exportFormatLabel[format]}. ` +
          `Choose ${exportFormats[content.kind].map(f => exportFormatLabel[f]).join(', ')}.`,
      );
    const body = renderedExportFormats.includes(format)
      ? await this.render(ref, content, format as RenderedFormat)
      : Buffer.from(artifactTextExport(content, format));
    const path = destination
      ? // The save panel already asked before replacing an existing file.
        (await writeFile(destination, body), destination)
      : await writeUnique(this.deps.folder(), exportFileName(content.title, format), body);
    this.lastPath = path;
    return { path, name: basename(path), bytes: body.byteLength };
  }

  private render(ref: ArtifactRef, content: Artifact, format: RenderedFormat) {
    const run = async () => {
      const win = this.deps.draw(ref, format);
      try {
        const drawing = await new Promise<ExportDrawing>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Drawing the export took too long.')),
            this.deps.timeoutMs ?? 30_000,
          );
          const fail = () => {
            clearTimeout(timer);
            reject(new Error('The export page closed before it finished.'));
          };
          this.drawing = {
            win,
            done: result => {
              clearTimeout(timer);
              win.webContents.off('render-process-gone', fail);
              resolve(result);
            },
          };
          win.webContents.once('render-process-gone', fail);
        });
        if (drawing.failed) throw new Error('Edi couldn’t draw this for export.');
        if (format === 'svg') {
          if (!drawing.svg) throw new Error('Edi couldn’t draw this diagram.');
          return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${drawing.svg}\n`);
        }
        if (format === 'png') {
          const data = drawing.png?.slice(drawing.png.indexOf(',') + 1);
          if (!data) throw new Error('Edi couldn’t make a picture of this diagram.');
          return Buffer.from(data, 'base64');
        }
        return await win.webContents.printToPDF({
          printBackground: true,
          pageSize: this.deps.pageSize(),
          landscape: landscape(content, drawing.svg),
          margins: { top: 0.6, bottom: 0.6, left: 0.65, right: 0.65 },
          generateTaggedPDF: true,
          generateDocumentOutline: true,
        });
      } finally {
        this.drawing = null;
        if (!win.isDestroyed()) win.destroy();
      }
    };
    // One hidden page at a time, so a finished drawing always belongs to the current export.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
}

/** “Plan.pdf”, then “Plan 2.pdf”: never replaces an earlier export. */
async function writeUnique(folder: string, name: string, body: Buffer) {
  await mkdir(folder, { recursive: true });
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 1; n <= 500; n++) {
    const path = join(folder, n === 1 ? name : `${stem} ${n}${extension}`);
    try {
      await writeFile(path, body, { flag: 'wx', mode: 0o644 });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many exports share this name. Rename it first.');
}
