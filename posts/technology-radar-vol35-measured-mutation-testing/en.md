It is easy to read the Thoughtworks Technology Radar as a technology shopping list. Rings such as `Adopt`, `Trial`, `Assess` and `Caution` naturally lead to the question, “What should we introduce from this edition?”

But Thoughtworks' own [Radar FAQ](https://www.thoughtworks.com/radar/faq) explicitly says that even `Adopt` does not mean “use this on every project.” Context still matters. [Technology Radar Vol.35](https://www.thoughtworks.com/radar), released in November 2026, shifts much of its attention toward the engineering around larger, longer-running AI agents: **their environment, access controls, meaningful human oversight, cost and reliability**.

Instead of taking that message at face value, I narrowed it to one measurable question:

> Instead of “doing more review,” can we measure whether our tests actually detect broken behavior?

I ran a small mutation-testing experiment on the public Rust project [OxideBatch](https://github.com/luceat-lux-vestra/oxide-batch).

The short version: with a fixed population of 10 mutants, the original tests caught eight and missed two. Keeping the production source and mutant population unchanged, I added two negative tests. The same corpus then produced 10 caught mutants. The mutation run itself took about 4.6% longer, while the combined clean-test plus mutation interval increased by about 5.0%.

That is not evidence for making mutation testing a mandatory gate on every pull request. The narrower conclusion is more useful: **on a small, deterministic, high-risk policy slice, manually applying an expensive test-sensitivity tool exposed two real gaps.**

## First, a correction: mutation testing is not a Vol.35 Adopt item

There was an attribution I had to correct before writing this article.

Thoughtworks' official [Mutation testing](https://www.thoughtworks.com/radar/techniques/mutation-testing) page is from April 2026 and places the technique in the **`Trial` ring of Technology Radar Vol.34**. Saying that Vol.35 newly moved mutation testing into `Adopt` would be wrong.

The direct Vol.35 connection is elsewhere. [`Human-in-the-loop theater`](https://www.thoughtworks.com/radar/techniques/human-in-the-loop-theater) warns about approval steps where a human cannot realistically evaluate the change being approved. Instead of relying on ceremonial approval, it points to stronger steering mechanisms such as mutation testing, property-based testing, formal models including TLA+ and Quint, and agent-assisted semantic review.

So the framing for this article is not “Vol.35 adopted mutation testing.”

It is:

- Vol.34: mutation testing itself is `Trial`
- Vol.35: stronger verification and steering are preferable to empty approval rituals
- This experiment: take one of those measurable mechanisms and test it on a real public codebase

That distinction matters. Mixing a Radar ring with internal project evidence is an easy way to turn an external opinion into an overstated adoption claim.

## Coverage and test sensitivity answer different questions

The [cargo-mutants documentation](https://mutants.rs/vs-coverage.html) explains the difference between code coverage and mutation testing in a useful way.

Coverage tells you which code was **executed** while tests ran. It does not necessarily tell you whether the tests meaningfully **asserted the behavior** of that code.

Mutation testing takes the opposite approach: deliberately modify source code and see whether the tests fail. If a validation function is mutated to simply return `Ok(())` and the test suite stays green, the relevant behavior may not be strongly asserted.

Of course, `missed mutant = real bug` is not a valid shortcut. The [cargo-mutants result guide](https://mutants.rs/using-results.html) notes that a missed mutant can indicate a test gap, but it can also be effectively equivalent to the original code. Survivors need classification, not just counting.

There is also a cost. Mutation testing repeatedly builds and tests mutated versions of the program. The [cargo-mutants comparison with coverage](https://mutants.rs/vs-coverage.html) explicitly notes that this can be slow on large trees with slow test suites.

So the question in this experiment was not “Can we reach a 100% mutation score?”

It was:

> Do the current tests detect behavior-breaking changes in an important lifecycle policy?

## Experimental scope: keep production source and the mutant population fixed

The target was a small pure-policy slice in OxideBatch's lifecycle logic. The public experiment owner is [oxide-batch #628](https://github.com/luceat-lux-vestra/oxide-batch/issues/628), with DRAFT / DO NOT MERGE [PR #629](https://github.com/luceat-lux-vestra/oxide-batch/pull/629) used as the experiment harness.

For comparability, I fixed:

- production source: commit [`2be0442acc8a010a9e2c31163a86c6d46b16c418`](https://github.com/luceat-lux-vestra/oxide-batch/commit/2be0442acc8a010a9e2c31163a86c6d46b16c418)
- Rust: 1.97.1
- cargo-mutants: 27.1.0
- mutation target: four lifecycle-policy functions
- frozen population: 10 viable mutants
- identical production source in Before and After
- only the test oracle changes in After

The four functions were:

- `is_legal_in_place_transition`
- `validate_transition`
- `validate_restart`
- `validate_expected_version`

Freezing the mutant population matters. If the production source or mutation selection changes between Before and After, a score change becomes harder to attribute to stronger tests rather than a different benchmark.

## Before: eight of 10 caught, two survivors

The initial lifecycle-property oracle had four tests.

The result was:

| Metric | Before |
| --- | ---: |
| Oracle tests | 4 |
| Viable mutants | 10 |
| Caught | 8 |
| Missed | 2 |
| Timeout | 0 |
| Unviable | 0 |
| Mutation score | 80% |

The interesting part was not the 80% number. It was **what survived**.

The first survivor replaced `validate_expected_version` with behavior equivalent to always returning `Ok(())`. In other words, the selected tests did not fail when stale execution-version rejection disappeared.

The second survivor made `validate_restart` always return `Ok(())`. The tests stayed green even when a non-restartable status was allowed to restart.

These were difficult to classify as harmless equivalent mutants: each removed an explicit rejection rule from the lifecycle contract.

At that point, mutation testing had already done something more useful than producing a score. It turned a vague quality question into two concrete ones:

> Do the tests actually enforce stale-version rejection?

> Do they actually enforce restart rejection for non-restartable states?

The answer was no.

## Intervention: add two negative tests, leave production code alone

The next step did not change production logic. I did not change the mutation operators or the frozen 10-mutant population either.

I added two narrow negative tests:

1. restarting with a stale expected version must return `StaleVersion` and leave the existing execution unchanged
2. job and step restart attempts from a non-restartable status must return `NotRestartable`

The experiment then overlaid only the PR-head test file onto the fixed production source and reran the same population.

All six clean lifecycle tests passed. Exact candidate CI [run 42093990320](https://github.com/luceat-lux-vestra/oxide-batch/actions/runs/42093990320) succeeded, and mutation [run 42093990117](https://github.com/luceat-lux-vestra/oxide-batch/actions/runs/42093990117) also completed successfully.

## After: from 8/10 to 10/10

The public [AFTER evidence](https://github.com/luceat-lux-vestra/oxide-batch/issues/628#issuecomment-6667730546) records the comparable result:

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Oracle tests | 4 | 6 | +2 |
| Viable mutants | 10 | 10 | 0 |
| Caught | 8 | 10 | +2 |
| Missed | 2 | 0 | -2 |
| Timeout | 0 | 0 | 0 |
| Unviable | 0 | 0 | 0 |
| Mutation score | 80% | 100% | +20pp |
| Clean oracle wall | 56.21s | 62.28s | +6.07s |
| Mutation wall | 13:41.16 | 14:18.60 | +37.44s |
| Clean + mutation wall | 14:37.37 | 15:20.88 | +43.51s |

Both former survivors became `CaughtMutant`.

The useful change is not simply that the score became 100%. **Two rejection rules that were previously not connected to a failing test signal now are.**

## What this result does and does not establish

The experiment supports a limited set of claims.

It does establish that:

- the selected oracle had two real test-sensitivity gaps in this lifecycle slice
- mutation testing exposed those gaps as concrete code changes
- a test-only intervention closed both while production source and the mutant population remained fixed
- in this bounded run, mutation wall time increased by about 4.6%, and the combined measured interval increased by about 5.0%

It does not establish that:

- “100% mutation score means production-safe”
- the entire OxideBatch test suite is sufficient
- every Rust project should use mutation testing
- mutation testing should be a required check on every pull request
- this experiment proves higher AI productivity or better security
- the roughly 5% measured increase generalizes to other codebases

This was one lifecycle slice and one comparable Before/After pair. It was not a multi-run benchmark, so run-to-run variance is not characterized.

cargo-mutants also has known boundaries. Its [limitations documentation](https://mutants.rs/limitations.html) requires reliable, hermetic tests for meaningful results, notes that the tool can generate unviable mutants because it does not fully understand types, and documents gaps around some conditional-compilation and build configurations.

Treating the 100% number as a quality badge would therefore weaken the interpretation rather than strengthen it.

## My decision: a targeted manual diagnostic, not a PR gate

Based on this result, I would not make mutation testing a default CI gate.

I would use it manually and selectively where several conditions hold:

- semantics are narrow and important, such as policy or state-transition code
- tests are deterministic and hermetic
- survivors are few enough to classify as equivalent or meaningful contract gaps
- Before and After can be compared against a stable source and mutation population
- several minutes of additional work outside the pull-request critical path is justified by the risk

I would not use the result as a replacement for ordinary scenario, property, conformance or failure testing, nor as a reason to optimize for “100% mutation score.” Those tests remain the primary behavioral evidence. Mutation testing is better treated here as **a pressure test for whether that evidence is actually sensitive to plausible code changes**.

That is also consistent with Thoughtworks' ring model. `Trial` means trying a practice in an appropriate project and deciding whether it belongs in your own toolkit; it is not a universal mandate. Vol.35's criticism of empty human approval similarly points toward checks that produce meaningful steering signals instead of additional ceremony.

## The useful response to a Radar is not copying its list

The most reusable part of this experiment was not the final mutation score. It was the method.

When a Radar surfaces an interesting practice, a project can narrow it into an experiment:

1. choose one real gap in the current system
2. freeze the Before state first
3. make the smallest attributable intervention without changing production behavior if possible
4. measure After against the same comparator
5. record costs and the boundaries where the result should not be generalized

That worked well in this mutation-testing pilot. Two missed mutants led to two concrete negative tests, while the same experiment also made the 14-minute mutation-run cost visible.

So the conclusion is narrower than “we adopted mutation testing.”

> When I have a reason to doubt the sensitivity of tests around important policy logic, mutation testing is worth pulling out as a targeted manual tool. One 10-mutant experiment is not enough reason to turn it into CI policy.

The Radar was more useful as a source of testable questions than as a list of answers.
