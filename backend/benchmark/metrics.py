"""Virtual-screening metrics: ROC AUC, enrichment factor at x% (EF1, EF5), BEDROC, and bootstrap confidence intervals.

`scores` are higher = better; ties are broken pessimistically (inactives first) so that a scorer returning one constant value gets no credit.
"""

import numpy as np


def _order(scores: np.ndarray, active: np.ndarray) -> np.ndarray:
    return np.lexsort((active, -scores))  # sort by score desc, then inactives before actives within a tie


def roc_auc(scores, active) -> float:
    s, y = np.asarray(scores, float), np.asarray(active, bool)
    n_a, n_d = int(y.sum()), int((~y).sum())
    if not n_a or not n_d:
        return float("nan")
    # Mann-Whitney U with ties counted as half
    ranks = _rank_avg(s)
    return float((ranks[y].sum() - n_a * (n_a + 1) / 2) / (n_a * n_d))


def _rank_avg(x: np.ndarray) -> np.ndarray:
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(len(x))
    xs = x[order]
    i = 0
    while i < len(x):
        j = i
        while j + 1 < len(x) and xs[j + 1] == xs[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def enrichment_factor(scores, active, fraction: float) -> float:
    s, y = np.asarray(scores, float), np.asarray(active, bool)
    n = max(1, int(np.ceil(fraction * len(s))))
    top = y[_order(s, y)][:n].sum()
    return float((top / n) / (y.sum() / len(y))) if y.any() else float("nan")


def bedroc(scores, active, alpha: float = 20.0) -> float:
    s, y = np.asarray(scores, float), np.asarray(active, bool)
    n, na = len(s), int(y.sum())
    if not na or na == n:
        return float("nan")
    ra = (np.flatnonzero(y[_order(s, y)]) + 1) / n
    ra_ = na / n
    rie = (np.exp(-alpha * ra).sum() / na) / ((1 / n) * (1 - np.exp(-alpha)) / (np.exp(alpha / n) - 1))
    return float(rie * ra_ * np.sinh(alpha / 2) / (np.cosh(alpha / 2) - np.cosh(alpha / 2 - alpha * ra_)) + 1 / (1 - np.exp(alpha * (1 - ra_))))


def summarize(scores, active) -> dict:
    return {"auc": roc_auc(scores, active), "ef1": enrichment_factor(scores, active, 0.01), "ef5": enrichment_factor(scores, active, 0.05),
            "bedroc": bedroc(scores, active)}


def bootstrap(scores, active, n: int = 500, seed: int = 0) -> dict:
    """95% percentile intervals from resampling ligands (stratified by class)."""
    s, y = np.asarray(scores, float), np.asarray(active, bool)
    rng = np.random.default_rng(seed)
    ia, idd = np.flatnonzero(y), np.flatnonzero(~y)
    rows = []
    for _ in range(n):
        idx = np.concatenate([rng.choice(ia, len(ia)), rng.choice(idd, len(idd))])
        rows.append(summarize(s[idx], y[idx]))
    return {k: [float(np.nanpercentile([r[k] for r in rows], q)) for q in (2.5, 97.5)] for k in rows[0]}
