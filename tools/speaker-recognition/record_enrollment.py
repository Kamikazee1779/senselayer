"""List local inputs or record one person's enrollment WAV after confirmation."""

import argparse
import os
from pathlib import Path
import re
import sys
import tempfile
import time

from ecapa import ROOT, SAMPLE_RATE
from speaker_service import select_device


def speaker_name(value):
    name = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]+", name) or name == "unknown":
        raise argparse.ArgumentTypeError(
            "Use a simple name containing letters, numbers, '-' or '_'; Unknown is reserved"
        )
    return name


def save_recording(sf, destination: Path, audio, overwrite):
    """Publish only a complete WAV, without replacing an existing recording by default."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".wav", delete=False) as temp:
        temporary = Path(temp.name)
    try:
        sf.write(str(temporary), audio, SAMPLE_RATE, subtype="PCM_16")
        if overwrite:
            os.replace(temporary, destination)
        else:
            os.link(temporary, destination)  # Fails atomically if the destination exists.
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-devices", action="store_true", help="List input devices without opening the microphone")
    parser.add_argument("--name", type=speaker_name, help="Speaker folder name, for example ivan")
    parser.add_argument("--seconds", type=int, default=30, help="Recording duration, from 5 to 60 seconds (default: 30)")
    device_options = parser.add_mutually_exclusive_group()
    device_options.add_argument("--device", type=int, help="Input index from --list-devices")
    device_options.add_argument("--device-name", default="MacBook Air Microphone", help="Input name to match (default: MacBook Air Microphone)")
    parser.add_argument("--overwrite", action="store_true", help="Explicitly replace this person's existing enroll.wav")
    args = parser.parse_args()
    if not 5 <= args.seconds <= 60:
        parser.error("--seconds must be between 5 and 60")
    if args.device is not None and args.device < 0:
        parser.error("--device must be a non-negative input index")
    if not args.list_devices and args.name is None:
        parser.error("--name is required unless --list-devices is used")

    import sounddevice as sd

    if args.list_devices:
        hosts = sd.query_hostapis()
        for index, info in enumerate(sd.query_devices()):
            if info["max_input_channels"] > 0:
                print(f"{index}: {info['name']} ({hosts[info['hostapi']]['name']})")
        return

    import numpy as np
    import soundfile as sf

    destination = ROOT / "enrollments" / args.name / "enroll.wav"
    if destination.exists() and not args.overwrite:
        raise FileExistsError(f"Already exists: {destination}. Use --overwrite to replace it.")

    # CLI choices are independent of any Trust microphone settings in the shell.
    os.environ["SENSELAYER_SPEAKER_DEVICE_NAME"] = args.device_name
    os.environ["SENSELAYER_SPEAKER_DEVICE_INDEX"] = "" if args.device is None else str(args.device)
    device, device_name = select_device(sd)
    if device is None:
        raise ValueError(f"No input matches {args.device_name!r}; use --list-devices and --device INDEX")
    sd.check_input_settings(device=device, samplerate=SAMPLE_RATE, channels=1, dtype="float32")

    print(f"Input: {device_name}")
    print(f"Record {args.name} for {args.seconds} seconds. Only this person should speak naturally.")
    print(f"The WAV stays on this computer: {destination}")
    input("Press ENTER to begin, or Ctrl+C to cancel: ")
    for remaining in range(3, 0, -1):
        print(f"Starting in {remaining}…", flush=True)
        time.sleep(1)
    print("Recording — speak now.", flush=True)
    try:
        audio = sd.rec(args.seconds * SAMPLE_RATE, samplerate=SAMPLE_RATE,
                       channels=1, dtype="float32", device=device)
        status = sd.wait()
    finally:
        sd.stop()
    if status:
        raise ValueError(f"Audio capture reported {status}; no recording saved, please retry")
    if not np.isfinite(audio).all():
        raise ValueError("Invalid audio samples; no recording saved")
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    print(f"Recording RMS: {rms:.6f}")
    if rms < 0.003:
        raise ValueError("Recording is too quiet; no recording saved. Check the microphone and retry.")
    save_recording(sf, destination, audio, args.overwrite)
    print(f"Saved: {destination}")
    print("A recording is not yet a speaker profile. Run build_profiles.py once at least two people are enrolled.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nRecording cancelled.", file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        print(f"Cannot record enrollment: {error}", file=sys.stderr)
        sys.exit(1)
