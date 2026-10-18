"""Deterministic numerical evaluation; NumPy only, no model or training imports."""
import math
import numpy as np

from suggestion_schema import SuggestionError, require

METRICS = ('n', 'positives', 'brier', 'ece', 'auroc', 'auprc')
METHODS = ('raw', 'global-platt', 'per-item-platt')
PROTOCOL = {
    'version': 1,
    'holdout': '30% of unique groups, rounded up; seeded shuffle; never used in fitting or selection',
    'selection': 'grouped 5-fold CV on dev groups; lowest pooled out-of-fold Brier; ties within 1e-12 prefer simpler method',
    'methods': list(METHODS),
    'perItemL2': 1.0,
    'platt': 'sigmoid(a * logit(clamp(raw, 1e-6, 1-1e-6)) + b), a > 0',
    'labels': 'relevant=false => condition=false; relevant=null excluded; otherwise condition=null excluded',
    'metrics': 'pooled and per item; Brier; ECE 10 equal-width bins; tie-aware AUROC; AUPRC = average precision',
    'bootstrap': '1000 paired resamples of held-out groups with replacement; percentile 95% CIs; undefined draws excluded and counted',
    'adoption': 'held-out pooled Brier improves; paired (calibrated-raw) Brier CI upper < 0; pooled AUROC drop <= 0.02',
    'insufficientPositives': 'per-item held-out positives < 10; flag only, does not alter adoption rule',
    'counts': 'trainExamples/heldOutExamples count distinct scored photos with usable labels; pooled metric n counts image-item labels',
}


def logit(values):
    values = np.clip(np.asarray(values, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(values) - np.log1p(-values)


def sigmoid(values):
    values = np.asarray(values, dtype=float)
    return np.exp(-np.logaddexp(0, -values))


def mapped(scores, parameters):
    return sigmoid(parameters['a'] * logit(scores) + parameters['b'])


def fit_platt(scores, labels, *, prior=None, l2=0.0):
    """Convex logistic loss with positive slope and optional L2 toward a fixed fit.

    Sum loss (not mean loss) makes fixed L2 naturally shrink sparse items more.
    Boundary solutions use a=1e-6. Degenerate single-class data remain finite.
    """
    x, y = logit(scores), np.asarray(labels, dtype=float)
    require(x.ndim == 1 and y.shape == x.shape and np.isfinite(x).all()
            and np.isfinite(y).all() and ((y >= 0) & (y <= 1)).all(), 'Invalid Platt training arrays.')
    require(l2 >= 0 and math.isfinite(l2), 'Invalid L2 strength.')
    target = np.array([prior['a'], prior['b']]) if prior else np.array([1., 0.])
    if not len(y):
        return {'a': float(target[0]), 'b': float(target[1])}
    design = np.column_stack([x, np.ones(len(x))])
    theta = target.copy()

    def objective(candidate):
        z = design @ candidate
        return float(np.sum(np.logaddexp(0, z) - y * z) + l2 / 2 * np.sum((candidate - target)**2))

    for _ in range(100):
        pred = sigmoid(design @ theta)
        gradient = design.T @ (pred - y) + l2 * (theta - target)
        hessian = (design.T * np.maximum(pred * (1 - pred), 1e-12)) @ design + np.eye(2) * (l2 + 1e-10)
        step = np.linalg.solve(hessian, gradient)
        if theta[0] - step[0] < 1e-6:
            # Solve the constrained Newton quadratic on the slope boundary.
            # Simply clipping the slope after a 2-D step leaves a wrong
            # intercept when the observed association has negative slope.
            step[0] = theta[0] - 1e-6
            step[1] = (gradient[1] - hessian[1, 0] * step[0]) / hessian[1, 1]
        value = objective(theta)
        rate = 1.
        for _ in range(60):
            candidate = theta - rate * step
            candidate[0] = max(1e-6, candidate[0])
            if objective(candidate) <= value + 1e-12:
                break
            rate *= .5
        else:
            raise SuggestionError('Platt optimizer line search failed.')
        movement = np.max(np.abs(candidate - theta))
        theta = candidate
        if movement < 1e-9:
            break
    require(np.isfinite(theta).all() and theta[0] > 0, 'Platt optimizer produced invalid coefficients.')
    return {'a': float(theta[0]), 'b': float(theta[1])}


def group_holdout(groups, seed=7):
    unique = sorted(set(groups))
    require(len(unique) >= 2, 'At least two groups are needed for a held-out split.')
    np.random.default_rng(seed).shuffle(unique)
    count = math.ceil(.3 * len(unique))
    return sorted(unique[count:]), sorted(unique[:count])


def grouped_folds(groups, seed=7):
    unique = sorted(set(groups))
    require(len(unique) >= 5, 'Grouped 5-fold CV needs at least five development groups (at least eight total groups).')
    np.random.default_rng(seed).shuffle(unique)
    return [sorted(unique[i::5]) for i in range(5)]


def metric_values(labels, scores):
    y, p = np.asarray(labels, dtype=float), np.asarray(scores, dtype=float)
    require(y.ndim == 1 and p.shape == y.shape and np.isfinite(p).all()
            and np.isfinite(y).all() and ((y == 0) | (y == 1)).all()
            and ((p >= 0) & (p <= 1)).all(), 'Invalid metric arrays.')
    n, positives = len(y), int(y.sum())
    result = {'n': n, 'positives': positives, 'brier': None, 'ece': None, 'auroc': None, 'auprc': None}
    if not n:
        return result
    result['brier'] = float(np.mean((p - y)**2))
    bins = np.minimum((p * 10).astype(int), 9)
    result['ece'] = float(sum(abs(float(np.sum(p[bins == b] - y[bins == b]))) for b in range(10)) / n)
    order = np.argsort(-p, kind='stable')
    ys, ps = y[order], p[order]
    ends = np.r_[np.flatnonzero(ps[1:] != ps[:-1]) + 1, n]
    tp = np.cumsum(ys)[ends - 1]
    fp = ends - tp
    if positives:
        result['auprc'] = float(np.sum(np.diff(np.r_[0., tp]) / positives * tp / ends))
    negatives = n - positives
    if positives and negatives:
        tpr, fpr = np.r_[0., tp / positives], np.r_[0., fp / negatives]
        result['auroc'] = float(np.sum(np.diff(fpr) * (tpr[1:] + tpr[:-1]) / 2))
    return result


def fit_method(rows, method, item_ids):
    require(method in METHODS, 'Unknown calibration method.')
    if method == 'raw':
        return {key: {'a': 1., 'b': 0.} for key in item_ids}
    global_fit = fit_platt([r['raw'] for r in rows], [r['label'] for r in rows])
    if method == 'global-platt':
        return {key: dict(global_fit) for key in item_ids}
    parameters = {}
    for key in item_ids:
        subset = [r for r in rows if r['item'] == key]
        parameters[key] = fit_platt([r['raw'] for r in subset], [r['label'] for r in subset],
                                   prior=global_fit, l2=PROTOCOL['perItemL2'])
    return parameters


def predict(rows, method, parameters):
    if method == 'raw':
        # Raw selection has exact identity, including endpoints 0 and 1.
        return np.asarray([r['raw'] for r in rows])
    return np.asarray([float(mapped(r['raw'], parameters[r['item']])) for r in rows])


def select_method(rows, dev_groups, item_ids, seed=7):
    scores = {}
    folds = grouped_folds(dev_groups, seed)
    for method in METHODS:
        squared_error, examples = 0., 0
        for held in folds:
            train = [r for r in rows if r['group'] not in held]
            valid = [r for r in rows if r['group'] in held]
            require(bool(train) and bool(valid), 'Every CV training/validation fold needs usable labels.')
            parameters = fit_method(train, method, item_ids)
            pred = predict(valid, method, parameters)
            squared_error += float(np.sum((pred - [r['label'] for r in valid])**2))
            examples += len(valid)
        scores[method] = squared_error / examples
    lowest = min(scores.values())
    chosen = next(method for method in METHODS if scores[method] <= lowest + 1e-12)
    return chosen, scores, folds


def adoption_rule(raw, calibrated, difference_ci):
    return bool(raw['brier'] is not None and calibrated['brier'] is not None
                and calibrated['brier'] < raw['brier'] and difference_ci[1] is not None
                and difference_ci[1] < 0 and raw['auroc'] is not None and calibrated['auroc'] is not None
                and calibrated['auroc'] >= raw['auroc'] - .02)


def comparison_report(rows, calibrated, *, groups=None, seed=7, resamples=1000):
    """Paired cluster bootstrap; resample full held-out groups, never individual frames.

    `groups` includes groups with zero usable labels for this item. Undefined
    single-class AUROC/AUPRC draws do not become artificial zero scores.
    """
    y = np.asarray([r['label'] for r in rows])
    raw = np.asarray([r['raw'] for r in rows])
    calibrated = np.asarray(calibrated)
    groups = sorted(set(groups if groups is not None else [r['group'] for r in rows]))
    positions = {g: np.asarray([i for i, r in enumerate(rows) if r['group'] == g], dtype=int) for g in groups}
    values = {'raw': metric_values(y, raw), 'calibrated': metric_values(y, calibrated)}
    draws = {kind: {key: [] for key in METRICS} for kind in values}
    differences = []
    rng = np.random.default_rng(seed)
    for _ in range(resamples):
        indexes = np.concatenate([positions[groups[i]] for i in rng.integers(0, len(groups), len(groups))]) if groups else np.array([], dtype=int)
        pair = {kind: metric_values(y[indexes], p[indexes]) for kind, p in [('raw', raw), ('calibrated', calibrated)]}
        for kind in pair:
            for key in METRICS:
                if pair[kind][key] is not None:
                    draws[kind][key].append(pair[kind][key])
        if pair['raw']['brier'] is not None:
            differences.append(pair['calibrated']['brier'] - pair['raw']['brier'])

    def interval(samples):
        return [float(v) for v in np.percentile(samples, [2.5, 97.5])] if samples else [None, None]

    report = {}
    for kind in values:
        report[kind] = {key: {'value': values[kind][key], 'ci95': interval(draws[kind][key]),
                             'definedResamples': len(draws[kind][key])} for key in METRICS}
    report['pairedBrierDifference'] = {'value': (values['calibrated']['brier'] - values['raw']['brier']) if len(y) else None,
                                      'ci95': interval(differences), 'definedResamples': len(differences)}
    report['insufficientPositives'] = int(y.sum()) < 10
    return report
