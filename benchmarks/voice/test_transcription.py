import tempfile
from pathlib import Path
import unittest
import wave
import numpy as np
from transcription_benchmark import prepare, write_wav


class TranscriptionFixtures(unittest.TestCase):
    def test_resample_preserves_duration_and_produces_pcm16(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.wav", Path(folder) / "output.wav"
            with wave.open(str(source), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(24000)
                audio.writeframes(np.zeros(24000, dtype="<i2").tobytes())
            self.assertEqual(prepare(source, output), 1)
            with wave.open(str(output), "rb") as audio:
                self.assertEqual((audio.getframerate(), audio.getnframes(), audio.getsampwidth()), (16000, 16000, 2))

    def test_silence_fixture_is_silent(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "silence.wav"
            write_wav(path, np.zeros(48000))
            with wave.open(str(path), "rb") as audio:
                self.assertFalse(any(audio.readframes(48000)))


if __name__ == "__main__":
    unittest.main()
