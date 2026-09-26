"""Build local profiles from existing <audio-dir>/<name>/enroll.wav files."""

import argparse
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys

from ecapa import DEFAULT_NAMES, MODEL, ROOT, SAMPLE_RATE, embedding, load_classifier, read_audio, speaker_keys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio-dir", type=Path, help="Directory containing one folder per enrolled speaker")
    parser.add_argument("--profiles-dir", type=Path, default=ROOT / "profiles")
    parser.add_argument("--model-dir", type=Path, default=ROOT / "models" / "spkrec-ecapa-voxceleb")
    parser.add_argument("--names", default=os.getenv("SENSELAYER_SPEAKER_NAMES", DEFAULT_NAMES))
    parser.add_argument("--prewarm", action="store_true", help="Download/load the model, then exit without building profiles")
    args = parser.parse_args()
    if not args.prewarm and args.audio_dir is None:
        parser.error("--audio-dir is required unless --prewarm is used")

    with redirect_stdout(sys.stderr):
        classifier = load_classifier(args.model_dir)
        if args.prewarm:
            print("MODEL READY", file=sys.stderr)
            return
        import numpy as np

        profiles = {}
        for name in speaker_keys(args.names):
            audio = read_audio(args.audio_dir / name / "enroll.wav")
            if float(np.sqrt(np.mean(audio.astype(np.float64) ** 2))) < 0.003:
                raise ValueError(f"Enrollment for {name} is silent; check the existing WAV")
            profiles[name] = embedding(classifier, audio)
            print(f"Built profile: {name}", file=sys.stderr)

        args.profiles_dir.mkdir(parents=True, exist_ok=True)
        for name, profile in profiles.items():
            np.save(args.profiles_dir / f"{name}.npy", profile, allow_pickle=False)
        manifest = {"model": MODEL, "sampleRate": SAMPLE_RATE,
                    "speakers": {name: name.capitalize() for name in profiles}}
        (args.profiles_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8",
        )
        print(f"Saved {len(profiles)} local profiles in {args.profiles_dir}", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Cannot build speaker profiles: {error}", file=sys.stderr)
        sys.exit(1)
