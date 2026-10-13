"""Metric checks against sklearn / the textbook values.  backend/.env/bin/python -m pytest backend/tests/test_metrics.py  (or run directly)"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "benchmark"))
import metrics as m  # noqa: E402


def test_auc_matches_sklearn():
    from sklearn.metrics import roc_auc_score

    rng = np.random.default_rng(1)
    y = rng.random(300) < 0.1
    s = rng.normal(size=300) + 1.5 * y
    s[:20] = np.round(s[:20])  # ties
    assert abs(m.roc_auc(s, y) - roc_auc_score(y, s)) < 1e-9


def test_perfect_and_random():
    y = np.array([1] * 5 + [0] * 95, bool)
    assert m.roc_auc(np.arange(100)[::-1], y) == 1.0
    assert m.enrichment_factor(np.arange(100)[::-1], y, 0.05) == 20.0
    assert abs(m.bedroc(np.arange(100)[::-1], y) - 1.0) < 0.02
    assert m.roc_auc(np.zeros(100), y) <= 0.5  # constant scorer gets no credit (pessimistic ties)


def test_ef1():
    y = np.zeros(200, bool)
    y[:2] = True
    s = np.arange(200)[::-1].astype(float)  # actives are the best two of 200 -> top 1% = 2 ligands, both active
    assert m.enrichment_factor(s, y, 0.01) == 100.0


if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f()
            print("ok", k)
