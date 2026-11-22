# Rust에서 커스텀 Allocator는 정말 더 빠를까?

Rust 서버나 배치 프로그램의 성능을 이야기하다 보면 `jemalloc`, `mimalloc`, `snmalloc`, `tcmalloc` 같은 커스텀 allocator 이름이 자주 나온다.

그래서 자연스럽게 이런 기대가 생긴다.

> 기본 allocator 대신 잘 만든 커스텀 allocator를 쓰면 더 빠르고, 메모리도 덜 쓰지 않을까?

OxideBatch에서도 같은 질문이 생겼다. 추측으로 기본값을 바꾸고 싶지는 않았다. 실제 batch workload에서 다섯 allocator를 같은 조건으로 돌리고, 실행 시간뿐 아니라 peak RSS와 장기 retention까지 확인했다.

결과는 기대보다 훨씬 덜 극적이었다.

**속도와 RSS를 동시에 개선한 allocator는 하나도 없었다.**

![Allocator speed versus peak RSS trade-off](../../assets/articles/rust-custom-allocators-oxidebatch-benchmark/allocator-tradeoff.svg)

시각화의 좌표는 cursor/paging 상대값의 단순 평균으로 만든 요약값이다. 의사결정의 원본 수치는 아래 표처럼 reader별 결과를 따로 본다.

## 먼저 결론

이번 실험의 결론은 세 줄로 줄일 수 있다.

- **기본값은 system allocator를 유지한다.**
- **snmalloc은 메모리 여유가 있을 때 사용할 수 있는 성능 opt-in이다.**
- **jemalloc, mimalloc, tcmalloc은 이 workload에서는 기본값으로 바꿀 근거가 없었다.**

중요한 점은 “커스텀 allocator가 쓸모없다”가 아니다.

이번 workload에서 allocator 자체가 전체 성능을 지배하는 병목이 아니었고, allocator를 바꾸면 서로 다른 비용을 지불하게 된다는 것이 결과에 더 가깝다.

## 무엇을 측정했나

대상은 allocator microbenchmark가 아니라 OxideBatch의 실제 PostgreSQL 기반 대표 workload였다.

Claim-bearing 환경은 다음과 같다.

- OxideBatch: 정확히 공개된 `0.7.0`
- target: `aarch64-unknown-linux-gnu`
- host: OCI ARM64 `VM.Standard.A1.Flex`
- CPU: 4 OCPU
- RAM: 24 GB
- filesystem: ext4
- swap: off
- PostgreSQL: 18 계열
- 후보: `system`, `jemalloc`, `mimalloc`, `snmalloc`, `tcmalloc`

실험은 한 번의 숫자로 끝내지 않았다.

![Three benchmark phases](../../assets/articles/rust-custom-allocators-oxidebatch-benchmark/allocator-experiment-phases.svg)

### Phase 4: canonical repeated benchmark

성능 비교의 기준이 되는 lane이다.

- source rows: 1,000,000
- seed: 20260904
- chunk: 1,000
- cursor fetch: 500
- paging page: 750
- warmup: reader별 2회
- measured: reader별 7회
- allocator 5종 × reader 2종
- measured manifest 70/70 PASS
- warmup correctness 20/20 PASS
- raw artifact hash 140개 검증
- outlier는 표시하되 삭제하지 않음

즉 “한 번 돌렸더니 빨랐다”가 아니라 같은 데이터와 같은 host에서 분포를 비교했다.

### Phase 5A: restart / quiescence

각 iteration마다 workload process를 새로 시작해 process-local allocator 상태를 끊었다.

allocator별 10 iteration을 실행하고 terminal success 이후 quiescence interval도 유지했다. 이를 통해 프로세스 종료 이후에도 남는 DB/metadata/filesystem 상태와 process-local allocator 상태를 구분했다.

### Phase 5B: same-process churn

가장 궁금했던 부분이다.

프로세스를 죽이지 않고 allocator별로 하나의 PID를 유지한 채 실제 100만-row job을 **20 cycle** 반복했다.

각 cycle은 다음과 같은 흐름을 가진다.

`run → projection 1,000,000 rows 확인 → business rows cleanup → idle → memory/native snapshot`

cursor와 paging은 10:10으로 번갈아 수행했다. 이 lane의 목적은 benchmark timing이 아니라 같은 process에서 allocation/free가 반복될 때 idle baseline이 계속 올라가는지를 보는 것이다.

## Phase 4 결과: 무료 점심은 없었다

실행 시간 median은 다음과 같았다.

| allocator | Cursor median | Paging median | system 대비 |
| --- | ---: | ---: | --- |
| system | 16.6972s | 16.6566s | baseline |
| snmalloc | **16.2908s** | **16.2901s** | **2.43% / 2.20% faster** |
| mimalloc | 16.3696s | 16.4029s | 1.96% / 1.52% faster |
| jemalloc | 16.7104s | 16.7673s | 0.08% / 0.67% slower |
| tcmalloc | 16.6922s | 16.8399s | 0.03% faster / 1.10% slower |

속도만 보면 snmalloc이 가장 좋다.

문제는 메모리다.

Median max RSS를 system과 비교하면:

| allocator | Cursor max RSS | Paging max RSS |
| --- | ---: | ---: |
| system | baseline | baseline |
| snmalloc | **+13.2%** | **+9.2%** |
| jemalloc | +8.4% | +6.2% |
| tcmalloc | +41.3% | +45.4% |
| mimalloc | **+58.5%** | **+62.3%** |

결과적으로 **속도와 RSS를 동시에 이긴 allocator는 없었다.**

snmalloc은 약 2%대의 시간을 줄이는 대신 peak RSS를 대략 10% 더 쓴다. mimalloc은 약간 빨라지지만 메모리 증가가 너무 컸다. tcmalloc은 메모리를 크게 더 쓰면서 시간 이득도 거의 없었다. jemalloc은 system과 실행 시간이 거의 같았지만 RSS는 더 컸다.

이번 workload에서 Pareto frontier에 남는 선택지는 사실상 system과 snmalloc 두 개였다.

## “할당/해제가 충분히 빡셌나?”

Phase 4 숫자만 보면 이런 의문이 남는다.

> 실제로 allocation/free를 충분히 많이 하지 않아서 allocator 차이가 안 난 것 아닐까?

이 질문 때문에 Phase 5B를 추가했다.

same-process lane에서는 실제 100만-row job을 한 process에서 20번 반복했다. row 처리 과정의 `String`, 변환 결과, projector clone, bind vector, source digest 계산 등 실제 workload 경로의 allocation/free가 그대로 반복된다.

그리고 매 cycle마다 business projection을 지운 뒤 1초 idle을 두고 PSS/RSS와 allocator-native telemetry를 기록했다.

![Post-idle PSS after same-process churn](../../assets/articles/rust-custom-allocators-oxidebatch-benchmark/allocator-retention.svg)

20 cycle 이후의 post-idle PSS는 다음과 같다.

| allocator | first-5 median | last-5 median | median drift | late-10 slope |
| --- | ---: | ---: | ---: | ---: |
| system | 16.56 MiB | 16.58 MiB | +0.02 MiB | +0.001 MiB/cycle |
| snmalloc | 17.79 MiB | 17.92 MiB | +0.12 MiB | +0.003 MiB/cycle |
| jemalloc | 18.76 MiB | 19.84 MiB | +1.08 MiB | +0.143 MiB/cycle |
| tcmalloc | 24.76 MiB | 24.83 MiB | +0.07 MiB | 0.000 MiB/cycle |
| mimalloc | 25.34 MiB | 26.14 MiB | +0.80 MiB | +0.131 MiB/cycle |

snmalloc의 native `current_memory_usage`와 `peak_memory_usage`는 first-5와 last-5 median 사이에서 drift가 0이었다.

따라서 적어도 **이 실제 OxideBatch workload에서 snmalloc의 성능 이득이 장기적인 process-local memory growth를 숨긴 결과는 아니었다.**

jemalloc은 live allocated bytes 자체는 거의 평평했지만 OS-visible resident/mapped footprint가 20 cycle 안에서 명확하게 plateau했다고 보기 어려웠다. 이것만으로 leak이라고 부를 수는 없다.

mimalloc도 절대 footprint가 높고 후반부에 약한 상승 경향이 있었지만, 이 결과 역시 leak 판정은 아니다.

### 그래도 allocator torture test는 아니다

여기서 경계를 분명히 해야 한다.

이 실험은 **“OxideBatch의 실제 workload에서 어떤 allocator가 맞는가?”**를 검증한 것이다.

다음과 같은 allocator 전용 극단 상황을 일부러 만들지는 않았다.

- 매우 많은 thread가 동시에 작은 객체를 malloc/free
- cross-thread allocation/free
- 특정 size class에 집중되는 초고빈도 churn
- random lifetime으로 fragmentation을 극대화하는 패턴
- NUMA
- huge allocation / aggressive release
- allocator operation 자체의 P99/P999 latency

따라서 “snmalloc이 모든 Rust 프로그램에서 2% 빠르다”거나 “mimalloc은 항상 RSS를 60% 더 쓴다”는 결론은 이 데이터로 말할 수 없다.

반대로 OxideBatch의 default allocator를 결정하는 데 allocator torture test가 더 중요한 것도 아니다. 기본값은 실제 representative workload에서 판단해야 한다.

## 왜 우리는 “커스텀 allocator가 당연히 더 좋다”고 생각하게 됐을까?

나 역시 처음에는 커스텀 allocator가 어떻게든 더 좋을 것이라고 예상했다. 특히 게임 업계에서 일할 때 엔진이나 런타임에 별도 allocator를 넣는 일을 실제로 접한 경험이 있다면 그런 기대는 더 자연스럽다.

그 인식에는 역사적인 이유가 있다.

2011년 Facebook은 jemalloc을 설명하면서 당시 대규모 서버 workload에서 **동시 allocation/deallocation 처리량**, **fragmentation의 예측 가능성**, **heap profiling**을 핵심 문제로 꼽았다. 당시에는 범용 system allocator가 대규모 멀티코어 서버의 allocation pattern을 충분히 잘 처리하지 못하는 경우가 실제 운영 문제였다.

- [Meta/Facebook: Scalable memory allocation using jemalloc (2011)](https://engineering.fb.com/2011/01/03/core-infra/scalable-memory-allocation-using-jemalloc/)

Rust도 한동안 일부 주요 플랫폼에서 jemalloc을 기본 allocator로 사용했다. 이유는 단순했다. system allocator보다 **자주 더 빨랐기 때문**이다.

그런데 Rust 1.32에서 기본값은 다시 system allocator로 돌아갔다. Rust 팀이 남긴 이유가 흥미롭다. jemalloc이 “대체로 빠르지만 항상 그런 것은 아니었고”, binary size와 플랫폼 호환성, 유지보수 비용도 있었다.

- [Rust 1.32: jemalloc is removed by default (2019)](https://blog.rust-lang.org/2019/01/17/Rust-1.32.0/)

이 사례만 봐도 allocator 선택에 보편적인 정답이 없다는 것을 알 수 있다.

그리고 **system allocator도 가만히 있지 않았다.**

glibc는 2.26에서 malloc에 per-thread cache(tcache)를 추가했다. 작은 allocation/free의 fast path는 lock 없이 처리되고, glibc가 당시 공개한 변경 설명도 여러 실제 workload에서 성능 개선이 있었다고 명시한다.

- [glibc 2.26: Add per-thread cache to malloc (2017)](https://sourceware.org/pipermail/glibc-cvs/2017q3/062648.html)
- [Current glibc malloc tunables](https://sourceware.org/glibc/manual/latest/html_node/Memory-Allocation-Tunables.html)

즉 **2026년의 glibc malloc을 2000년대나 2010년대 초반의 “느린 system malloc” 이미지로 평가하면 안 된다.**

이번 실험의 system baseline은 아무 기능도 없는 순진한 allocator가 아니다. arena, per-thread cache, fast bins, mmap/trim 정책 등 수십 년 동안 개선된 범용 allocator다.

## 게임 업계에서 말하는 “custom allocator”는 같은 물건이 아닐 수 있다

여기가 이번 결과와 과거 게임 개발 경험을 연결하는 가장 중요한 지점이다.

“커스텀 allocator”라는 표현 아래에는 사실 서로 다른 두 부류가 섞여 있다.

![Two different meanings of custom allocator](../../assets/articles/rust-custom-allocators-oxidebatch-benchmark/allocator-two-worlds.svg)

### 1. 범용 allocator의 교체

이번 OxideBatch 실험이 비교한 것이 이쪽이다.

- system/glibc malloc
- jemalloc
- mimalloc
- snmalloc
- tcmalloc

이들은 다양한 크기와 수명의 allocation을 받아야 하는 **general-purpose allocator**다. 프로그램 전체의 malloc/free 역할을 대체할 수 있어야 하므로 특정 workload에만 맞춘 강한 가정을 하기 어렵다.

TCMalloc은 per-CPU/per-thread cache로 contention을 줄이고, snmalloc은 특히 cross-thread free와 batched deallocation을 메시지 패싱으로 처리하는 데 초점을 둔다. mimalloc 역시 자신을 범용 allocator라고 정의하면서, 모든 allocator에 불리한 workload를 만들 수 있기 때문에 “하나의 최적 알고리즘은 없다”고 명시한다.

- [Google TCMalloc design](https://google.github.io/tcmalloc/design.html)
- [Microsoft snmalloc](https://github.com/microsoft/snmalloc)
- [Microsoft mimalloc](https://github.com/microsoft/mimalloc)
- [jemalloc](https://jemalloc.net/)

### 2. workload를 아는 전용 allocator

게임 엔진에서 자주 쓰는 allocator는 오히려 이쪽이다.

예를 들어 Unity의 현재 네이티브 메모리 시스템은 “가장 좋은 allocator 하나”를 고르지 않는다. allocation의 **수명과 용도**에 따라 여러 allocator를 나눈다.

- persistent allocation: dynamic heap / bucket
- small allocation: fixed-size lock-free bucket
- temporary allocation: TLS stack
- job 간 임시 데이터: threadsafe linear allocator

Unity 문서 자체가 메모리 여유가 많으면 더 빠르고 메모리를 많이 쓰는 allocator를, 메모리가 제한되면 느리더라도 더 효율적인 allocator를 선택할 수 있다고 설명한다.

- [Unity Native Allocators](https://docs.unity3d.com/Manual/performance-native-allocators.html)

Unreal Engine에도 `FMallocBinned2` 같은 “optimized virtual memory allocator”가 있고, EA의 EASTL은 처음부터 게임 개발에 필요한 allocator 제어를 중요한 설계 차이로 삼았다. EASTL의 fixed-size container는 고정된 pool을 이용해 빠른 allocation과 fragmentation 회피를 노린다.

- [Unreal Engine FMallocBinned2](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Core/FMallocBinned2)
- [EASTL Design](https://github.com/electronicarts/EASTL/blob/master/doc/Design.md)

CryEngine은 `new/delete`를 자체 heap allocator로 전역 매핑하고, module별 memory budget tracking까지 allocator 체계와 연결한다.

- [CRYENGINE C++ Coding Standard — Memory allocation](https://www.cryengine.com/docs/static/engines/cryengine-5/categories/23756813/pages/25530454)

이런 구조의 목적은 단순한 malloc benchmark 승리가 아니다.

- frame 안에서 끝나는 temporary allocation을 한 번에 날리기
- 동일 크기 object를 pool에 모아 fragmentation 줄이기
- level/scene lifetime에 맞춰 arena 전체를 reset하기
- subsystem별 memory budget 추적하기
- console의 고정된 memory budget 안에서 최악 상황을 예측하기
- frame-time에 갑작스러운 general heap slow path가 들어오는 것을 피하기

Molecule Engine의 오래된 allocator 글들도 linear/LIFO allocator를 level loading 같은 명확한 lifetime에 적용한다. 일반 heap보다 할 수 있는 일이 적은 대신, **그 제한 자체가 성능과 단순성의 원천**이다.

- [Molecular Musings: linear allocator](https://blog.molecular-matters.com/2012/08/14/memory-allocation-strategies-a-linear-allocator/)
- [Molecular Musings: growing LIFO allocator](https://blog.molecular-matters.com/2013/01/29/memory-allocation-strategies-a-growing-stack-like-lifo-allocator/)

실제 게임에서 fragmentation이 기능 장애로 이어진 사례도 있다. Insomniac은 장시간 플레이 후 heap fragmentation 때문에 전체 화면 동영상에 필요한 큰 연속 block을 안정적으로 잡지 못했던 문제를 공개한 적이 있다. 이 문제의 핵심은 “malloc 한 번이 몇 ns 빠른가”가 아니라 **필요한 순간에 필요한 크기의 메모리를 반드시 확보할 수 있는가**였다.

- [Game Developer: The Dalton Allocator — Insomniac Games](https://www.gamedeveloper.com/programming/dirty-game-development-tricks)

Naughty Dog의 The Last of Us Remastered GDC 세션 역시 60 FPS 엔진 재설계에서 job system, lock contention과 함께 memory allocation pattern을 명시적으로 다뤘다.

- [GDC: Parallelizing the Naughty Dog Engine Using Fibers](https://www.gdcvault.com/play/1022186/)

따라서 과거 게임 업계에서 “커스텀 allocator를 도입해서 효과를 봤다”는 경험과 이번 결과는 전혀 충돌하지 않는다.

**게임 엔진은 workload의 lifetime과 구조를 알고 있기 때문에 general-purpose allocator가 가질 수 없는 정보를 이용할 수 있다.**

stack/linear allocator가 LIFO 또는 bulk reset이라는 제약을 받아들이면 일반 malloc보다 훨씬 단순하고 빠를 수 있는 것은 당연하다. 대신 아무 allocation이나 arbitrary order로 free할 수 있는 범용성은 포기한다.

## 커뮤니티 경험이 서로 정반대로 보이는 이유

allocator 관련 커뮤니티 글을 읽으면 혼란이 더 커진다.

어떤 사람은 allocator만 바꿨더니 OOM이 사라지고 CPU 사용량까지 크게 줄었다고 한다. 2026년 r/rust에도 glibc를 쓰던 장기 실행 서비스가 fragmentation 문제를 겪다가 jemalloc/mimalloc로 바꾸면서 안정화됐다는 사례가 올라왔다.

- [r/rust: Allocator has a high impact on your Rust programs](https://www.reddit.com/r/rust/comments/1riwbqv/perf_allocator_has_a_high_impact_on_your_rust/)

반대로 2019년 mimalloc 공개 당시 ClickHouse 개발자가 자신의 common workload에서는 mimalloc이 jemalloc보다 두 배 느렸다고 보고한 사례도 있다. 이후 allocator 개발자와 함께 개선하면서 격차가 크게 줄었다.

- [Hacker News: Mimalloc — ClickHouse workload discussion](https://news.ycombinator.com/item?id=20249743)

둘 중 하나가 거짓이라서가 아니다.

allocator 성능은 특히 다음 조건에 민감하다.

- single-thread vs many-thread
- allocate한 thread와 free하는 thread가 같은지
- object size distribution
- object lifetime distribution
- burst allocation/free 여부
- thread 수와 CPU 수
- huge page / page size / NUMA
- 얼마나 자주 OS에 memory를 돌려줘야 하는지
- peak RSS와 throughput 중 무엇을 더 중요하게 보는지

그래서 mimalloc 프로젝트도 자신의 benchmark 결과를 설명하면서 **general-purpose allocator에는 모든 workload에서 최적인 알고리즘이 없고, synthetic benchmark가 실제 workload와 다를 수 있으니 결과를 주의해서 해석해야 한다**고 적고 있다.

TCMalloc의 튜닝 문서도 같은 trade-off를 노골적으로 보여준다. cache를 크게 하면 central cache 접근이 줄어 성능에는 유리하지만, 그만큼 더 많은 memory를 cache할 수 있다.

이것은 이번 OxideBatch 결과와 거의 같은 이야기다.

`snmalloc`은 메모리를 더 써서 약간 더 빨랐고, `system`은 가장 적은 메모리로 충분히 좋은 성능을 냈다.

## 이번 조사로 정리한 오해와 사실

| 흔한 인식 | 실제로는 |
| --- | --- |
| 커스텀 allocator는 system allocator보다 더 빠르다 | **workload에 따라 다르다.** Rust조차 jemalloc을 기본에서 제거했다. |
| 커스텀 allocator는 메모리도 덜 쓴다 | 빠른 cache/reservation 정책은 오히려 RSS를 늘릴 수 있다. |
| system malloc은 오래되고 단순해서 느리다 | 현대 glibc에도 arena, tcache, fast path, mmap/trim 정책이 있다. |
| 게임 엔진이 custom allocator를 쓰니 global allocator 교체도 항상 좋다 | 게임에서는 pool/linear/stack처럼 **lifetime을 아는 전용 allocator**가 핵심인 경우가 많다. |
| RSS가 free 후 바로 안 줄면 leak이다 | allocator cache, fragmentation, dirty/resident page, purge 정책 때문에 그렇지 않을 수 있다. |
| allocator microbenchmark 1등이 실제 앱에서도 1등이다 | 실제 size/lifetime/thread pattern이 다르면 순위가 쉽게 바뀐다. |
| specialized allocator는 이제 의미 없다 | 오히려 lifetime/size를 강하게 제한할 수 있을 때는 general-purpose allocator보다 훨씬 유리할 수 있다. |
| global allocator swap은 의미 없는 튜닝이다 | fragmentation이나 contention이 실제 병목이면 매우 큰 개선이 나올 수 있다. 단, **측정 후 결정해야 한다.** |

이 표가 결국 이번 실험의 해석 기준이다.

OxideBatch에서 system allocator가 이긴 것은 “커스텀 allocator 기술이 쓸모없어졌다”는 뜻이 아니다.

**이 workload에서는 general-purpose allocator를 교체하는 것보다, system allocator가 이미 충분히 잘하고 있었다는 뜻이다.**

또한 이번 workload는 4 OCPU ARM64 batch + PostgreSQL 경로다. snmalloc이 특별히 강점을 두는 cross-thread free나 수천 건의 remote deallocation batch, TCMalloc이 겨냥하는 큰 멀티코어 contention을 얼마나 강하게 발생시켰는지는 별도로 계측하지 않았다.

따라서 여기서 한 단계 더 나가는 정확한 표현은 다음이다.

> 이번 benchmark는 allocator들이 잘하는 극단적 상황을 찾는 실험이 아니라, OxideBatch가 실제로 그런 allocator를 필요로 하는지 확인한 실험이었다.

그리고 답은 “기본값을 바꿀 정도로는 아니다”였다.


## 그럼 커스텀 allocator를 왜 쓰나?

이번 결과를 보고 가장 먼저 든 생각은 이것이었다.

> 이 정도면 커스텀 allocator를 만드는 이유가 대체 뭐지?

문제는 기대 모델에 있었다.

커스텀 allocator를 “system allocator보다 모든 면에서 좋은 대체품”으로 생각하면 이번 결과는 이상하다.

하지만 allocator는 보통 여러 비용 사이에서 trade-off를 선택한다.

allocation throughput을 높이기 위해 thread-local cache나 reservation을 공격적으로 가져갈 수 있고, contention을 줄이는 대신 메모리를 더 보유할 수 있다. fragmentation 관리나 특정 allocation pattern을 위해 다른 정책을 선택할 수도 있다.

즉 현실의 질문은 대개 다음에 더 가깝다.

> 어느 allocator가 더 좋은가?

가 아니라

> **내 workload가 어떤 비용을 더 중요하게 보는가?**

이번 workload에서는 그 답이 꽤 명확했다.

### system

가장 낮은 메모리 footprint와 가장 평평한 장기 baseline을 보였다.

실행 시간이 최상은 아니지만 차이가 크지 않았고, 별도 allocator dependency나 target별 정책을 기본값에 추가할 이유도 없다.

그래서 default로 유지했다.

### snmalloc

이번 실험에서 유일하게 분명한 performance option이었다.

cursor와 paging 양쪽 모두 약 2% 이상 빨랐고 same-process retention도 안정적이었다.

대신 peak RSS를 약 9~13% 더 쓴다.

따라서 메모리에 여유가 있고 job 처리시간을 조금이라도 줄이는 것이 가치가 있는 환경이라면 opt-in 선택으로 충분히 의미가 있다.

### jemalloc

이번 workload에서는 system과 시간 차이가 사실상 없었다.

RSS는 더 높았고 Phase 5에서는 OS-visible footprint가 약간 상승하는 모습도 남았다.

“서버니까 jemalloc”이라는 이유만으로 선택할 근거는 없었다.

### mimalloc

시간은 1~2% 정도 좋아졌지만 peak RSS가 약 58~62% 증가했다.

이번 workload에서는 비용 대비 이득이 맞지 않았다.

### tcmalloc

same-process idle baseline은 안정화됐지만 절대 footprint가 높았다.

Phase 4에서도 peak RSS가 40% 이상 늘었고 실행 시간의 일관된 이득은 없었다.

## 오히려 중요한 발견: allocator가 병목이 아니었다

snmalloc은 가장 좋은 실행 시간을 기록했지만 개선 폭은 약 2%대였다.

이 결과를 allocator가 전체 시간의 정확히 몇 퍼센트를 차지한다고 역산할 수는 없다. 하지만 적어도 **allocator 교체만으로 이 batch workload의 성능이 크게 달라지는 구조는 아니다**라는 것은 분명하다.

PostgreSQL 작업, row decode/transform, framework orchestration, digest 계산 등 전체 실행 경로가 훨씬 넓다.

그래서 allocator를 계속 미세 조정하기보다 실제 profile에서 더 큰 비중을 차지하는 경로를 찾는 것이 다음 최적화의 우선순위다.

## 최종 결정

OxideBatch 0.7.0의 이 workload와 ARM64 GNU/Linux 환경에서 내린 결정은 다음과 같다.

**Default**

`system`

**Performance opt-in**

`snmalloc`

**현재 증거로 default 비추천**

`jemalloc`, `mimalloc`, `tcmalloc`

이 결정은 snmalloc이 위험해서가 아니다. 오히려 Phase 5에서 장기 retention 우려는 상당 부분 해소됐다.

default로 올리지 않은 이유는 **약 2.2~2.4%의 성능 이득과 약 9~13%의 peak RSS 증가라는 trade-off**, 그리고 증거가 한 architecture와 한 representative workload에 한정되어 있기 때문이다.

## 이 실험에서 가장 유용했던 것

최종적으로 custom allocator를 기본값으로 채택하지 않았다.

겉으로 보면 많은 실험을 하고 “그냥 system 쓰자”로 끝난 셈이다.

하지만 이것이 벤치마크의 실패라고 생각하지 않는다.

실험 전에는 다음 질문이 계속 남아 있었다.

- jemalloc을 넣으면 서버 workload가 더 좋아지지 않을까?
- mimalloc이 더 빠른 것 아닐까?
- snmalloc의 성능 이득은 장시간 돌면 메모리 증가로 돌아오는 것 아닐까?
- system allocator를 그대로 쓰는 것이 단순히 아무것도 안 한 선택 아닐까?

이제는 이 질문들에 추측이 아니라 evidence로 답할 수 있다.

**벤치마크의 목적은 최적화를 정당화하는 것만이 아니다. 필요 없는 최적화를 제거하는 것도 중요한 결과다.**

이번에는 system allocator가 그 검증을 통과했다.

---

## Evidence boundary

이 글의 수치는 다음 범위에만 적용한다.

- OxideBatch `0.7.0`
- `postgres-postgres` representative workload
- OCI ARM64 / `aarch64-unknown-linux-gnu`
- 이 캠페인에서 고정한 dataset과 실행 geometry

다른 architecture, libc, allocator 버전, thread topology, workload allocation pattern에서는 결과가 달라질 수 있다.

공개 실험 기록:

- [Allocator campaign #323](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323)
- [Phase 4 canonical benchmark accepted evidence](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323#issuecomment-7042916850)
- [Phase 5 retained-evidence audit](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323#issuecomment-7058282776)
- [Final allocator decision](https://github.com/luceat-lux-vestra/oxide-batch-workloads/issues/323#issuecomment-7058948106)

Phase 4 summary SHA-256:

`938032fe04a00a366b3e0f9917398b19f997ac63d643f08ae017da8bd8aa4c20`

Phase 5A summary SHA-256:

`593afa55c1178db1e7d5b0ba041674d50e37ed996c04fbf3ca309cd0656054e0`

Phase 5B summary SHA-256:

`5422a392ba2133afa576883191132079068e97075d830eb79b4854cab41013a7`
