After using GitHub Actions for long enough, the phrase “CI is slow” starts to feel too vague to be useful.

A workflow taking ten minutes can hide very different problems. Compilation may be slow. One job may dominate the critical path. More parallel jobs may reduce developer wait time while increasing total runner work. A step can become 30% faster without changing merge-ready latency at all because another required job still finishes later.

I recently went through this across several public open-source repositories and tried to reduce the discussion to measured quantities.

The initial list looked familiar:

- move work from x86_64 to ARM64 runners;
- improve Rust compiler caching;
- tune Gradle caches;
- simplify workflow and validation DAGs;
- shard integration tests;
- remove duplicated builds;
- try a faster linker.

The results did not collapse into simple rules such as “this technique is faster.”

Some changes made individual jobs much faster but barely moved merge-ready latency. More parallelism reduced wall time while increasing aggregate runner work. Cutting runner count reduced total work, but made developers wait longer again.

The most interesting case was an optimization that had already been rejected on performance grounds, then became worthwhile after the CI topology changed.

This article is less a list of GitHub Actions tips and more a record of the **measurement model and decision process** behind those experiments.

## “CI time” is not one number

I ended up separating CI performance into at least three measurements.

### 1. Wall-clock latency

How long do you actually wait from the start of a pull request until the required validation is complete and the next action is possible?

This is the most direct metric for developer feedback speed.

### 2. Critical path

Jobs may run in parallel, but one path still determines when the whole validation surface is ready.

If Build takes four minutes, Test six, and CodeQL nine, cutting Build to two minutes does almost nothing to overall completion time while CodeQL remains at nine.

So “this job became X% faster” and “CI became X% faster” are not equivalent claims.

### 3. Aggregate runner work

This is the sum of execution time across parallel jobs.

If four GitHub-hosted jobs each run for two minutes, the developer may experience something close to two minutes of wall time while roughly eight runner-minutes of execution work occurred.

I do not treat this number as a billing claim. Public workflow durations are not sufficient evidence for exact billed runner minutes. Here it is only a measure of **how much execution work the topology creates**.

There is also a fourth axis.

### 4. Validation scope

Before calling a result faster, I need to know whether it still validates the same thing.

A result made faster by reducing or rescheduling validation scope is different from a result that preserves validation and executes it more efficiently.

Without that distinction, performance, cost, and security-policy changes get collapsed into one “CI optimization” number.

## Four-way sharding was fast, but it was not free

The Rust batch framework [oxide-batch](https://github.com/luceat-lux-vestra/oxide-batch) runs its integration tests across four ARM64 runners.

The problem was that compiler caching and other CI structure had changed several times, while the justification for four shards was based on older topology.

So [public measurement issue #626](https://github.com/luceat-lux-vestra/oxide-batch/issues/626) compared the current four-way execution against running the same test inventory on one runner under the same source SHA, target inventory, toolchain, and cache policy.

Across four valid crossover pairs, four-way sharding reduced critical integration wall time by **56.73–62.48%**, with a **61.21% median**.

For developer wait time, that is a very large win.

But aggregate integration work moved in the opposite direction: **24.94–51.37% higher**, with a **41.45% median**.

The result can be summarized like this:

| Goal | Four-way sharding |
| --- | --- |
| Critical latency | much lower |
| Aggregate work | much higher |
| Test denominator | unchanged |
| Decision | pay more work for lower latency |

That naturally led to the next question:

> Can we keep the parallel latency while removing duplicated compiler and setup work?

[Follow-up issue #627](https://github.com/luceat-lux-vestra/oxide-batch/issues/627) explored compile-once transfer, parallel execution inside one runner, and reducing shard count.

The three-lane comparison did reduce aggregate work. But in a 2× A→C + 2× C→A crossover, three-way execution versus the four-way baseline produced:

- core critical latency: **+18.89% median**;
- summed core execution: **-10.94% median**;
- full lane-job critical latency: **+16.61% median**;
- summed lane-job elapsed: **-12.41% median**.

The topology did roughly 11–12% less work, but developers waited roughly 17–19% longer.

Production therefore kept the **four-way topology**.

That does not mean four independent runners are absolutely efficient. The duplicated compiler/setup work still exists. It means the simple consolidation mechanisms tested so far reduced that duplication at too high a latency cost.

It was the clearest example of why “do less total work” and “make developers wait less” are different optimization goals.

## Re-measuring a linker that had already been rejected

The more dramatic example was the Rust linker.

In October 2026, I compared [mold](https://github.com/rui314/mold) with the default GNU linker in oxide-batch and Arkst.

In oxide-batch, the original x86_64 experiment produced only about a **+0.09% paired-mean difference** for the cold build. It was effectively noise. The public record is in [oxide-batch #405](https://github.com/luceat-lux-vestra/oxide-batch/issues/405).

Arkst's x86_64 experiment was similar. The cold paired mean had mold about **1.38% slower**, recorded in [Arkst #524](https://github.com/luceat-lux-vestra/arkst/issues/524).

Both decisions were REJECT.

The important conclusion was not “mold is slow.”

Those workloads were compile-dominated. Changing the linker did not produce a repeatable end-to-end build/test win.

Then the CI topology changed.

A significant part of Linux execution moved to ARM64 runners. Protected main began producing sccache compiler caches, and pull requests consumed those caches read-only.

In Arkst's production-like ARM64 profile, a 386 Rust hits / 0 misses compiler-cache state left system-linker occupancy at **81.27%** of the full workspace + Typst phase.

Once most compilation work disappeared into the cache, linking became a much larger share of the remaining active work.

So I measured the same question again.

In a balanced four-runner comparison under Arkst ARM64 + warm compiler cache:

| Linker | Mean |
| --- | ---: |
| system | 175.514s |
| mold | 116.546s |

mold was **58.968 seconds, or 33.60%, faster**, with the same direction in all four observations.

That led to the narrow Ubuntu ARM64 production adoption in [Arkst PR #760](https://github.com/luceat-lux-vestra/arkst/pull/760).

But it would be wrong to write that “Arkst CI became 33.6% faster.”

In the recent PR sample used during the decision, Ubuntu ARM64 was the last platform-test predecessor in only one of six runs. When macOS or Windows finishes later, removing a minute from Ubuntu does not remove a minute from the Merge Gate.

The accurate claim is an **Ubuntu ARM64 job-local improvement**.

oxide-batch showed the same topology effect at a smaller magnitude.

Under ARM64 + steady-state sccache, the system mean was **56.331 seconds** and mold **52.207 seconds**, a **7.32%** reduction with mold faster in all four pairs. [PR #636](https://github.com/luceat-lux-vestra/oxide-batch/pull/636) adopted it for the ARM64 compiler-cache consumer path.

Then I checked one more possibility: if warm compiler caching was the key change, perhaps current x86_64 would benefit now too.

The current x86_64 + warm sccache re-evaluation produced:

| Linker | Mean |
| --- | ---: |
| system | 64.283s |
| mold | 64.266s |

The difference was roughly **18 ms, or 0.028%**. mold was faster in only one of four pairs.

x86_64 remained a REJECT.

The same repository family, similar Rust tooling, and the same mold 3.0.0 produced a worthwhile ARM64 result and a neutral x86_64 result.

So I no longer record the conclusion as “mold is fast.”

The more useful rule is:

> A performance verdict is not a permanent label on a tool. It is a decision about runner architecture, cache hit rate, workload, and the current topology.

A previous NO-GO can deserve a new measurement when the bottleneck structure changes.

And a strong win in one environment is not evidence to roll the same optimization out everywhere.

## Did the benchmark result survive real pull-request traffic?

This no longer needs to remain a future question.

After the mold adoption and compiler-cache publication path were stabilized in oxide-batch, several real development pull requests went through the production workflow.

I re-read the quality-fast jobs for [PR #642](https://github.com/luceat-lux-vestra/oxide-batch/pull/642), [#649](https://github.com/luceat-lux-vestra/oxide-batch/pull/649), [#651](https://github.com/luceat-lux-vestra/oxide-batch/pull/651), and [#652](https://github.com/luceat-lux-vestra/oxide-batch/pull/652).

| PR | quality-fast job wall | Rust cache hit / miss |
| --- | ---: | ---: |
| #642 | 76s | 443 / 2 |
| #649 | 77s | 443 / 2 |
| #651 | 78s | 445 / 0 |
| #652 | 72s | 444 / 1 |

All four runs actually selected mold 3.0.0 on ARM64, restored a protected-main-compatible sccache, and completed successfully.

So the configuration that had shown about a 7% controlled improvement did not immediately collapse once it entered the production workflow. Across different real source changes, the compiler cache remained almost entirely reusable and quality-fast stayed in a **72–78 second** range.

That still does not justify a new causal percentage.

These pull requests do not have same-PR controls without mold. I cannot use them to claim that production became another 7.32% faster.

What they do establish is operational:

- the adopted ARM64 + mold topology keeps executing in normal pull-request workflows;
- real development changes continue to consume the protected-main compiler cache at a very high hit rate;
- the result is not limited to the synthetic benchmark that justified adoption;
- one or two new Rust misses do not collapse the overall cache topology.

Arkst is different.

There have been pull requests after [PR #760](https://github.com/luceat-lux-vestra/arkst/pull/760), including #761 through #764, but they have mostly been Quarkdown clean-room probes. Their general Ubuntu ARM64 test jobs took the path/scope fast path and finished as short placeholders rather than executing the Rust-heavy workload that mold was adopted for.

The pull-request count increased, but the number of **natural production samples that actually exercise the optimized Rust path did not**.

That distinction matters:

> Do not count pull requests. Count executions of the path you optimized.

I therefore record the production evidence at two different strengths:

- **oxide-batch ARM64 + mold:** controlled A/B plus real post-adoption producer/consumer operation and subsequent development traffic.
- **Arkst ARM64 + mold:** controlled evidence and production adoption are proven, but natural Rust-heavy post-adoption traffic is still sparse.

Deploying a performance change does not finish its validation. But neither does the mere passage of time create operational evidence.

Keeping controlled experiments separate from production observations is what lets “the benchmark was faster” and “the topology survived real development” remain two different claims.
