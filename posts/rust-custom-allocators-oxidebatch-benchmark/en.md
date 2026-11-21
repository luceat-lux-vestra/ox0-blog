# Are Custom Rust Allocators Actually Faster?

When Rust server or batch performance comes up, names such as `jemalloc`, `mimalloc`, `snmalloc`, and `tcmalloc` appear quickly.

That makes an intuitive hypothesis tempting:

> If I replace the system allocator with a purpose-built allocator, shouldn't the program get faster and use less memory?

I had the same question for OxideBatch. Rather than changing the default based on reputation, I compared five allocators on the same real PostgreSQL-backed batch workload and looked at elapsed time, peak RSS, restart/quiescence behavior, and same-process retention.

The result was less dramatic than expected.

**No allocator improved both elapsed time and RSS.**

![Allocator speed versus peak RSS trade-off](../../assets/articles/rust-custom-allocators-oxidebatch-benchmark/allocator-tradeoff.svg)

The scatter plot uses simple cursor/paging averages only as a visual summary. The decision itself uses the original reader-specific measurements below.

## The short version

The campaign ended with three practical conclusions.

- **Keep the system allocator as the default.**
- **Use snmalloc as an opt-in performance choice when extra memory is acceptable.**
- **The current evidence does not justify making jemalloc, mimalloc, or tcmalloc the default for this workload.**

That is not the same as saying custom allocators are useless.

The stronger conclusion is that allocator choice was not the dominant bottleneck in this workload, and every alternative bought one property by spending another.

## What I measured

This was not an allocator microbenchmark. The subject was OxideBatch's real PostgreSQL representative workload.

The claim-bearing environment was fixed to:

- OxideBatch: exact published `0.7.0`
- target: `aarch64-unknown-linux-gnu`
- host: OCI ARM64 `VM.Standard.A1.Flex`
- CPU: 4 OCPU
- RAM: 24 GB
- filesystem: ext4
- swap: off
- PostgreSQL: 18 series
- candidates: `system`, `jemalloc`, `mimalloc`, `snmalloc`, `tcmalloc`

The campaign was split into multiple lanes instead of trusting one benchmark number.

![Three benchmark phases](../../assets/articles/rust-custom-allocators-oxidebatch-benchmark/allocator-experiment-phases.svg)

### Phase 4: canonical repeated benchmark

This lane supplied the authoritative timing comparison.

- source rows: 1,000,000
- seed: 20260904
- chunk: 1,000
- cursor fetch: 500
- paging page: 750
- warmups: 2 per reader
- measured repetitions: 7 per reader
- five allocators × two readers
- 70/70 measured manifests passed
- 20/20 warmup correctness checks passed
- 140 retained raw-artifact hashes verified
- outliers were identified but not silently removed

The comparison therefore uses distributions on the same dataset and host rather than a single lucky run.

### Phase 5A: restart / quiescence

Every iteration started a fresh workload process. Ten iterations per allocator retained a post-terminal quiescence interval.

This lane separated process-local allocator state from durable database, metadata, and filesystem state.

### Phase 5B: same-process churn

This was the key follow-up.

For each allocator, one process stayed alive while running the real one-million-row job **20 times**.

Each cycle followed this shape:

`run → verify 1,000,000 projected rows → clean business rows → idle → sample process/native memory`

Cursor and paging alternated 10:10. The point was not benchmark timing; it was to see whether the post-cleanup/post-idle baseline kept climbing while the allocator process stayed alive.

## Phase 4: there was no free lunch

Median elapsed times were:

| allocator | Cursor median | Paging median | Relative to system |
| --- | ---: | ---: | --- |
| system | 16.6972s | 16.6566s | baseline |
| snmalloc | **16.2908s** | **16.2901s** | **2.43% / 2.20% faster** |
| mimalloc | 16.3696s | 16.4029s | 1.96% / 1.52% faster |
| jemalloc | 16.7104s | 16.7673s | 0.08% / 0.67% slower |
| tcmalloc | 16.6922s | 16.8399s | 0.03% faster / 1.10% slower |

On timing alone, snmalloc won.

Peak memory changed the picture.

Median max RSS relative to system:

| allocator | Cursor max RSS | Paging max RSS |
| --- | ---: | ---: |
| system | baseline | baseline |
| snmalloc | **+13.2%** | **+9.2%** |
| jemalloc | +8.4% | +6.2% |
| tcmalloc | +41.3% | +45.4% |
| mimalloc | **+58.5%** | **+62.3%** |

So **none of the custom allocators won on both speed and RSS.**

snmalloc bought roughly two percent less elapsed time with roughly ten percent more peak RSS. mimalloc was somewhat faster but paid a very large memory premium. tcmalloc used much more memory without a consistent timing gain. jemalloc was essentially tied with system on elapsed time while using more memory.

For this workload, the practical Pareto frontier was basically system versus snmalloc.

## Was the allocation/free pressure strong enough?

A reasonable challenge to Phase 4 is:

> Maybe the workload simply did not allocate and free enough objects to expose allocator differences.

That is why Phase 5B exists.

The same-process lane ran the actual one-million-row job twenty times without restarting the allocator process. Real workload allocations from strings, transformed rows, projection/bind data, and repeated source-digest work remained in the path.

After each cycle the business projection was cleaned, the process idled for one second, and process memory plus allocator-native telemetry was captured.

![Post-idle PSS after same-process churn](../../assets/articles/rust-custom-allocators-oxidebatch-benchmark/allocator-retention.svg)

Post-idle PSS behaved as follows:

| allocator | first-5 median | last-5 median | median drift | late-10 slope |
| --- | ---: | ---: | ---: | ---: |
| system | 16.56 MiB | 16.58 MiB | +0.02 MiB | +0.001 MiB/cycle |
| snmalloc | 17.79 MiB | 17.92 MiB | +0.12 MiB | +0.003 MiB/cycle |
| jemalloc | 18.76 MiB | 19.84 MiB | +1.08 MiB | +0.143 MiB/cycle |
| tcmalloc | 24.76 MiB | 24.83 MiB | +0.07 MiB | 0.000 MiB/cycle |
| mimalloc | 25.34 MiB | 26.14 MiB | +0.80 MiB | +0.131 MiB/cycle |

snmalloc's native `current_memory_usage` and `peak_memory_usage` showed zero median drift between the first-five and last-five windows.

For this OxideBatch workload, that removes the main suspicion that snmalloc's timing advantage was hiding sustained process-local memory growth.

jemalloc's live allocated bytes were nearly flat, while its OS-visible resident/mapped footprint did not clearly plateau within twenty cycles. That is a reason for caution, not proof of a leak.

mimalloc also had a high absolute footprint and mild late-cycle upward drift. Again, this is not enough to call it a leak.

### This still was not an allocator torture test

The scope matters.

The campaign answered:

**“Which allocator makes sense for this real OxideBatch workload?”**

It did not deliberately construct allocator-specific extremes such as:

- many threads hammering small allocations concurrently
- cross-thread allocate/free patterns
- one hot size class at extremely high operation rates
- randomized object lifetimes designed to maximize fragmentation
- NUMA
- huge-allocation release behavior
- allocator-operation P99/P999 latency

The results therefore do not mean “snmalloc is two percent faster for all Rust programs” or “mimalloc always costs sixty percent more RSS.”

But an allocator torture suite is also not the primary evidence needed to choose OxideBatch's default. A default should be justified by representative workload evidence.

## So why do custom allocators exist?

The result initially felt strange.

If custom allocators are sophisticated, why did none of them simply beat the system allocator everywhere?

The expectation was wrong.

An allocator is not necessarily trying to be a universal drop-in that is simultaneously faster, smaller, less fragmented, more scalable, and lower latency for every allocation pattern.

Allocator policies trade resources against each other. A design can keep more memory in local caches or reservations to reduce contention or allocation latency. Another can optimize a particular object-lifetime or concurrency pattern. Those policies only pay off when the workload actually exercises them.

The more useful question is not:

> Which allocator is better?

It is:

> **Which cost does my workload care about most?**

For this workload, that leads to a straightforward classification.

### system

It had the lowest observed memory footprint and the flattest long-lived baseline.

It was not the fastest, but the gap was small, and it adds no allocator-specific dependency or target policy to the framework default.

That is why it stays the default.

### snmalloc

This was the only clearly useful performance option.

It was more than two percent faster in both cursor and paging runs, and same-process retention stabilized well.

The cost was roughly 9–13% higher peak RSS.

If memory headroom exists and reducing batch duration has real value, that is a legitimate trade.

### jemalloc

For this workload, elapsed time was effectively the same as system.

It used more RSS and showed some remaining OS-visible footprint drift in Phase 5.

“It's a server, so use jemalloc” was not supported by this evidence.

### mimalloc

It gained roughly 1–2% in timing while increasing peak RSS by roughly 58–62%.

That trade did not make sense for this workload.

### tcmalloc

Its same-process idle baseline stabilized, but at a high absolute footprint.

Phase 4 peak RSS increased by more than forty percent and there was no consistent timing gain.

## The more useful finding: the allocator was not the bottleneck

snmalloc produced the best elapsed time, but the improvement remained around two percent.

I would not reverse-engineer an exact “allocator share” of total runtime from that number. The execution path includes PostgreSQL work, row decode/transform, framework orchestration, digest calculation, and much more.

What the experiment does show is that **swapping allocators does not radically change this batch workload.**

That changes the optimization priority. Further allocator tuning is less attractive than profiling the paths that occupy a larger fraction of the job.

## Final decision

For OxideBatch 0.7.0, this workload, and this ARM64 GNU/Linux environment:

**Default**

`system`

**Performance opt-in**

`snmalloc`

**Not justified as defaults by current evidence**

`jemalloc`, `mimalloc`, `tcmalloc`

snmalloc was not rejected because of correctness or a proven leak. Phase 5 actually reduced that concern substantially.

It stayed opt-in because the measured trade was approximately **2.2–2.4% less elapsed time for about 9–13% more peak RSS**, and because one architecture plus one representative workload is too narrow a basis for a global framework default.

## What the experiment was actually good for

The campaign ended without replacing the default allocator.

That can look like a lot of work to conclude “keep using system.”

But before the experiment, several questions remained open:

- Would jemalloc be the obvious server choice?
- Would mimalloc materially improve throughput?
- Would snmalloc's timing gain turn into long-lived memory growth?
- Was keeping the system allocator just the absence of optimization?

Those questions are now closed with evidence instead of intuition.

**A benchmark is not only useful when it justifies an optimization. Removing unnecessary optimizations is also a result.**

In this case, the system allocator survived that test.

---

## Evidence boundary

The measurements in this article are scoped to:

- OxideBatch `0.7.0`
- the `postgres-postgres` representative workload
- OCI ARM64 / `aarch64-unknown-linux-gnu`
- the fixed dataset and execution geometry used by this campaign

Different architectures, libc implementations, allocator versions, thread topologies, and allocation patterns may produce different results.

Public evidence:

- [Allocator campaign #323](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323)
- [Accepted Phase 4 canonical benchmark](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323#issuecomment-7042916850)
- [Accepted Phase 5 retained-evidence audit](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323#issuecomment-7058282776)
- [Final allocator decision](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323#issuecomment-7058948106)

Phase 4 summary SHA-256:

`938032fe04a00a366b3e0f9917398b19f997ac63d643f08ae017da8bd8aa4c20`

Phase 5A summary SHA-256:

`593afa55c1178db1e7d5b0ba041674d50e37ed996c04fbf3ca309cd0656054e0`

Phase 5B summary SHA-256:

`5422a392ba2133afa576883191132079068e97075d830eb79b4854cab41013a7`
