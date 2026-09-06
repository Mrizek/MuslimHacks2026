import unittest

from speechRecognition import process_transcript


class SpeechRecognitionTests(unittest.TestCase):
    def test_score_words_are_normalized(self):
        self.assertEqual(process_transcript("thirty fourty"), "30-40")

    def test_fault_is_preserved_as_a_command(self):
        self.assertEqual(process_transcript("Fault!"), "fault")

    def test_unrecognized_text_is_preserved(self):
        self.assertEqual(process_transcript("game point"), "game point")


if __name__ == "__main__":
    unittest.main()