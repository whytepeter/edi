import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { VoicePackId, VoicePackStatus } from '@edi/contracts';

/** One file of a pack, pinned by address, size and SHA-256 so nothing else can be installed. */
export interface PackFile {
  /** Where it goes, relative to Edi's models folder (the runtime looks there). */
  path: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface VoicePack {
  id: VoicePackId;
  name: string;
  files: PackFile[];
}

/**
 * What Settings → Voice offers to download, each pinned to one revision. Listening is whisper
 * small.en from the whisper.cpp model repository (MIT), the model measured in benchmarks/voice.
 * The voice is Kokoro 82M as ONNX with the voices Edi offers (Apache-2.0); it speaks through
 * ONNX Runtime with no Python.
 */
export const voicePacks: VoicePack[] = [
  {
    id: 'listening',
    name: 'Listening model',
    files: [
      {
        path: 'whisper/ggml-small.en.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.en.bin',
        bytes: 487_614_201,
        sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
      },
    ],
  },
  {
    id: 'speaking',
    name: 'Kokoro model',
    files: [
      {
        path: 'kokoro/model.onnx',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model_quantized.onnx',
        bytes: 92361116,
        sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
      },
      {
        path: 'kokoro/voices/af_heart.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_heart.bin',
        bytes: 522240,
        sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
      },
      {
        path: 'kokoro/voices/af_bella.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_bella.bin',
        bytes: 522240,
        sha256: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b',
      },
      {
        path: 'kokoro/voices/af_nicole.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_nicole.bin',
        bytes: 522240,
        sha256: 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a',
      },
      {
        path: 'kokoro/voices/af_sarah.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_sarah.bin',
        bytes: 522240,
        sha256: '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a',
      },
      {
        path: 'kokoro/voices/af_nova.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_nova.bin',
        bytes: 522240,
        sha256: '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f',
      },
      {
        path: 'kokoro/voices/af_sky.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_sky.bin',
        bytes: 522240,
        sha256: '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9',
      },
      {
        path: 'kokoro/voices/af_kore.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_kore.bin',
        bytes: 522240,
        sha256: '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e',
      },
      {
        path: 'kokoro/voices/af_aoede.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_aoede.bin',
        bytes: 522240,
        sha256: '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361',
      },
      {
        path: 'kokoro/voices/af_alloy.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_alloy.bin',
        bytes: 522240,
        sha256: 'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45',
      },
      {
        path: 'kokoro/voices/af_jessica.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_jessica.bin',
        bytes: 522240,
        sha256: 'a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8',
      },
      {
        path: 'kokoro/voices/af_river.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_river.bin',
        bytes: 522240,
        sha256: '00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30',
      },
      {
        path: 'kokoro/voices/bf_emma.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_emma.bin',
        bytes: 522240,
        sha256: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73',
      },
      {
        path: 'kokoro/voices/bf_isabella.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_isabella.bin',
        bytes: 522240,
        sha256: '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f',
      },
      {
        path: 'kokoro/voices/bf_alice.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_alice.bin',
        bytes: 522240,
        sha256: '08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573',
      },
      {
        path: 'kokoro/voices/bf_lily.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_lily.bin',
        bytes: 522240,
        sha256: '5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335',
      },
      {
        path: 'kokoro/voices/am_michael.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_michael.bin',
        bytes: 522240,
        sha256: '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1',
      },
      {
        path: 'kokoro/voices/am_adam.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_adam.bin',
        bytes: 522240,
        sha256: '162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716',
      },
      {
        path: 'kokoro/voices/am_echo.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_echo.bin',
        bytes: 522240,
        sha256: '3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3',
      },
      {
        path: 'kokoro/voices/am_eric.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_eric.bin',
        bytes: 522240,
        sha256: 'e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832',
      },
      {
        path: 'kokoro/voices/am_fenrir.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_fenrir.bin',
        bytes: 522240,
        sha256: 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43',
      },
      {
        path: 'kokoro/voices/am_liam.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_liam.bin',
        bytes: 522240,
        sha256: '52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade',
      },
      {
        path: 'kokoro/voices/am_onyx.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_onyx.bin',
        bytes: 522240,
        sha256: 'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6',
      },
      {
        path: 'kokoro/voices/am_puck.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_puck.bin',
        bytes: 522240,
        sha256: 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0',
      },
      {
        path: 'kokoro/voices/bm_george.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_george.bin',
        bytes: 522240,
        sha256: 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc',
      },
      {
        path: 'kokoro/voices/bm_lewis.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_lewis.bin',
        bytes: 522240,
        sha256: 'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97',
      },
      {
        path: 'kokoro/voices/bm_daniel.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_daniel.bin',
        bytes: 522240,
        sha256: '6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8',
      },
      {
        path: 'kokoro/voices/bm_fable.bin',
        url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_fable.bin',
        bytes: 522240,
        sha256: 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1',
      },
    ],
  },
];

/** Room left on the disk after a download, so Edi never fills it to the brim. */
const SPARE_BYTES = 200 * 1024 * 1024;

interface Active {
  abort: AbortController;
  received: number;
}

/**
 * Downloads, resumes and removes voice packs in Edi's own models folder. A file downloads to
 * `<name>.partial`, continues from where it stopped (HTTP Range) after Pause, a dropped
 * connection or a restart, and is renamed into place only once its size and SHA-256 match.
 * What is installed is read from the disk, so the runtime and Settings always agree; Settings
 * reads `status()` again while a download runs.
 */
export class VoicePacks {
  private readonly active = new Map<VoicePackId, Active>();
  private readonly failures = new Map<VoicePackId, string>();

  constructor(
    private readonly options: {
      /** Application Support › Edi › models. */
      dir: string;
      /** Whether a pack is available some other way (the development cache). */
      elsewhere?: (id: VoicePackId) => boolean;
      fetch?: typeof fetch;
      freeBytes?: (dir: string) => Promise<number>;
      packs?: VoicePack[];
    },
  ) {}

  private get packs() {
    return this.options.packs ?? voicePacks;
  }

  private target(file: PackFile) {
    return join(this.options.dir, file.path);
  }

  private installed(file: PackFile) {
    const target = this.target(file);
    return existsSync(target) && statSync(target).size === file.bytes;
  }

  private partialBytes(file: PackFile) {
    const partial = `${this.target(file)}.partial`;
    return existsSync(partial) ? Math.min(statSync(partial).size, file.bytes) : 0;
  }

  status(): VoicePackStatus[] {
    return this.packs.map(pack => {
      const bytes = pack.files.reduce((sum, file) => sum + file.bytes, 0);
      const done = pack.files.filter(file => this.installed(file));
      const base = { id: pack.id, name: pack.name, bytes };
      const active = this.active.get(pack.id);
      if (done.length === pack.files.length)
        return { ...base, state: 'installed', received: bytes };
      const received =
        done.reduce((sum, file) => sum + file.bytes, 0) +
        pack.files
          .filter(file => !this.installed(file))
          .reduce((sum, file) => sum + this.partialBytes(file), 0);
      if (active)
        return { ...base, state: 'downloading', received: Math.max(received, active.received) };
      const error = this.failures.get(pack.id);
      if (error) return { ...base, state: 'failed', received, error };
      if (received > 0) return { ...base, state: 'paused', received };
      if (this.options.elsewhere?.(pack.id)) return { ...base, state: 'development', received: 0 };
      return { ...base, state: 'missing', received: 0 };
    });
  }

  /** Start or resume a pack. Resolves when it is installed, paused or failed. */
  async download(id: VoicePackId) {
    const pack = this.packs.find(item => item.id === id);
    if (!pack || this.active.has(id)) return;
    const active: Active = { abort: new AbortController(), received: 0 };
    this.active.set(id, active);
    this.failures.delete(id);
    try {
      const remaining = pack.files
        .filter(file => !this.installed(file))
        .reduce((sum, file) => sum + file.bytes - this.partialBytes(file), 0);
      await mkdir(this.options.dir, { recursive: true });
      const free = await (this.options.freeBytes ?? diskFree)(this.options.dir);
      if (free < remaining + SPARE_BYTES)
        throw new PackError(`Needs ${megabytes(remaining + SPARE_BYTES)} free on this Mac.`);
      let before = 0;
      for (const file of pack.files) {
        if (!this.installed(file))
          await this.fetchFile(file, active, got => (active.received = before + got));
        before += file.bytes;
        active.received = before;
      }
    } catch (error) {
      // Pause keeps what arrived; it continues from there next time.
      if (!active.abort.signal.aborted)
        this.failures.set(
          id,
          error instanceof PackError
            ? error.message
            : 'The download stopped. Check your connection.',
        );
    } finally {
      this.active.delete(id);
    }
  }

  /** Stop a download and keep what arrived. */
  pause(id: VoicePackId) {
    this.active.get(id)?.abort.abort();
  }

  /** Delete a pack's files, finished or not. Downloading it again starts over. */
  async remove(id: VoicePackId) {
    const pack = this.packs.find(item => item.id === id);
    if (!pack) return;
    const active = this.active.get(id);
    active?.abort.abort();
    this.failures.delete(id);
    for (const file of pack.files) {
      await rm(this.target(file), { force: true });
      await rm(`${this.target(file)}.partial`, { force: true });
    }
  }

  private async fetchFile(
    file: PackFile,
    active: Active,
    progress: (bytes: number) => void,
  ): Promise<void> {
    const target = this.target(file);
    const partial = `${target}.partial`;
    await mkdir(dirname(target), { recursive: true });
    const offset = this.partialBytes(file);
    const hash = createHash('sha256');
    if (offset > 0) {
      // Resuming: the checksum covers the bytes already on disk.
      for await (const chunk of createReadStream(partial, { end: offset - 1 }))
        hash.update(chunk as Buffer);
    }
    let received = offset;
    // Fetch the rest, unless it all arrived last time and was never checked (Edi quit then).
    if (offset < file.bytes) {
      const response = await (this.options.fetch ?? fetch)(file.url, {
        headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
        signal: active.abort.signal,
        redirect: 'follow',
      });
      if (response.status === 200 && offset > 0) {
        // The server sent the whole file instead of the rest: start over.
        await response.body?.cancel();
        await rm(partial, { force: true });
        return this.fetchFile(file, active, progress);
      }
      if (response.status !== 200 && response.status !== 206)
        throw new PackError(`The download couldn’t start (${response.status}). Try again later.`);
      if (!response.body) throw new PackError('The download came back empty. Try again later.');
      const handle = await open(partial, offset > 0 ? 'a' : 'w');
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.byteLength;
          if (received > file.bytes) throw new PackError('The download was larger than expected.');
          hash.update(chunk);
          await handle.write(chunk);
          progress(received);
        }
      } finally {
        await handle.close();
      }
    }
    if (received !== file.bytes || hash.digest('hex') !== file.sha256) {
      await rm(partial, { force: true });
      throw new PackError('The download didn’t check out, so it was removed. Try again.');
    }
    await rename(partial, target);
  }
}

/** A message meant for the person; anything else becomes a generic connection message. */
class PackError extends Error {}

async function diskFree(dir: string) {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

const megabytes = (bytes: number) => `${Math.ceil(bytes / 1_000_000)} MB`;
