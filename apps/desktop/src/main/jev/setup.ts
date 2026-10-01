/**
 * Jev in a development run, turned on with `EDI_JEV=on` and asked on the OpenRouter key Edi
 * already has. Every check is recorded beside Edi's own and decides nothing: whether a prompt
 * needs a screenshot, whether a pause ends a hands-free turn, and whether hands-free words were
 * said to Edi or picked up from the room. `EDI_JEV=decide` lets the last one act, taking room talk
 * out of hands-free turns. Every question and answer, words included, is added to one local JSON
 * Lines log that `pnpm jev:report` summarizes. Never on in a packaged app.
 */

import { appendFile } from 'node:fs/promises';
import { JevClient } from './client';
import { JevHearing } from './hearing';
import { JevShadow } from './shadow';

/** Adds each record as one line of JSON; a failed write loses that record and nothing else. */
export function appendJsonLines(path: string) {
  return (record: object) => {
    appendFile(path, `${JSON.stringify(record)}\n`).catch(() => {});
  };
}

/** Jev when this development run turned it on; otherwise null, and nothing is sent. */
export function jevFromEnv(options: {
  packaged: boolean;
  logPath: string;
  /** The OpenRouter key Edi already uses for answers. */
  apiKey: () => string;
  env?: Record<string, string | undefined>;
}): { shadow: JevShadow; hearing: JevHearing } | null {
  const env = options.env ?? process.env;
  if (options.packaged || (env.EDI_JEV !== 'on' && env.EDI_JEV !== 'decide')) return null;
  const client = new JevClient(options.apiKey);
  const write = appendJsonLines(options.logPath);
  return {
    shadow: new JevShadow(client, write),
    hearing: new JevHearing(client, write, env.EDI_JEV === 'decide'),
  };
}
