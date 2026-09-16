import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { localModelId, type LocalPackId, type LocalPackStatus } from '@edi/contracts';
import { PackDownloader, type Pack } from '../packs';

/**
 * Models Edi downloads and runs itself, so nobody has to install anything else first. Each pack
 * is a GGUF and its vision projector, pinned to one revision by size and SHA-256, downloaded into
 * Edi's own models folder; the runner (llama-server) ships with the app.
 *
 * What a model can do here depends on its chat template, not its size. Qwen3-VL's template
 * declares tools and parses tool calls, so Edi can act with it. Qwen2.5-VL's template has no
 * tool support at all — checked against the model's own template, 2026-09-16 — so that one
 * answers and reads the screen but cannot take actions, and Settings says so.
 */
const QWEN3_VL_2B =
  'https://huggingface.co/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/ea6a11058182570be6436b9a2e4ee7f7b49f908d';
const QWEN25_VL_7B =
  'https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/508edd0afaa66bb9e9f40587acc2184f02daf1f6';

export interface ModelPack extends Pack<LocalPackId> {
  /** What Settings says it is good for, before anything is downloaded. */
  detail: string;
  /** What the model can actually do here, checked against its own chat template. */
  vision: boolean;
  tools: boolean;
  /** The model file and its vision projector, relative to the models folder. */
  model: string;
  mmproj: string;
  /** Context window to run it with; smaller models get a smaller one. */
  contextLength: number;
}

export const modelPacks: ModelPack[] = [
  {
    id: 'language-small',
    name: 'Small model (2B)',
    detail: 'Answers, reads your screen and takes actions. The one to start with.',
    vision: true,
    tools: true,
    model: 'llm/qwen3-vl-2b-q8_0.gguf',
    mmproj: 'llm/qwen3-vl-2b-mmproj.gguf',
    contextLength: 8192,
    files: [
      {
        path: 'llm/qwen3-vl-2b-q8_0.gguf',
        url: `${QWEN3_VL_2B}/Qwen3-VL-2B-Instruct-Q8_0.gguf`,
        bytes: 1_834_427_296,
        sha256: 'b7802e29f71a9e5b5e3f83f613df898a2204342dcea71a231ea501d481813c39',
      },
      {
        path: 'llm/qwen3-vl-2b-mmproj.gguf',
        url: `${QWEN3_VL_2B}/mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf`,
        bytes: 445_053_056,
        sha256: '69066c8f279ec85ff48ab4059f6ebba0d2932ca57667f2bbdac7d9805bca9e7b',
      },
    ],
  },
  {
    id: 'language-standard',
    name: 'Bigger model (7B)',
    detail: 'Describes your screen in more detail, but can’t take actions.',
    vision: true,
    tools: false,
    model: 'llm/qwen2.5-vl-7b-q4_k_m.gguf',
    mmproj: 'llm/qwen2.5-vl-7b-mmproj.gguf',
    contextLength: 16_384,
    files: [
      {
        path: 'llm/qwen2.5-vl-7b-q4_k_m.gguf',
        url: `${QWEN25_VL_7B}/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`,
        bytes: 4_683_072_032,
        sha256: '9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392',
      },
      {
        path: 'llm/qwen2.5-vl-7b-mmproj.gguf',
        url: `${QWEN25_VL_7B}/mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf`,
        bytes: 853_119_712,
        sha256: '2ddb555391bae966e412deab9e07b58afa18bcc06930ba0f1c78a3695ab9e506',
      },
    ],
  },
];

/** The id a downloaded model answers under, the same shape as a runtime's models. */
export const packModelId = (pack: ModelPack) => localModelId('edi', pack.id);

/** Downloads, resumes and removes the models Edi runs itself. */
export class ModelPacks extends PackDownloader<LocalPackId> {
  constructor(options: {
    dir: string;
    fetch?: typeof fetch;
    freeBytes?: (dir: string) => Promise<number>;
    packs?: ModelPack[];
  }) {
    const { packs, ...rest } = options;
    super({ ...rest, packs: packs ?? modelPacks });
  }

  /** The packs Settings shows, each saying what its model can do once installed. */
  override status(): LocalPackStatus[] {
    const packs = this.options.packs as ModelPack[];
    return super.status().map(pack => {
      const known = packs.find(entry => entry.id === pack.id);
      return { ...pack, vision: known?.vision ?? false, tools: known?.tools ?? false };
    });
  }

  /** Packs whose files are all on this Mac, with the paths the runner needs. */
  installedPacks(): (ModelPack & { modelPath: string; mmprojPath: string })[] {
    return (this.options.packs as ModelPack[])
      .filter(pack => this.ready(pack.id))
      .map(pack => ({
        ...pack,
        modelPath: this.path(pack.model),
        mmprojPath: this.path(pack.mmproj),
      }));
  }

  /**
   * Model files no pack offers any more, left behind when Edi changed which model it ships.
   * They are gigabytes each and nothing can use them, so they go.
   */
  async prune() {
    const keep = new Set(
      (this.options.packs as ModelPack[]).flatMap(pack => pack.files.map(file => file.path)),
    );
    const folder = this.path('llm');
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      return; // Nothing downloaded yet.
    }
    for (const name of names) {
      const path = `llm/${name.replace(/\.partial$/, '')}`;
      if (keep.has(path) || !/\.gguf(\.partial)?$/.test(name)) continue;
      await rm(join(folder, name), { force: true });
    }
  }
}
