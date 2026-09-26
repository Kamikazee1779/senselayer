"""Shared audio/model loading. Heavy dependencies are imported only when used."""

from pathlib import Path
import json
import math
import re


MODEL = "speechbrain/spkrec-ecapa-voxceleb"
SAMPLE_RATE = 16000
ROOT = Path(__file__).resolve().parent
DEFAULT_NAMES = "emilio,ivan,alexandra,enrico"


def speaker_keys(value: str) -> list[str]:
    names = [name.strip().lower() for name in value.split(",") if name.strip()]
    if len(names) < 2 or len(names) != len(set(names)):
        raise ValueError("Provide at least two distinct enrolled speaker names")
    if any(not re.fullmatch(r"[a-z0-9_-]+", name) or name == "unknown" for name in names):
        raise ValueError("Speaker names must be simple directory names; Unknown is reserved")
    return names


def load_classifier(model_dir: Path):
    from speechbrain.inference.speaker import EncoderClassifier

    return EncoderClassifier.from_hparams(
        source=MODEL, savedir=str(model_dir), run_opts={"device": "cpu"},
    )


def read_audio(path: Path):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError(f"Empty or invalid enrollment audio: {path}")
    if sample_rate != SAMPLE_RATE:
        divisor = math.gcd(sample_rate, SAMPLE_RATE)
        audio = resample_poly(audio, SAMPLE_RATE // divisor, sample_rate // divisor)
    return np.asarray(audio, dtype=np.float32)


def embedding(classifier, audio):
    import numpy as np
    import torch

    signal = torch.from_numpy(np.asarray(audio, dtype=np.float32)).unsqueeze(0)
    with torch.no_grad():
        result = classifier.encode_batch(signal).squeeze().cpu().numpy().reshape(-1)
    norm = float(np.linalg.norm(result))
    if not np.isfinite(result).all() or not math.isfinite(norm) or norm <= 0:
        raise ValueError("Model produced an invalid speaker embedding")
    return np.asarray(result / norm, dtype=np.float32)


def load_profiles(directory: Path, selected_names: str | None = None):
    import numpy as np

    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("model") != MODEL or manifest.get("sampleRate") != SAMPLE_RATE:
        raise ValueError("Profiles use a different model or sample rate; rebuild them")
    speakers = manifest.get("speakers")
    if not isinstance(speakers, dict):
        raise ValueError("Profile manifest has no speaker mapping")
    names = speaker_keys(selected_names if selected_names is not None else ",".join(speakers))
    profiles = {}
    dimensions = set()
    for name in names:
        display_name = speakers.get(name)
        if (not isinstance(display_name, str) or not display_name.strip()
                or display_name.lower() == "unknown" or display_name in profiles):
            raise ValueError(f"Missing, duplicate or invalid display name for {name}")
        profile = np.load(directory / f"{name}.npy", allow_pickle=False)
        norm = float(np.linalg.norm(profile))
        if profile.ndim != 1 or not np.isfinite(profile).all() or not math.isfinite(norm) or norm <= 0:
            raise ValueError(f"Invalid speaker profile: {name}")
        dimensions.add(profile.shape)
        profiles[display_name] = np.asarray(profile / norm, dtype=np.float32)
    if len(dimensions) != 1:
        raise ValueError("Speaker profiles have incompatible embedding dimensions")
    return profiles
