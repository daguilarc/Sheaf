"""Bayesian cost model: Normal-Inverse-Gamma (NIG) conjugate linear
regression and Student-t predictive/quantile/Thompson queries over
complexity features, trained per (cost category, model+effort arm).

See openspec design.md D6 and specs/task-analyzer-cost-model/spec.md for the
normative behavior this implements: closed-form conjugate updates (no
dependencies beyond numpy + stdlib), a Student-t posterior predictive, and
partial pooling across arms via a shared weak prior (see ``train.py``, which
does the pooling and persists ``NIG.to_json()`` into ``estimator_params``).

Targets are trained in log space: ``y = log(usd + epsilon)`` (see
``transform_target``/``inverse_transform``); ``NIG`` itself is a generic
conjugate linear regression over whatever ``y`` it's given, and the required
"reproduce every query" fields (feature names/order, transform+epsilon,
prior hyperparameters, pooling scheme, training filters, category/arm
lists, quantile algorithm id, output formatting rule) live in
``config_json`` -- see ``default_config``.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

DEFAULT_FEATURES = ["1", "composite", "c3", "c4", "c5"]
DEFAULT_EPSILON = 1e-4
QUANTILE_ALGORITHM = "student_t_ppf_incomplete_beta_bisection_v1"


def default_config(features: Sequence[str] = DEFAULT_FEATURES, epsilon: float = DEFAULT_EPSILON) -> dict:
    """The baseline ``config_json`` payload (design.md D6 / spec.md
    "Estimator persistence is self-sufficient"). ``train.py`` deep-merges
    caller overrides on top of this and fills in the data-dependent fields
    (``training_filters`` values, ``categories``, ``arms``) after querying
    the database -- this function only supplies defaults, it does not know
    about any particular training run.
    """
    k = len(features)
    return {
        "features": list(features),
        "transform": "log_usd_plus_epsilon",
        "epsilon": epsilon,
        "prior": {
            "mu0": [0.0] * k,
            "Lambda0": (np.eye(k) * 1e-2).tolist(),
            "a0": 1.0,
            "b0": 1.0,
        },
        "pooling": "pooled-mean-weak-prior-v1",
        "training_filters": {
            "rubric_version": None,
            "taxonomy_version": None,
            "price_version": None,
            "min_rows_per_arm": 1,
        },
        "categories": [],
        "arms": [],
        "quantile_algorithm": QUANTILE_ALGORITHM,
        "output_format": "usd = exp(y) - epsilon",
    }


def transform_target(usd: float, epsilon: float = DEFAULT_EPSILON) -> float:
    """``y = log(usd + epsilon)`` -- the regression target."""
    return math.log(usd + epsilon)


def inverse_transform(y: float, epsilon: float = DEFAULT_EPSILON) -> float:
    """Inverse of ``transform_target``: recover a dollar figure from a
    log-space prediction/quantile."""
    return math.exp(y) - epsilon


def features(complexity_row, config: Optional[dict] = None) -> np.ndarray:
    """Build the feature vector for one task's complexity row, per
    ``config["features"]`` (default ``[1, composite, C3, C4, C5]``).

    ``complexity_row`` is anything supporting ``row[name]`` (a
    ``sqlite3.Row`` or a plain dict) with lowercase column names matching
    ``schema.sql`` (``composite``, ``c3``, ``c4``, ``c5``, ...); the literal
    feature name ``"1"`` contributes the intercept term.
    """
    names = (config or {}).get("features", DEFAULT_FEATURES)
    return np.array(
        [1.0 if name == "1" else float(complexity_row[name]) for name in names],
        dtype=float,
    )


# ---------------------------------------------------------------------------
# Student-t inverse CDF without scipy: the regularized incomplete beta
# function via a lgamma-based continued fraction (Numerical Recipes
# betacf/betai), used to build the t-CDF, then bisection to invert it.
# ---------------------------------------------------------------------------

_FPMIN = 1e-300


def _betacf(a: float, b: float, x: float, max_iter: int = 200, eps: float = 1e-14) -> float:
    """Continued-fraction evaluation used by the regularized incomplete
    beta function (Numerical Recipes ``betacf``)."""
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < _FPMIN:
        d = _FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < _FPMIN:
            d = _FPMIN
        c = 1.0 + aa / c
        if abs(c) < _FPMIN:
            c = _FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < _FPMIN:
            d = _FPMIN
        c = 1.0 + aa / c
        if abs(c) < _FPMIN:
            c = _FPMIN
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta function I_x(a, b), computed via the
    lgamma-based prefactor and ``_betacf`` (Numerical Recipes ``betai``)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    bt = math.exp(
        math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
        + a * math.log(x) + b * math.log(1.0 - x)
    )
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def t_cdf(t: float, df: float) -> float:
    """CDF of the Student-t distribution with ``df`` degrees of freedom."""
    if df <= 0:
        raise ValueError("df must be positive")
    x = df / (df + t * t)
    ib = _betai(df / 2.0, 0.5, x)
    return 1.0 - 0.5 * ib if t > 0 else 0.5 * ib


def t_ppf(q: float, df: float, tol: float = 1e-10, max_iter: int = 200) -> float:
    """Inverse CDF (quantile function) of the Student-t distribution, found
    by bisecting ``t_cdf`` (no scipy dependency)."""
    if not 0.0 < q < 1.0:
        raise ValueError("q must be in (0, 1)")
    if q == 0.5:
        return 0.0
    lo, hi = -1.0e6, 1.0e6
    flo = t_cdf(lo, df) - q
    mid = 0.0
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        fmid = t_cdf(mid, df) - q
        if abs(fmid) < tol or (hi - lo) < tol:
            return mid
        if (fmid > 0) == (flo > 0):
            lo, flo = mid, fmid
        else:
            hi = mid
    return mid


@dataclass
class NIG:
    """Normal-Inverse-Gamma prior/posterior for conjugate Bayesian linear
    regression: ``beta | sigma2 ~ N(mu, sigma2 * Lambda^-1)``,
    ``sigma2 ~ InvGamma(a, b)``.

    An ``NIG`` instance can be either a prior or a posterior -- ``update``
    always treats ``self`` as the prior and returns a new posterior
    ``NIG``, which is what partial pooling needs: a pooled fit's posterior
    *mean* becomes the center of a fresh weak-precision prior for each arm
    (see ``train.py``'s ``pooled-mean-weak-prior-v1`` scheme).
    """

    mu: np.ndarray
    Lambda: np.ndarray
    a: float
    b: float

    @classmethod
    def weak_prior(cls, k: int, lambda0_scale: float = 1e-2, a0: float = 1.0, b0: float = 1.0) -> "NIG":
        """A weak, uninformative prior over ``k`` features: ``mu0=0``,
        ``Lambda0 = I * lambda0_scale``."""
        return cls(mu=np.zeros(k), Lambda=np.eye(k) * lambda0_scale, a=float(a0), b=float(b0))

    def update(self, X: np.ndarray, y: np.ndarray) -> "NIG":
        """Standard conjugate update given design matrix ``X`` (n x k) and
        targets ``y`` (n,): ``Λn = Λ0 + XᵀX``, ``μn = Λn⁻¹(Λ0 μ0 + Xᵀy)``,
        ``an = a0 + n/2``, ``bn = b0 + ½(yᵀy + μ0ᵀΛ0μ0 − μnᵀΛnμn)``."""
        X = np.atleast_2d(np.asarray(X, dtype=float))
        y = np.asarray(y, dtype=float).reshape(-1)
        n = X.shape[0]
        lambda_n = self.Lambda + X.T @ X
        rhs = self.Lambda @ self.mu + X.T @ y
        mu_n = np.linalg.solve(lambda_n, rhs)
        a_n = self.a + n / 2.0
        b_n = self.b + 0.5 * (
            float(y @ y)
            + float(self.mu @ self.Lambda @ self.mu)
            - float(mu_n @ lambda_n @ mu_n)
        )
        return NIG(mu=mu_n, Lambda=lambda_n, a=a_n, b=b_n)

    def predictive(self, x: np.ndarray):
        """Posterior predictive at feature vector ``x``: Student-t with
        ``mean = xᵀμn``, ``df = 2an``, ``scale² = (bn/an)(1 + xᵀΛn⁻¹x)``.
        Returns ``(mean, scale, df)``."""
        x = np.asarray(x, dtype=float).reshape(-1)
        mean = float(x @ self.mu)
        df = 2.0 * self.a
        quad = float(x @ np.linalg.solve(self.Lambda, x))
        scale = math.sqrt((self.b / self.a) * (1.0 + quad))
        return mean, scale, df

    def quantile(self, x: np.ndarray, q: float) -> float:
        """The ``q``-quantile of the posterior predictive at ``x``, in
        whatever space this ``NIG`` was trained (log-usd for cost
        estimators; callers exponentiate via ``inverse_transform``)."""
        mean, scale, df = self.predictive(x)
        return mean + scale * t_ppf(q, df)

    def thompson(self, x: np.ndarray, rng: np.random.Generator) -> float:
        """One Thompson sample at ``x``: draw ``sigma2 ~ InvGamma(a, b)``,
        then ``beta ~ N(mu, sigma2 * Lambda^-1)``, return ``xᵀbeta``.
        ``rng`` is a caller-supplied ``numpy.random.Generator`` (explicit
        seed, never persisted -- see design.md D6)."""
        x = np.asarray(x, dtype=float).reshape(-1)
        sigma2 = 1.0 / rng.gamma(shape=self.a, scale=1.0 / self.b)
        cov = sigma2 * np.linalg.inv(self.Lambda)
        beta = rng.multivariate_normal(self.mu, cov)
        return float(x @ beta)

    def to_json(self) -> str:
        return json.dumps(
            {"mu": self.mu.tolist(), "Lambda": self.Lambda.tolist(), "a": self.a, "b": self.b},
            sort_keys=True,
        )

    @classmethod
    def from_json(cls, s: str) -> "NIG":
        d = json.loads(s)
        return cls(
            mu=np.array(d["mu"], dtype=float),
            Lambda=np.array(d["Lambda"], dtype=float),
            a=float(d["a"]),
            b=float(d["b"]),
        )
