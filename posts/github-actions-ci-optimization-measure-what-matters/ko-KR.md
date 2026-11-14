GitHub Actions를 오래 쓰다 보면 어느 순간 “CI가 느리다”는 말이 너무 뭉뚱그려져 있다는 걸 느끼게 된다.

한 workflow가 10분 걸린다고 해도 원인은 전혀 다를 수 있다. 컴파일 자체가 느릴 수도 있고, 여러 job 중 하나가 critical path를 잡고 있을 수도 있다. 병렬 job을 늘려 개발자가 기다리는 시간은 줄었지만 총 runner 사용량은 더 커졌을 수도 있다. 특정 step을 30% 줄였는데도 더 느린 다른 job이 남아 있어서 merge 가능한 시점은 전혀 달라지지 않을 수도 있다.

최근 여러 공개 오픈소스 프로젝트의 GitHub Actions를 정리하면서 이 문제를 가능한 한 숫자로 확인해 봤다.

처음에는 흔히 알려진 최적화를 적용하면 될 것이라고 생각했다.

- x86_64 대신 ARM64 runner 사용
- Rust compiler cache 정리
- Gradle cache 조정
- workflow와 validation DAG 단순화
- integration test sharding
- 중복 build 제거
- 더 빠른 linker 사용

그런데 실제 결과는 “이 기법은 빠르다”처럼 정리되지 않았다.

어떤 변경은 개별 job을 크게 줄였지만 merge-ready latency에는 거의 영향을 주지 않았다. 병렬화를 늘리면 wall-clock은 크게 줄었지만 aggregate runner work는 늘었다. 반대로 runner 수를 줄이니 총 작업량은 감소했지만 개발자가 기다리는 시간이 다시 늘었다.

가장 흥미로운 경우는 한 번 성능상 가치가 없다고 기각했던 최적화가 CI topology가 바뀐 뒤 다시 유효해진 것이었다.

다만 이 글에서 위 변경을 전부 사례별로 나열하지는 않는다. 판단 기준의 차이가 가장 선명했던 두 가지에 집중한다.

- **integration test sharding** — wall-clock latency를 줄이는 대신 aggregate runner work가 늘어나는 경우
- **mold linker 재평가** — runner architecture와 compiler-cache topology가 바뀌자 과거 REJECT가 일부 환경에서 ADOPT로 뒤집힌 경우

ARM64 runner와 sccache는 별도의 “성공 사례”라기보다 두 번째 판단이 달라진 조건으로 다룬다. Gradle cache나 workflow 정리 같은 다른 변경도 이번 글의 측정 프레임을 만드는 데 영향을 줬지만, 여기서 각각의 팁으로 확장하지 않는다.

이 글은 GitHub Actions 팁을 나열하기보다, 그 과정에서 사용한 **측정 기준과 의사결정 방식**을 정리하려고 한다.

## “CI 시간”은 하나의 숫자가 아니다

이번 작업을 하면서 CI 성능을 최소 세 가지로 나눠 보기 시작했다.

### 1. Wall-clock latency

PR이 시작된 뒤 필요한 검증이 모두 끝나서 다음 행동을 할 수 있을 때까지 실제로 얼마나 기다리는가.

개발자 피드백 속도를 이야기할 때 가장 직접적인 수치다.

### 2. Critical path

여러 job이 동시에 실행되더라도 최종 완료 시점을 결정하는 경로는 따로 있다.

예를 들어 Build가 4분, Test가 6분, CodeQL이 9분 걸리고 서로 병렬이라면 Build를 2분으로 줄여도 전체 완료 시점은 거의 바뀌지 않는다. 9분짜리 경로가 그대로 남아 있기 때문이다.

그래서 “이 job이 몇 % 빨라졌다”와 “CI가 몇 % 빨라졌다”는 같은 문장이 아니다.

### 3. Aggregate runner work

병렬 job 전체가 소비한 실행시간을 합친 값이다.

GitHub-hosted runner에서 4개의 job이 각각 2분씩 실행됐다면 개발자가 체감하는 wall time은 2분 근처일 수 있지만, 실행된 runner work는 대략 8분이다.

이 글에서는 이 값을 실제 billing 비용과 동일시하지 않는다. 공개 workflow 실행시간만으로 billed runner minutes를 정확히 추정할 수 없기 때문이다. 여기서는 순수하게 **얼마나 많은 실행 작업을 발생시켰는가**를 비교하는 지표로 사용한다.

그리고 여기에 하나를 더 붙였다.

### 4. Validation scope

시간이 줄었다고 해도 같은 것을 검증하고 있는지가 먼저다.

검증 범위를 줄이거나 실행 시점을 옮겨서 빨라진 결과와, 동일한 검증을 더 효율적으로 실행해서 빨라진 결과는 분리해야 한다.

이 구분을 하지 않으면 “CI 최적화”라는 이름 아래 성능, 비용, 보안 정책 변경이 한 숫자에 섞인다.

## 4-way sharding은 빨랐지만, 공짜는 아니었다

Rust batch framework인 [oxide-batch](https://github.com/luceat-lux-vestra/oxide-batch)에서는 integration test를 네 개의 ARM64 runner로 나눠 실행하고 있었다.

문제는 compiler cache와 다른 CI 구조가 여러 번 바뀐 뒤에도 “4개 shard가 지금도 최적인가?”라는 근거가 오래된 상태였다는 점이다.

그래서 [공개 측정 이슈 #626](https://github.com/luceat-lux-vestra/oxide-batch/issues/626)에서 현재 4-way 실행과 동일한 테스트 전체를 한 runner에서 실행하는 구성을 같은 source SHA, 같은 target inventory, 같은 toolchain과 cache 정책 아래 비교했다.

4개의 유효한 crossover pair에서 4-way sharding은 한 runner 실행보다 critical integration wall time을 **56.73~62.48%**, 중앙값 **61.21%** 줄였다.

개발자가 기다리는 시간만 보면 압도적인 승리다.

하지만 같은 실험에서 aggregate integration work는 반대로 **24.94~51.37%**, 중앙값 **41.45%** 증가했다.

즉 결과는 다음처럼 요약됐다.

| 목표 | 4-way sharding |
| --- | --- |
| Critical latency | 크게 감소 |
| Aggregate work | 크게 증가 |
| Test denominator | 동일 |
| 결론 | latency를 위해 추가 work를 지불 |

그 다음 질문은 자연스럽다.

> 병렬성은 유지하면서 중복 compiler/setup 비용만 줄일 수 없을까?

[후속 이슈 #627](https://github.com/luceat-lux-vestra/oxide-batch/issues/627)에서 compile-once/transfer, 한 runner 내부 병렬 실행, shard 수 축소 같은 후보를 검토했다.

그중 4개 lane을 3개로 줄이는 비교는 aggregate work를 실제로 줄였다. 그러나 2× A→C + 2× C→A crossover 결과에서 3-way 구성은 4-way 대비:

- core critical latency: 중앙값 **+18.89%**
- summed core execution: 중앙값 **-10.94%**
- full lane-job critical latency: 중앙값 **+16.61%**
- summed lane-job elapsed: 중앙값 **-12.41%**

였다.

일은 약 11~12% 덜 했지만 개발자가 기다리는 시간은 약 17~19% 늘어난 셈이다.

그래서 production에서는 **4-way를 유지**했다.

여기서 중요한 것은 4-way가 절대적으로 “효율적”이라는 결론이 아니다.

오히려 정반대다. 4개의 독립 runner가 compiler/setup work를 중복한다는 사실은 그대로 남았다. 다만 지금 테스트한 단순한 consolidation 방법들은 그 중복을 줄이는 대가로 latency를 너무 많이 악화시켰다.

CI 최적화에서 “총 일을 줄이는 것”과 “개발자의 대기시간을 줄이는 것”이 서로 다른 목표라는 걸 가장 명확하게 보여준 실험이었다.

## 한 번 기각했던 mold를 다시 측정했다

더 극적인 사례는 Rust linker였다.

2026년 10월, oxide-batch와 Arkst에서 [mold](https://github.com/rui314/mold)를 기본 GNU linker와 비교했다.

당시 oxide-batch의 x86_64 실험은 cold build 기준 paired mean 차이가 약 **+0.09%**에 불과했다. 사실상 noise였다. 공개 기록은 [oxide-batch #405](https://github.com/luceat-lux-vestra/oxide-batch/issues/405)에 남아 있다.

Arkst의 x86_64 실험도 비슷했다. mold의 cold paired mean은 오히려 약 **1.38% 느렸다**. 이 결과는 [Arkst #524](https://github.com/luceat-lux-vestra/arkst/issues/524)에 기록했다.

둘 다 당시 판단은 REJECT였다.

중요한 것은 “mold가 느리다”가 결론이 아니었다는 점이다.

당시 workload는 compilation이 지배적이었다. linker를 바꿔도 전체 build/test wall time에서 차이가 살아남지 않았다.

그 뒤 CI topology가 바뀌었다.

Linux job의 상당 부분을 ARM64 runner로 옮겼고, protected main에서 sccache compiler cache를 만든 뒤 PR에서는 그 cache를 read-only로 소비하는 구조가 자리 잡았다.

Arkst의 production-like ARM64 profile에서는 386 Rust hits / 0 misses 상태에서 full workspace + Typst 단계의 system-linker occupancy가 **81.27%**까지 올라갔다.

컴파일 작업 대부분이 cache에서 사라지자, 이전에는 작은 비중이었던 linking이 남은 active work의 대부분을 차지하게 된 것이다.

그래서 같은 질문을 다시 측정했다.

Arkst ARM64 + warm compiler-cache 환경의 balanced 4-runner comparison에서:

| Linker | Mean |
| --- | ---: |
| system | 175.514s |
| mold | 116.546s |

mold는 **58.968초, 33.60%** 빨랐고 4/4 observation에서 같은 방향이 나왔다.

이 결과를 바탕으로 [Arkst PR #760](https://github.com/luceat-lux-vestra/arkst/pull/760)에서 Ubuntu ARM64 job에만 mold를 제한적으로 적용했다.

단, 이 숫자를 “Arkst CI 전체가 33.6% 빨라졌다”고 쓰면 틀린다.

측정 당시 최근 PR 표본에서 Ubuntu ARM64가 platform-test critical path였던 경우는 6개 중 1개였다. macOS나 Windows가 더 늦게 끝나는 PR에서는 Ubuntu job을 1분 줄여도 Merge Gate는 그만큼 빨라지지 않는다.

따라서 이 결과의 정확한 표현은 **Ubuntu ARM64 job-local improvement**다.

oxide-batch에서도 같은 topology 변화를 반영해 다시 측정했다.

ARM64 + steady-state sccache에서는 system mean **56.331초**, mold mean **52.207초**로 약 **7.32%** 개선됐고, 4/4 pair에서 mold가 빨랐다. 이후 [PR #636](https://github.com/luceat-lux-vestra/oxide-batch/pull/636)으로 ARM64 compiler-cache consumer 경로에 적용했다.

그리고 혹시 “warm cache가 핵심이었다면 x86_64도 이제 빨라졌을 수 있지 않나?”라는 질문까지 다시 확인했다.

현재 x86_64 + warm sccache topology에서 같은 방식으로 재실험한 결과는:

| Linker | Mean |
| --- | ---: |
| system | 64.283s |
| mold | 64.266s |

차이는 약 **18ms, 0.028%**였다. mold가 빨랐던 pair도 4개 중 하나뿐이었다.

x86_64에서는 다시 REJECT였다.

같은 repository, 같은 Rust toolchain 계열, 같은 mold 3.0.0이어도 ARM64에서는 채택할 가치가 있었고 x86_64에서는 없었다.

이 결과 때문에 linker에 대한 결론을 “mold는 빠르다”로 남기지 않았다.

대신 이렇게 남겼다.

> 성능 최적화의 verdict는 도구에 붙는 영구 라벨이 아니라, runner architecture·cache hit rate·workload topology에 대한 판단이다.

한 번 NO-GO였던 실험도 병목 구조가 바뀌면 다시 측정할 가치가 있다.

그리고 반대로, 한 환경에서 크게 이겼다고 다른 환경으로 확산할 근거가 생기는 것도 아니다.

## 실험에서 빨랐던 결과가 실제 PR에서도 살아남았나?

이 질문은 더 이상 미래형으로 남겨둘 필요가 없었다.

oxide-batch에서는 mold 적용과 compiler-cache publication 경로를 정리한 뒤 실제 개발 PR이 연속해서 들어왔다.

[PR #642](https://github.com/luceat-lux-vestra/oxide-batch/pull/642), [#649](https://github.com/luceat-lux-vestra/oxide-batch/pull/649), [#651](https://github.com/luceat-lux-vestra/oxide-batch/pull/651), [#652](https://github.com/luceat-lux-vestra/oxide-batch/pull/652)의 quality-fast job을 다시 확인했다.

| PR | quality-fast job wall | Rust cache hit / miss |
| --- | ---: | ---: |
| #642 | 76s | 443 / 2 |
| #649 | 77s | 443 / 2 |
| #651 | 78s | 445 / 0 |
| #652 | 72s | 444 / 1 |

네 run 모두 ARM64에서 mold 3.0.0을 실제로 선택했고 protected-main 계열 sccache를 restore한 뒤 성공했다.

즉 controlled benchmark에서만 7% 정도 빨랐던 구성이 production workflow에 들어간 뒤 바로 무너진 것은 아니었다. 서로 다른 실제 변경을 담은 후속 PR에서도 compiler cache는 거의 전부 재사용됐고 quality-fast job은 **72~78초** 범위에서 안정적으로 끝났다.

여기서도 과장하면 안 된다.

이 표는 mold가 없었을 때의 동일 PR control을 갖고 있지 않다. 따라서 이 네 PR을 이용해 “production에서 추가로 7.32% 빨라졌다”는 새 causal percentage를 계산할 수는 없다.

대신 확인할 수 있는 것은 더 운영적인 사실이다.

- 실험에서 채택한 ARM64 + mold topology가 실제 PR workflow에서도 계속 실행된다.
- protected-main compiler cache가 실제 개발 변경에서도 높은 hit rate로 소비된다.
- 적용 직후에만 성립한 synthetic benchmark가 아니라 후속 개발 과정에서도 같은 구조가 유지된다.
- 새 source 변경으로 1~2개의 Rust miss가 발생해도 전체 cache topology가 붕괴하지 않는다.

Arkst도 처음에는 같은 수준의 운영 증거가 없었다.

[PR #760](https://github.com/luceat-lux-vestra/arkst/pull/760) 직후의 #761~#768은 대부분 Quarkdown clean-room probe라 일반 Ubuntu ARM64 test job이 path/scope fast path로 몇 초 만에 끝났다. 단순히 “PR이 많이 생겼다”는 이유만으로 mold 운영 검증이 쌓였다고 볼 수는 없었다.

하지만 장기 작업 PR인 [#746](https://github.com/luceat-lux-vestra/arkst/pull/746)은 달랐다. #760 병합 이후에도 Rust differential test와 관련 source가 계속 추가되면서 같은 production CI의 full Ubuntu ARM64 경로가 반복해서 실행됐다.

최근 성공한 full CI 10개를 표본으로 다시 확인했다.

- Ubuntu ARM64 job wall: **137~161초**
- 중앙값: **144초**
- 10/10 run에서 **mold 3.0.0** 선택 확인
- 10/10 run에서 protected-main sccache restore 확인
- 10/10 run에서 **386 Rust hits / 0 misses**
- 10/10 run에서 cache read/write error **0**

예를 들어 [run 43363230122](https://github.com/luceat-lux-vestra/arkst/actions/runs/43363230122), [43477887955](https://github.com/luceat-lux-vestra/arkst/actions/runs/43477887955), [43541989460](https://github.com/luceat-lux-vestra/arkst/actions/runs/43541989460)은 서로 다른 시점의 #746 HEAD에서 같은 ARM64 + mold + protected-main cache 경로를 실제로 끝까지 통과했다.

따라서 Arkst도 이제 “controlled benchmark와 production merge까지만 확인됐다”고 쓰는 것은 맞지 않는다.

다만 oxide-batch와 증거의 모양은 조금 다르다.

oxide-batch는 여러 독립 PR에서 같은 topology가 반복된 반면, Arkst는 **하나의 장기 PR이 여러 evolving HEAD를 거치며 full CI를 반복한 표본**이다. 서로 다른 PR population만큼 넓은 증거는 아니지만, synthetic benchmark를 벗어나 실제 개발 source 변화 아래에서도 topology가 유지되는지는 충분히 확인할 수 있다.

여기서도 같은 원칙이 남는다.

> “적용 이후 PR이 몇 개 있었는가?”가 아니라 “최적화한 경로가 실제 source 변화와 함께 몇 번 실행됐는가?”를 봐야 한다.

현재는 두 프로젝트 모두 controlled experiment와 운영 증거를 함께 갖는다.

- **oxide-batch ARM64 + mold:** controlled A/B + production producer/consumer 검증 + 여러 후속 개발 PR.
- **Arkst ARM64 + mold:** controlled A/B + production 적용 + 장기 개발 PR의 여러 evolving HEAD에서 반복된 full Rust CI.

이 운영 데이터 역시 mold의 33.60%나 7.32%를 다시 인과적으로 증명하는 A/B는 아니다. 그 percentage는 controlled experiment의 결과다.

운영 데이터가 추가로 증명하는 것은 더 좁다.

**실험에서 채택한 topology가 실제 개발 과정에서도 깨지지 않고 계속 작동했다.**

실험의 결과와 실제 workflow의 결과를 분리해서 기록해야 “벤치마크에서는 빨랐다”와 “실제 개발에서도 그 구조가 유지됐다”를 구분할 수 있다.

## 결국 무엇을 줄였는지부터 적어야 한다

두 사례의 결론은 서로 반대처럼 보인다.

sharding에서는 더 많은 runner work를 감수하고 latency를 지켰다. mold에서는 같은 검증 경로 안에서 남은 병목이 linking으로 이동한 뒤에야 linker 교체가 가치가 생겼다.

하지만 의사결정 방식은 같았다.

1. **목표 지표를 먼저 정한다.** 개발자가 기다리는 wall-clock인지, critical path인지, aggregate runner work인지, 특정 job의 local latency인지 구분한다.
2. **validation denominator를 고정한다.** 같은 테스트와 검증을 더 효율적으로 실행한 것인지, 검증 범위나 실행 시점 자체를 바꾼 것인지 섞지 않는다.
3. **비교 조건을 기록한다.** source SHA, runner architecture, toolchain, cache 상태와 key, workload를 남긴다. 특히 cold cache와 warm cache를 같은 숫자로 취급하지 않는다.
4. **NO-GO도 결과로 남긴다.** x86_64의 mold처럼 개선이 없으면 채택하지 않는다. 실패한 실험을 지우면 나중에 topology가 변했을 때 무엇을 다시 측정해야 하는지도 알 수 없다.
5. **topology가 바뀌면 오래된 verdict를 다시 의심한다.** compiler cache가 compile cost를 제거하면 linker가 새 critical work가 될 수 있다. 반대로 한 환경의 ADOPT가 다른 architecture의 ADOPT를 의미하지 않는다.
6. **controlled experiment와 production observation을 분리한다.** A/B는 인과적 성능 차이를 보여주고, 후속 실제 PR은 그 구조가 운영에서도 유지되는지를 보여준다. 둘 중 하나가 다른 하나를 대신하지 않는다.

반대로 이번 정리에서 **성능 개선으로 세지 않은 것**도 있다.

자체적으로 더 엄격하게 올렸던 정책을 원래 수준으로 되돌린 것은 성능 최적화가 아니다. validation scope나 실행 시점을 바꾼 일은 동일 검증의 성능 개선과 별도 축으로 기록해야 한다. workflow 수나 Actions 화면의 카드 수가 줄었다는 사실만으로 CI가 빨라졌다고 볼 수도 없다.

그래서 최종적으로 남은 질문은 “어떤 GitHub Actions 팁이 빠른가?”가 아니다.

> **무엇이 현재 critical path이고, 어떤 비용을 줄이려 하며, 그 판단을 뒤집을 만큼 topology가 바뀌었는가?**

CI 최적화는 빠른 도구 하나를 고르는 일이 아니라, **latency·aggregate work·validation scope 사이에서 어떤 비용을 지불할지 측정으로 결정하는 일**에 더 가까웠다.
