import io
import os
import unittest
from unittest.mock import patch

from speaker_service import MicrophoneControl, select_device


class FakeStream:
    started = False
    aborted = False
    closed = False

    def start(self):
        self.started = True

    def abort(self):
        self.aborted = True

    def close(self):
        self.closed = True


class FakeAudio:
    def __init__(self):
        self.stream = FakeStream()
        self.devices = [
            {"name": "Trust GXT 232", "max_input_channels": 1, "hostapi": 0},
            {"name": "Trust GXT 232", "max_input_channels": 1, "hostapi": 1},
            {"name": "Built-in microphone", "max_input_channels": 1, "hostapi": 0},
        ]

    def InputStream(self, **kwargs):
        return self.stream

    def query_devices(self, device=None, kind=None):
        if kind is None:
            return self.devices
        return self.devices[2 if device is None else device]

    def query_hostapis(self, index=None):
        hosts = [{"name": "WASAPI"}, {"name": "MME"}]
        return hosts if index is None else hosts[index]


class MicrophoneTests(unittest.TestCase):
    def test_stop_command_closes_capture_without_waiting_for_inference(self):
        audio = FakeAudio()
        control = MicrophoneControl()
        self.assertTrue(control.open(audio))
        with patch("sys.stdin", io.StringIO('{"type":"stop"}\n')):
            control.listen()
        self.assertTrue(control.stopped.is_set())
        self.assertTrue(audio.stream.aborted)
        self.assertTrue(audio.stream.closed)

    def test_eof_closes_capture(self):
        audio = FakeAudio()
        control = MicrophoneControl()
        control.open(audio)
        with patch("sys.stdin", io.StringIO("")):
            control.listen()
        self.assertTrue(audio.stream.closed)

    def test_stop_during_model_loading_prevents_later_capture(self):
        audio = FakeAudio()
        control = MicrophoneControl()
        control.stop()
        self.assertFalse(control.open(audio))
        self.assertFalse(audio.stream.started)

    def test_matching_device_prefers_mme(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(select_device(FakeAudio()), (1, "Trust GXT 232 (MME)"))

    def test_explicit_device_index_wins(self):
        with patch.dict(os.environ, {"SENSELAYER_SPEAKER_DEVICE_INDEX": "0"}, clear=True):
            self.assertEqual(select_device(FakeAudio()), (0, "Trust GXT 232 (WASAPI)"))

    def test_missing_device_name_uses_system_default(self):
        with patch.dict(os.environ, {"SENSELAYER_SPEAKER_DEVICE_NAME": "Absent"}, clear=True):
            self.assertEqual(select_device(FakeAudio()), (None, "Built-in microphone (WASAPI)"))


if __name__ == "__main__":
    unittest.main()
