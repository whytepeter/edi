import tempfile
import unittest
from pathlib import Path
from pocket_benchmark import load_corpus, metrics


class BenchmarkTests(unittest.TestCase):
    def test_fixed_corpus(self):
        self.assertEqual(len(load_corpus(Path(__file__).with_name("corpus.json"))), 6)

    def test_real_time_factor(self):
        result = metrics(48000, 24000, 120, 1000)
        self.assertEqual(result["audio_seconds"], 2)
        self.assertEqual(result["real_time_factor"], 0.5)

    def test_empty_audio_rejected(self):
        with self.assertRaises(ValueError):
            metrics(0, 24000, 0, 1000)

    def test_unsafe_id_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "corpus.json"
            path.write_text('[{"id":"../bad","text":"hello"}]')
            with self.assertRaises(ValueError):
                load_corpus(path)


if __name__ == "__main__":
    unittest.main()
