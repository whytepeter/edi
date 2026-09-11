/** Decode/resample completed recordings without opening an audio output device. */
export async function decodeRecording(blob: Blob, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (!blob.size || blob.size > 8 * 1024 * 1024 || !blob.type.startsWith('audio/webm')) {
    throw new Error('Unsupported microphone recording');
  }
  const context = new OfflineAudioContext(1, 1, 16000);
  // The browser decoder itself is not abortable; discard late results after cancellation.
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  signal.throwIfAborted();
  if (!buffer.length || buffer.duration > 61 || buffer.numberOfChannels > 2 || buffer.sampleRate !== 16000) {
    throw new Error('Decoded recording exceeds limits');
  }
  const output = new Uint8Array(buffer.length * 2);
  const view = new DataView(output.buffer);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  for (let i = 0; i < buffer.length; i++) {
    const value = channels.reduce((total, channel) => total + channel[i], 0) / channels.length;
    if (!Number.isFinite(value)) throw new Error('Invalid decoded audio');
    const clamped = Math.max(-1, Math.min(1, value));
    view.setInt16(i * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
  }
  return output;
}
