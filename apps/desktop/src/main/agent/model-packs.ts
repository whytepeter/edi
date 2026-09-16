import { localModelId, type LocalPackId, type LocalPackStatus } from '@edi/contracts';
import { PackDownloader, type Pack } from '../packs';

/**
 * Models Edi downloads and runs itself, so nobody has to install anything else first. Both are
 * Qwen2.5-VL (Apache-2.0) as GGUF: they see images and call tools, which is what Edi needs.
 * Each pack is the model and its vision projector, pinned to one revision by size and SHA-256,
 * and downloaded into Edi's own models folder. The runner (llama-server) ships with the app.
 */
const QWEN_3B =
  'https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/5037fcf163dd95d1e41d1974465f0898ed108ca2';
const QWEN_7B =
  'https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/508edd0afaa66bb9e9f40587acc2184f02daf1f6';

export interface ModelPack extends Pack<LocalPackId> {
  /** What Settings says it is good for, before anything is downloaded. */
  detail: string;
  /** The model file and its vision projector, relative to the models folder. */
  model: string;
  mmproj: string;
  /** Context window to run it with; smaller models get a smaller one. */
  contextLength: number;
}

export const modelPacks: ModelPack[] = [
  {
    id: 'language-small',
    name: 'Small model (3B)',
    detail: 'Quicker and lighter. Good for short questions and simple actions.',
    model: 'llm/qwen2.5-vl-3b-q4_k_m.gguf',
    mmproj: 'llm/qwen2.5-vl-3b-mmproj.gguf',
    contextLength: 8192,
    files: [
      {
        path: 'llm/qwen2.5-vl-3b-q4_k_m.gguf',
        url: `${QWEN_3B}/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf`,
        bytes: 1_929_901_056,
        sha256: 'd02fe9b69ad8cadbbd228e387667af66612c44bed29ffc8eb1e7caf9ac486c12',
      },
      {
        path: 'llm/qwen2.5-vl-3b-mmproj.gguf',
        url: `${QWEN_3B}/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf`,
        bytes: 844_757_728,
        sha256: '980c9b2f78c04e6cff93d277ada09e768394f112d75db3b4e9dea8a69f9fb904',
      },
    ],
  },
  {
    id: 'language-standard',
    name: 'Standard model (7B)',
    detail: 'Better answers and steadier with tools. Needs more memory and disk.',
    model: 'llm/qwen2.5-vl-7b-q4_k_m.gguf',
    mmproj: 'llm/qwen2.5-vl-7b-mmproj.gguf',
    contextLength: 16_384,
    files: [
      {
        path: 'llm/qwen2.5-vl-7b-q4_k_m.gguf',
        url: `${QWEN_7B}/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`,
        bytes: 4_683_072_032,
        sha256: '9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392',
      },
      {
        path: 'llm/qwen2.5-vl-7b-mmproj.gguf',
        url: `${QWEN_7B}/mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf`,
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

  /** The packs Settings shows, each saying what the model can do once installed. */
  override status(): LocalPackStatus[] {
    return super.status().map(pack => ({ ...pack, vision: true, tools: true }));
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
}
