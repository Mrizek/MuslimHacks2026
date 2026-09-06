import struct
import unittest

from speechRecognition import (
    MIN_AUDIO_RMS,
    ScoreCallTracker,
    classify_call,
    correct_score_words,
    enhance_audio,
)


class SpeechRecognitionTests(unittest.TestCase):
    def test_quiet_audio_is_suppressed(self):
        quiet_audio = struct.pack("<" + "h" * 256, *([10] * 256))
        self.assertEqual(enhance_audio(quiet_audio), b"\x00" * len(quiet_audio))

    def test_speech_audio_is_gain_adjusted(self):
        speech_audio = struct.pack("<" + "h" * 256, *([1000, -1000] * 128))
        enhanced = enhance_audio(speech_audio)
        self.assertNotEqual(enhanced, speech_audio)
        self.assertTrue(any(enhanced))

    def test_corrects_common_score_misrecognition(self):
        self.assertEqual(correct_score_words("thurty fourty"), "thirty forty")

    def test_high_confidence_score_is_accepted(self):
        self.assertEqual(classify_call("thirty fourty", 0.9), ("ACCEPT", "30-40"))

    def test_low_confidence_score_requires_confirmation(self):
        self.assertEqual(classify_call("thirty fourty", 0.6), ("CONFIRM", "30-40"))

    def test_numeric_score_is_accepted(self):
        self.assertEqual(classify_call("30 40", 0.99), ("ACCEPT", "30-40"))

    def test_hyphenated_numeric_score_is_accepted(self):
        self.assertEqual(classify_call("40-30", 0.99), ("ACCEPT", "40-30"))

    def test_spoken_score_prefix_and_separator_are_accepted(self):
        self.assertEqual(classify_call("The score is 30 to 40", 0.99), ("ACCEPT", "30-40"))

    def test_punctuated_command_is_accepted(self):
        self.assertEqual(classify_call("Fault!", 0.99), ("ACCEPT", "fault"))

    def test_adjacent_court_sentence_is_ignored(self):
        self.assertIsNone(classify_call("thirty forty game point", 0.99))

    def test_correction_replaces_next_accepted_score(self):
        tracker = ScoreCallTracker()
        self.assertEqual(
            tracker.handle("Correction", 0.99),
            ("CORRECTION", "Speak the replacement score"),
        )
        self.assertEqual(tracker.handle("fifteen zero", 0.99), ("VERIFY", "15-0"))
        self.assertEqual(tracker.handle("confirm", 0.99), ("VERIFIED", "15-0"))

    def test_call_is_pending_until_confirmed(self):
        tracker = ScoreCallTracker()
        verified = []
        self.assertEqual(
            tracker.handle("30 40", 0.99, verified.append),
            ("VERIFY", "30-40"),
        )
        self.assertEqual(verified, [])
        self.assertEqual(
            tracker.handle("yes", 0.99, verified.append),
            ("VERIFIED", "30-40"),
        )
        self.assertEqual(verified, ["30-40"])

    def test_rejected_call_never_reaches_backend(self):
        tracker = ScoreCallTracker()
        verified = []
        tracker.handle("15 0", 0.99, verified.append)
        self.assertEqual(tracker.handle("no", 0.99, verified.append), ("REJECTED", "Call discarded; repeat the call"))
        self.assertEqual(verified, [])


if __name__ == "__main__":
    unittest.main()