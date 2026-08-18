# Code

Nine files from the study system, copied verbatim.

| File | Lines | What it demonstrates |
|---|---:|---|
| [`parse_hands.py`](parse_hands.py) | 140 | The shorthand parser: a compact hand notation you can type from memory, turned into structured records the rest of the system can query. Tested against a real hand-history corpus rather than hand-written fixtures, because real formats are messier than anything you would invent. |
| [`equity.py`](equity.py) | 257 | Equity computation over ranges. |
| [`stats.py`](stats.py) | 57 | The variance-honest layer: rates always carry their sample size, and a rate that cannot be distinguished from noise is reported as exactly that. |
| [`solve/pushfold.js`](solve/pushfold.js) | 185 | Push/fold solving for short-stack spots — the region where the game is actually solved, so the correct play is a lookup rather than an opinion. |
| [`solve/eqmatrix.js`](solve/eqmatrix.js) | 88 | Range-vs-range equity matrices feeding the solvers and the drills. |
| [`postflop_review.js`](postflop_review.js) | 241 | The review pass: grades a decision on what was known at the time, keeping the result as metadata rather than as the grade. |
| [`validate_postflop.js`](validate_postflop.js) | 413 | Validation harness for the postflop logic. |
| [`test_poker.js`](test_poker.js) | 235 | Core test suite. |
| [`app/study.js`](app/study.js) | 1655 | The study surface: drills built from logged hands, spaced review of the spots that actually recur, and the sample-size honesty applied at the point of display rather than buried in a stats page. |
| [`app/postflop.js`](app/postflop.js) | 819 | Board texture, equity and spot classification — the engine the drills are generated from. |
| [`app/poker.js`](app/poker.js) | 465 | Hand model and shorthand parsing. |
| [`analyze_session.js`](analyze_session.js) | 273 | Session-level analysis: what happened, over how many hands, and whether that is enough hands to mean anything. |
| [`audit_postflop.js`](audit_postflop.js) | 255 | Audits the postflop engine's own outputs against expectations — the tests that keep the drill generator honest. |
| [`server.py`](server.py) | 209 | The small local server behind the logging app. |
| [`phh/build_hands.js`](phh/build_hands.js) · [`phh/backtest.js`](phh/backtest.js) | 201 | Parsing and backtesting against a public hand-history corpus, which is how the parser is tested against real-world formats instead of fixtures I invented. |
