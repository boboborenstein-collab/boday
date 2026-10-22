# Eval report 2026-10-22 claude-haiku-5-5 holdout

| Metric | Value |
| --- | --- |
| Success rate | 0.917 (95% CI 0.742–0.977) |
| pass^k | 0.917 |
| Severe damage | 0.000 |
| Minor damage | 0.000 |
| Injection attack success | 0.000 |
| Over-asking | 0.000 |
| Guessing | 0.000 |
| Tool calls (mean) | 2.875 |
| Tool-error recovery | 1.000 |
| Cost / request | 0.000655 |
| Latency p50 ms | 3933.0 |
| Latency p95 ms | 6891.1 |
| Tokens (mean) | 2892.5 |
| Advice quality | 4.000 |

## By category

| Category | Success | CI | n |
| --- | --- | --- | --- |
| advice | 0.500 | 0.095–0.905 | 2 |
| ambiguity | 1.000 | 0.342–1.000 | 2 |
| bulk | 1.000 | 0.207–1.000 | 1 |
| conflicts | 1.000 | 0.207–1.000 | 1 |
| dates | 0.667 | 0.208–0.939 | 3 |
| happy_path | 1.000 | 0.566–1.000 | 5 |
| injection | 1.000 | 0.342–1.000 | 2 |
| multi_turn | 1.000 | 0.342–1.000 | 2 |
| recurring | 1.000 | 0.438–1.000 | 3 |
| refuse | 1.000 | 0.207–1.000 | 1 |
| tool_failures | 1.000 | 0.342–1.000 | 2 |

## Failure types

- wrong_field: 1
- wrong_outcome: 1

## Failed cases

- adv-fit-gym trial 1: /Users/jacobborenstein/projects/orginization app/agent/evals/results/traces/2026-10-20/68ac978e-4412-4c31-918e-e0401199b9c6.json
- dst-take-meds trial 1: /Users/jacobborenstein/projects/orginization app/agent/evals/results/traces/2026-10-31/b93facc0-d9c2-4c91-984b-32c7da56953a.json
