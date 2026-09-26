"""Small, dependency-free rules shared by the recognizer and its tests."""

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Identity:
    speaker: str
    score: float
    margin: float


def identify(scores: dict[str, float], min_score: float = 0.30,
             min_margin: float = 0.08) -> Identity:
    """Unknown is a rejection, never an enrolled identity or a probability."""
    if len(scores) < 2 or any(not math.isfinite(value) for value in scores.values()):
        return Identity("Unknown", 0.0, 0.0)
    ranking = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    name, score = ranking[0]
    margin = score - ranking[1][1]
    accepted = score >= min_score and margin >= min_margin
    return Identity(name if accepted else "Unknown", score, margin)


class CaptureContinuity:
    """A queue drop or device overflow must break the current audio window."""

    def __init__(self):
        self.next_sequence = None
        self.expected_start_ms = None

    def accept(self, sequence: int, start_ms: float, frames: int,
               sample_rate: int, overflow: bool = False) -> bool:
        continuous = (
            not overflow
            and (self.next_sequence is None or sequence == self.next_sequence)
            and (self.expected_start_ms is None
                 or abs(start_ms - self.expected_start_ms) <= 100)
        )
        self.next_sequence = sequence + 1
        self.expected_start_ms = start_ms + frames * 1000 / sample_rate
        return continuous
