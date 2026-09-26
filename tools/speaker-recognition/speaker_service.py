"""Optional local microphone recognizer. stdout is exclusively JSONL."""

import argparse
from contextlib import redirect_stdout
import json
import math
import os
from pathlib import Path
import queue
import sys
import threading
import time

from ecapa import ROOT, SAMPLE_RATE, embedding, load_classifier, load_profiles
from speaker_policy import CaptureContinuity, identify


OUTPUT = sys.stdout


def emit(event):
    print(json.dumps(event, allow_nan=False), file=OUTPUT, flush=True)


def setting(name, default):
    value = float(os.getenv(f"SENSELAYER_SPEAKER_{name}", str(default)))
    if not math.isfinite(value):
        raise ValueError(f"Invalid SENSELAYER_SPEAKER_{name}")
    return value


def select_device(sd):
    explicit = os.getenv("SENSELAYER_SPEAKER_DEVICE_INDEX", "").strip()
    if explicit:
        device = int(explicit)
    else:
        name = os.getenv("SENSELAYER_SPEAKER_DEVICE_NAME", "Trust GXT 232").casefold()
        devices = sd.query_devices()
        hosts = sd.query_hostapis()
        matches = [(index, info) for index, info in enumerate(devices)
                   if info["max_input_channels"] > 0 and name in info["name"].casefold()]
        matches.sort(key=lambda item: "mme" not in hosts[item[1]["hostapi"]]["name"].casefold())
        device = matches[0][0] if matches else None
    info = sd.query_devices(device, kind="input")
    host = sd.query_hostapis(info["hostapi"])["name"]
    return device, f"{info['name']} ({host})"


class MicrophoneControl:
    """The control thread can close input while the main thread runs inference."""

    def __init__(self):
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.stream = None

    def open(self, sd, **kwargs):
        with self.lock:
            if self.stopped.is_set():
                return False
            self.stream = sd.InputStream(**kwargs)
            self.stream.start()
            return True

    def stop(self):
        self.stopped.set()
        with self.lock:
            if self.stream is not None:
                try:
                    self.stream.abort()
                finally:
                    self.stream.close()
                    self.stream = None

    def listen(self):
        try:
            for line in sys.stdin:
                try:
                    command = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(command, dict) and command.get("type") == "stop":
                    break
        finally:
            self.stop()  # EOF means the owning Node process has disconnected.


def recognize(args, control):
    import numpy as np
    import sounddevice as sd

    sample_rate = int(setting("SAMPLE_RATE", SAMPLE_RATE))
    if sample_rate != SAMPLE_RATE:
        raise ValueError("This ECAPA model requires SENSELAYER_SPEAKER_SAMPLE_RATE=16000")
    window_sec = setting("WINDOW_SEC", 3.0)
    hop_sec = setting("HOP_SEC", 1.5)
    min_rms = setting("MIN_RMS", 0.003)
    min_score = setting("MIN_SCORE", 0.30)
    min_margin = setting("MIN_MARGIN", 0.08)
    if not 0 < hop_sec <= window_sec <= 30 or min_rms < 0:
        raise ValueError("Expected 0 < HOP_SEC <= WINDOW_SEC <= 30 and MIN_RMS >= 0")
    if not -1 <= min_score <= 1 or not 0 <= min_margin <= 2:
        raise ValueError("Invalid cosine score or margin threshold")

    classifier = load_classifier(args.model_dir)
    if args.prewarm:
        emit({"type": "prewarm_ready"})
        return
    profiles = load_profiles(args.profiles_dir, os.getenv("SENSELAYER_SPEAKER_NAMES"))
    if control.stopped.is_set():
        return
    device, device_name = select_device(sd)
    print(f"Speaker recognition input: {device_name}", file=sys.stderr)
    window_frames = round(window_sec * sample_rate)
    hop_frames = round(hop_sec * sample_rate)
    if hop_frames < 1:
        raise ValueError("HOP_SEC is shorter than one sample")
    block_frames = 1600  # 100 ms; callback only copies data into a bounded queue.
    chunks = queue.Queue(maxsize=max(4, math.ceil(window_frames / block_frames)))
    sequence = 0
    epoch_offset_ms = None

    def capture(audio, frames, timing, status):
        nonlocal sequence, epoch_offset_ms
        if epoch_offset_ms is None:
            epoch_offset_ms = time.time() * 1000 - timing.currentTime * 1000
        start_ms = epoch_offset_ms + timing.inputBufferAdcTime * 1000
        if timing.inputBufferAdcTime <= 0:  # Some host APIs omit ADC timestamps.
            start_ms = time.time() * 1000 - frames * 1000 / sample_rate
        try:
            chunks.put_nowait((sequence, start_ms, audio[:, 0].copy(), bool(status)))
        except queue.Full:
            pass  # The sequence gap resets accumulation when capture catches up.
        sequence += 1

    if not control.open(sd, device=device, samplerate=sample_rate,
                        channels=1, dtype="float32", blocksize=block_frames,
                        callback=capture):
        return
    emit({"type": "ready", "deviceName": device_name})
    continuity = CaptureContinuity()
    pending = np.empty(0, dtype=np.float32)
    window_start_ms = 0.0

    while not control.stopped.is_set():
        try:
            index, start_ms, audio, overflow = chunks.get(timeout=0.1)
        except queue.Empty:
            continue
        if not continuity.accept(index, start_ms, len(audio), sample_rate, overflow):
            pending = np.empty(0, dtype=np.float32)
        if not len(pending):
            window_start_ms = start_ms
        pending = np.concatenate((pending, audio))
        while len(pending) >= window_frames and not control.stopped.is_set():
            window = pending[:window_frames]
            end_ms = window_start_ms + window_frames * 1000 / sample_rate
            if not np.isfinite(window).all():
                observation = identify({})
            elif float(np.sqrt(np.mean(window.astype(np.float64) ** 2))) < min_rms:
                observation = None  # Silence is no new evidence, not Unknown.
            else:
                encoded = embedding(classifier, window)
                # Unit vectors can exceed 1 by a float32 rounding error.
                scores = {name: float(np.clip(np.dot(encoded, profile), -1, 1))
                          for name, profile in profiles.items()}
                observation = identify(scores, min_score, min_margin)
            if observation is not None:
                emit({"type": "speaker_identity", "speaker": observation.speaker,
                      "score": observation.score, "margin": observation.margin,
                      "startMs": round(window_start_ms), "endMs": round(end_ms)})
            pending = pending[hop_frames:]
            window_start_ms += hop_frames * 1000 / sample_rate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profiles-dir", type=Path, default=ROOT / "profiles")
    parser.add_argument("--model-dir", type=Path, default=ROOT / "models" / "spkrec-ecapa-voxceleb")
    parser.add_argument("--prewarm", action="store_true", help="Download/load the model without opening the microphone")
    args = parser.parse_args()
    control = MicrophoneControl()
    # Model imports/inference may print; keep even third-party Python output off stdout.
    with redirect_stdout(sys.stderr):
        if not args.prewarm:
            threading.Thread(target=control.listen, daemon=True).start()
        try:
            recognize(args, control)
        finally:
            control.stop()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"Speaker recognition unavailable: {error}", file=sys.stderr)
        sys.exit(1)
