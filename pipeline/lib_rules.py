"""Pure, unit-tested rule helpers shared by the H1V pipeline and pipeline/test_h1v.py."""


def is_rate_variance(ratio, threshold):
    """Strictly greater than threshold. Ratio is rounded to 6 d.p. first so float noise
    (e.g. 1.3000000000000003) can never flag a job sitting exactly on the boundary."""
    return round(float(ratio), 6) > threshold


def variance_band(ratio, bands):
    """bands: list of {'name', 'min'} ordered high->low. Caller only passes ratios that passed is_rate_variance."""
    r = round(float(ratio), 6)
    for b in bands:
        if r >= b["min"]:
            return b["name"]
    return bands[-1]["name"]


def pick_candidate(dominant_issue, matrix, reopen_rate, standard_rate, exclude=()):
    """Lowest observed 30-day reopen rate among the compatible methods; ties broken by lower standard rate, then name.
    Returns None if the issue has no compatible method."""
    cands = [m for m in matrix.get(dominant_issue, []) if m not in exclude] or list(matrix.get(dominant_issue, []))
    if not cands:
        return None
    return min(cands, key=lambda m: (round(reopen_rate[m], 9), standard_rate[m], m))
