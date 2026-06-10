"""Shared runner error types."""

from __future__ import annotations


class FatalInvariantError(Exception):
    """Unrecoverable quest runner invariant violation."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


class AdvanceValidationError(Exception):
    """Manual advance blocked by unmet predicates; state must not change."""

    def __init__(self, message: str, *, reason: str) -> None:
        self.message = message
        self.reason = reason
        super().__init__(message)
