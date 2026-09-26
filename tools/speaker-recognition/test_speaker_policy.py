import unittest

from speaker_policy import CaptureContinuity, identify


class RejectionTests(unittest.TestCase):
    def test_clear_match(self):
        result = identify({"Emilio": 0.70, "Ivan": 0.35})
        self.assertEqual(result.speaker, "Emilio")
        self.assertAlmostEqual(result.margin, 0.35)

    def test_low_score(self):
        self.assertEqual(identify({"Emilio": 0.22, "Ivan": 0.18}).speaker, "Unknown")

    def test_small_margin(self):
        self.assertEqual(identify({"Emilio": 0.50, "Ivan": 0.46}).speaker, "Unknown")

    def test_second_clear_match(self):
        self.assertEqual(identify({"Emilio": 0.65, "Ivan": 0.42}).speaker, "Emilio")

    def test_thresholds_are_configurable(self):
        self.assertEqual(identify({"Emilio": 0.65, "Ivan": 0.42}, min_score=0.70).speaker, "Unknown")
        self.assertEqual(identify({"Emilio": 0.65, "Ivan": 0.42}, min_margin=0.30).speaker, "Unknown")

    def test_unknown_observation_never_reuses_previous_name(self):
        speakers = [identify(scores).speaker for scores in (
            {"Emilio": 0.70, "Ivan": 0.35},
            {"Emilio": 0.70, "Ivan": 0.35},
            {"Emilio": 0.1231, "Ivan": 0.1158},
            {"Emilio": 0.35, "Ivan": 0.70},
        )]
        self.assertEqual(speakers, ["Emilio", "Emilio", "Unknown", "Ivan"])

    def test_missing_or_nonfinite_scores_are_rejected(self):
        for scores in ({}, {"Emilio": 0.9}, {"Emilio": float("nan"), "Ivan": 0.2},
                       {"Emilio": float("inf"), "Ivan": 0.2}):
            self.assertEqual(identify(scores).speaker, "Unknown")


class ContinuityTests(unittest.TestCase):
    def test_contiguous_audio(self):
        continuity = CaptureContinuity()
        self.assertTrue(continuity.accept(0, 1000, 1600, 16000))
        self.assertTrue(continuity.accept(1, 1100, 1600, 16000))

    def test_dropped_callback_breaks_window(self):
        continuity = CaptureContinuity()
        continuity.accept(0, 1000, 1600, 16000)
        self.assertFalse(continuity.accept(2, 1200, 1600, 16000))
        self.assertTrue(continuity.accept(3, 1300, 1600, 16000))

    def test_device_overflow_breaks_window(self):
        continuity = CaptureContinuity()
        continuity.accept(0, 1000, 1600, 16000)
        self.assertFalse(continuity.accept(1, 1100, 1600, 16000, overflow=True))

    def test_capture_clock_gap_breaks_window(self):
        continuity = CaptureContinuity()
        continuity.accept(0, 1000, 1600, 16000)
        self.assertFalse(continuity.accept(1, 1500, 1600, 16000))


if __name__ == "__main__":
    unittest.main()
