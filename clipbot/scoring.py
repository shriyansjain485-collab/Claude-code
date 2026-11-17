"""Turn per-second signals (audio loudness, chat activity, replay heatmap) into a
"hype" score and pick the top moments."""

from __future__ import annotations

import bisect
import math
from collections import deque


def rolling_median(values: list[float], before: int, after: int = 0) -> list[float]:
    """Median of values[i-before : i+after+1] for each i."""
    window: list[float] = []
    out = []
    n = len(values)
    lo = hi = 0  # current window is values[lo:hi]
    for i in range(n):
        new_hi, new_lo = min(n, i + after + 1), max(0, i - before)
        while hi < new_hi:
            bisect.insort(window, values[hi])
            hi += 1
        while lo < new_lo:
            window.pop(bisect.bisect_left(window, values[lo]))
            lo += 1
        out.append(window[len(window) // 2])
    return out


def smooth(values: list[float], k: int) -> list[float]:
    """Centred moving average over k samples."""
    if k <= 1:
        return list(values)
    half = k // 2
    prefix = [0.0]
    for v in values:
        prefix.append(prefix[-1] + v)
    n = len(values)
    return [(prefix[min(n, i + half + 1)] - prefix[max(0, i - half)]) / (min(n, i + half + 1) - max(0, i - half))
            for i in range(n)]


def zscores(values: list[float]) -> list[float]:
    n = len(values)
    if n == 0:
        return []
    mean = sum(values) / n
    std = math.sqrt(sum((v - mean) ** 2 for v in values) / n) or 1.0
    return [(v - mean) / std for v in values]


def audio_excitement(loud_db: list[float], context: int = 60, smoothing: int = 3) -> list[float]:
    """How much louder each second is than its surroundings, as a z-score.
    Relative loudness (not absolute) so quiet and loud streamers both work."""
    baseline = rolling_median(loud_db, before=context, after=context)
    lift = [l - b for l, b in zip(loud_db, baseline)]
    return zscores(smooth(lift, smoothing))


def combine(signals: list[tuple[list[float], float]]) -> list[float]:
    """Weighted sum of z-score series, rescaled so the result is still z-like."""
    signals = [(s, w) for s, w in signals if s and w > 0]
    if not signals:
        return []
    n = min(len(s) for s, _ in signals)
    norm = math.sqrt(sum(w * w for _, w in signals))
    return [sum(s[i] * w for s, w in signals) / norm for i in range(n)]


def pick_peaks(score: list[float], top: int, min_gap: int, min_score: float = 1.0) -> list[tuple[int, float]]:
    """Highest-scoring seconds, at least min_gap apart (no overlapping clips)."""
    picked: list[tuple[int, float]] = []
    for idx in sorted(range(len(score)), key=score.__getitem__, reverse=True):
        if len(picked) >= top or score[idx] < min_score:
            break
        if all(abs(idx - p) >= min_gap for p, _ in picked):
            picked.append((idx, score[idx]))
    return picked


class RollingZ:
    """Streaming z-score against the last `window` samples (for live mode)."""

    def __init__(self, window: int):
        self.values: deque[float] = deque(maxlen=window)
        self.total = 0.0
        self.total_sq = 0.0

    def push(self, v: float) -> float:
        if len(self.values) == self.values.maxlen:
            old = self.values[0]
            self.total -= old
            self.total_sq -= old * old
        self.values.append(v)
        self.total += v
        self.total_sq += v * v
        n = len(self.values)
        mean = self.total / n
        std = math.sqrt(max(self.total_sq / n - mean * mean, 1e-9))
        return (v - mean) / max(std, 0.5 if n < 30 else 1e-3)

    def __len__(self) -> int:
        return len(self.values)


class RollingMedian:
    """Trailing median for live loudness baseline."""

    def __init__(self, window: int):
        self.order: deque[float] = deque()
        self.sorted: list[float] = []
        self.window = window

    def push(self, v: float) -> float:
        self.order.append(v)
        bisect.insort(self.sorted, v)
        if len(self.order) > self.window:
            old = self.order.popleft()
            self.sorted.pop(bisect.bisect_left(self.sorted, old))
        return self.sorted[len(self.sorted) // 2]


def hms(seconds: float) -> str:
    s = int(max(0, seconds))
    return f"{s // 3600:d}:{s % 3600 // 60:02d}:{s % 60:02d}"
