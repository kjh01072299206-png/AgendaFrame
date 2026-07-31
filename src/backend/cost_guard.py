from __future__ import annotations

from dataclasses import dataclass

from backend.config import RuntimeConfig


class CostLimitExceeded(RuntimeError):
    """Raised before an external model call would exceed a configured limit."""


@dataclass(frozen=True)
class UsageEstimate:
    article_count: int
    estimated_input_tokens: int
    estimated_output_tokens: int
    estimated_cost_usd: float


class CostGuard:
    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config

    def estimate(self, body_character_counts: list[int]) -> UsageEstimate:
        limited = [
            min(value, self.config.vertex.max_input_characters_per_article)
            for value in body_character_counts
        ]
        input_tokens = sum(max(1, value // 3) for value in limited)
        output_tokens = len(limited) * self.config.vertex.max_output_tokens
        input_cost = input_tokens / 1_000_000 * self.config.vertex.input_usd_per_million_tokens
        output_cost = output_tokens / 1_000_000 * self.config.vertex.output_usd_per_million_tokens
        return UsageEstimate(
            article_count=len(limited),
            estimated_input_tokens=input_tokens,
            estimated_output_tokens=output_tokens,
            estimated_cost_usd=input_cost + output_cost,
        )

    def enforce_run(self, body_character_counts: list[int], already_analyzed_today: int) -> None:
        if len(body_character_counts) > self.config.vertex.max_articles_per_run:
            raise CostLimitExceeded("Per-run article cap would be exceeded.")
        if (
            already_analyzed_today + len(body_character_counts)
            > self.config.vertex.max_articles_per_day
        ):
            raise CostLimitExceeded("Daily article cap would be exceeded.")
        estimate = self.estimate(body_character_counts)
        # The store tracks completed article count, not their historical token
        # usage. Treat already-processed articles as worst-case inputs so a
        # sequence of individually affordable batches cannot cross the daily
        # dollar cap.
        prior_worst_case = self.estimate(
            [self.config.vertex.max_input_characters_per_article] * already_analyzed_today
        )
        cumulative_estimated_cost = (
            prior_worst_case.estimated_cost_usd + estimate.estimated_cost_usd
        )
        if cumulative_estimated_cost > self.config.estimated_daily_vertex_limit_usd:
            raise CostLimitExceeded("Estimated Vertex cost would exceed the daily limit.")
