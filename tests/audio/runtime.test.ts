import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveLocalTranscription,
  resolveVoiceRuntime,
  whisperModelsDir,
  type VoicePaths,
} from '../../apps/desktop/src/main/voice/runtime';

function packagedApp() {
  const root = mkdtempSync(join(tmpdir(), 'edi-runtime-'));
  const paths: VoicePaths = {
    appPath: join(root, 'Edi.app/Contents/Resources/app.asar'),
    packaged: true,
    resourcesPath: join(root, 'Edi.app/Contents/Resources'),
    modelsDir: join(root, 'Application Support/Edi/models'),
  };
  const whisper = join(paths.resourcesPath, 'whisper');
  mkdirSync(whisper, { recursive: true });
  for (const file of ['whisper-cli', 'whisper-server', 'ggml-silero-v6.2.0.bin'])
    writeFileSync(join(whisper, file), '');
  return { root, paths, whisper };
}

test('a downloaded app runs its bundled whisper once a model is in its own folder', () => {
  const { root, paths, whisper } = packagedApp();
  try {
    // Fresh install: the programs ship, no model yet, so nothing can listen locally.
    assert.equal(resolveLocalTranscription(paths), null);
    assert.deepEqual(resolveVoiceRuntime(paths), { mlx: null });

    mkdirSync(whisperModelsDir(paths), { recursive: true });
    writeFileSync(join(whisperModelsDir(paths), 'ggml-base.en.bin'), '');
    assert.deepEqual(resolveLocalTranscription(paths), {
      transcription: {
        executable: join(whisper, 'whisper-cli'),
        model: join(whisperModelsDir(paths), 'ggml-base.en.bin'),
        vadModel: join(whisper, 'ggml-silero-v6.2.0.bin'),
      },
      server: join(whisper, 'whisper-server'),
    });
    // The better model wins as soon as it lands.
    writeFileSync(join(whisperModelsDir(paths), 'ggml-small.en.bin'), '');
    assert.equal(
      resolveLocalTranscription(paths)?.transcription.model,
      join(whisperModelsDir(paths), 'ggml-small.en.bin'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('without its programs, a copy of Edi does not pretend to listen', () => {
  const { root, paths, whisper } = packagedApp();
  try {
    mkdirSync(whisperModelsDir(paths), { recursive: true });
    writeFileSync(join(whisperModelsDir(paths), 'ggml-small.en.bin'), '');
    rmSync(join(whisper, 'whisper-cli'));
    assert.equal(resolveLocalTranscription(paths), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
