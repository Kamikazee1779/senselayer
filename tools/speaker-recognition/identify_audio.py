"""Compare a local recording with saved profiles, without a microphone or STT API."""

import argparse
from collections import Counter
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys

from ecapa import ROOT, SAMPLE_RATE, embedding, load_classifier, load_profiles, read_audio
from speaker_policy import identify
from speaker_service import setting


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path, help="A new recording, for example a WAV file")
    parser.add_argument("--profiles-dir", type=Path, default=ROOT / "profiles")
    parser.add_argument("--model-dir", type=Path, default=ROOT / "models" / "spkrec-ecapa-voxceleb")
    parser.add_argument("--names", default=os.getenv("SENSELAYER_SPEAKER_NAMES"))
    parser.add_argument("--json", action="store_true", help="Print one JSON record per window for saving a report")
    args = parser.parse_args()

    # Testing must work offline, using the model already downloaded by prewarm.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ.setdefault("HF_HOME", str(ROOT / "models" / "huggingface"))
    window_sec, hop_sec = setting("WINDOW_SEC", 3), setting("HOP_SEC", 1.5)
    min_rms = setting("MIN_RMS", 0.003)
    min_score, min_margin = setting("MIN_SCORE", 0.30), setting("MIN_MARGIN", 0.08)
    if not 0 < hop_sec <= window_sec <= 30 or min_rms < 0:
        raise ValueError("Expected 0 < HOP_SEC <= WINDOW_SEC <= 30 and MIN_RMS >= 0")
    if not -1 <= min_score <= 1 or not 0 <= min_margin <= 2:
        raise ValueError("Invalid cosine score or margin threshold")
    window_frames, hop_frames = round(window_sec * SAMPLE_RATE), round(hop_sec * SAMPLE_RATE)
    if hop_frames < 1:
        raise ValueError("HOP_SEC is shorter than one sample")

    import numpy as np

    audio = read_audio(args.audio)
    if len(audio) < window_frames:
        raise ValueError(f"Record at least {window_sec:g} seconds; this file is {len(audio) / SAMPLE_RATE:.2f}s")
    profiles = load_profiles(args.profiles_dir, args.names)
    with redirect_stdout(sys.stderr):
        classifier = load_classifier(args.model_dir)
    print(f"Local test: {args.audio.name} ({len(audio) / SAMPLE_RATE:.2f}s); "
          f"window={window_sec:g}s hop={hop_sec:g}s score>={min_score:g} margin>={min_margin:g}", file=sys.stderr)
    print("Window matches only, not transcript attribution. Scores are similarities, not probabilities.", file=sys.stderr)
    counts = Counter()
    last_end = 0
    for start in range(0, len(audio) - window_frames + 1, hop_frames):
        last_end = start + window_frames
        window = audio[start:last_end]
        rms = float(np.sqrt(np.mean(window.astype(np.float64) ** 2)))
        result = {"startSec": start / SAMPLE_RATE, "endSec": last_end / SAMPLE_RATE, "rms": rms}
        if rms < min_rms:
            result.update(speaker=None, reason="silence", score=None, margin=None, scores={})
        else:
            with redirect_stdout(sys.stderr):
                encoded = embedding(classifier, window)
            scores = {name: float(np.clip(np.dot(encoded, profile), -1, 1)) for name, profile in profiles.items()}
            match = identify(scores, min_score, min_margin)
            reason = "low similarity" if match.score < min_score else "ambiguous match" if match.margin < min_margin else "match"
            result.update(speaker=match.speaker, score=match.score, margin=match.margin, reason=reason,
                          scores=dict(sorted(scores.items(), key=lambda pair: pair[1], reverse=True)))
        counts[result["speaker"] or "Silence"] += 1
        if args.json:
            print(json.dumps(result, allow_nan=False), flush=True)
        else:
            metrics = "" if result["score"] is None else f" | score={result['score']:.3f} margin={result['margin']:.3f}"
            print(f"{result['startSec']:6.2f}-{result['endSec']:6.2f}s  {result['speaker'] or 'Silence'}"
                  f"{metrics} | {result['reason']}", flush=True)
            if result["scores"]:
                print("    " + "  ".join(f"{name}={score:.3f}" for name, score in result["scores"].items()))
    print("Windows: " + ", ".join(f"{name}={count}" for name, count in counts.items()), file=sys.stderr)
    if last_end < len(audio):
        print(f"Final {(len(audio) - last_end) / SAMPLE_RATE:.2f}s omitted: incomplete window.", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:
        print(f"Cannot identify local audio: {error}", file=sys.stderr)
        sys.exit(1)
