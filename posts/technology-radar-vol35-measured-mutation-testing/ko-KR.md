Thoughtworks의 Technology Radar는 기술 쇼핑 목록처럼 읽기 쉽다. `Adopt`, `Trial`, `Assess`, `Caution` 같은 링이 있으니 “이번 호에서 무엇을 도입해야 하나?”부터 보게 된다.

하지만 Thoughtworks의 [Radar FAQ](https://www.thoughtworks.com/radar/faq)는 `Adopt`조차 모든 프로젝트에 무조건 쓰라는 뜻이 아니라고 명시한다. 맥락에 맞는지 판단해야 한다. 2026년 11월 공개된 [Technology Radar Vol.35](https://www.thoughtworks.com/radar)는 특히 AI agent를 더 크게, 더 오래 운영할수록 모델 자체보다 **환경, 접근 제어, 사람의 감독, 비용과 신뢰성** 같은 주변 엔지니어링이 중요해진다는 쪽으로 무게를 옮겼다.

이 메시지를 그대로 받아들이는 대신 한 가지 질문으로 좁혀 봤다.

> “검토를 더 많이 하자”가 아니라, 테스트가 실제로 잘못된 동작을 잡아내는지 측정할 수 있을까?

그 질문에 대해 공개 Rust 프로젝트인 [OxideBatch](https://github.com/luceat-lux-vestra/oxide-batch)에서 작은 mutation-testing 실험을 했다.

결론부터 말하면, 고정된 10개 mutant에서 기존 테스트는 8개를 잡고 2개를 놓쳤다. production source와 mutant population을 그대로 둔 채 negative test 두 개만 추가하자 10개를 모두 잡았다. mutation run 자체의 시간은 약 4.6%, clean test와 mutation run을 합친 측정 구간은 약 5.0% 늘었다.

이 결과는 mutation testing을 모든 PR의 필수 gate로 만들자는 근거가 아니다. 오히려 반대다. **비용이 있는 도구를 좁고 결정론적인 고위험 정책 로직에 수동으로 적용했을 때, 실제 test-sensitivity gap을 찾는 데 가치가 있었다**는 정도가 이번 실험이 말할 수 있는 범위다.

## 먼저 정정할 것: Mutation testing은 Vol.35의 Adopt 항목이 아니다

이 글을 준비하면서 가장 먼저 바로잡아야 했던 전제가 있었다.

Thoughtworks의 공식 [Mutation testing](https://www.thoughtworks.com/radar/techniques/mutation-testing) 페이지는 2026년 4월, **Technology Radar Vol.34의 `Trial`** 항목이다. Vol.35가 mutation testing을 새로 `Adopt`로 올렸다고 쓰면 틀린다.

Vol.35와의 직접적인 연결점은 다른 곳에 있다. Vol.35의 [`Human-in-the-loop theater`](https://www.thoughtworks.com/radar/techniques/human-in-the-loop-theater)는 사람이 실제로 평가할 수 없는 변경에 형식적으로 승인 버튼만 누르는 상황을 경고한다. 그리고 단순 승인 대신 시스템을 더 강하게 조종하는 방법으로 mutation testing, property-based testing, TLA+/Quint 같은 formal model, agent-assisted semantic review를 예로 든다.

즉 이 글의 출발점은 “Vol.35가 mutation testing을 Adopt했다”가 아니다.

- Vol.34: mutation testing 자체는 `Trial`
- Vol.35: 의미 없는 human approval보다 더 강한 검증과 steering을 강조
- 이번 실험: 그 메시지를 mutation testing이라는 한 가지 측정 가능한 방법으로 좁혀 직접 검증

이 구분은 중요하다. Radar의 링과 실제 프로젝트의 도입 판단을 섞으면 외부 권고를 내부 증거처럼 과장하기 쉽다.

## Coverage와 test sensitivity는 같은 질문이 아니다

[cargo-mutants 문서](https://mutants.rs/vs-coverage.html)는 coverage와 mutation testing의 차이를 단순하게 설명한다.

Coverage는 테스트를 실행했을 때 어떤 코드가 **실행됐는지** 알려준다. 하지만 그 테스트가 실제 동작을 제대로 **검증했는지**까지 알려주지는 않는다.

Mutation testing은 반대로 source code에 의도적인 변형을 넣고 테스트가 실패하는지 본다. 예를 들어 `Result`를 반환하는 함수가 본래 검증 로직을 수행해야 하는데 mutant가 그냥 `Ok(())`를 반환하도록 바뀌었을 때도 테스트가 계속 통과한다면, 해당 동작에 대한 assertion이 약할 가능성이 있다.

물론 `missed mutant = 실제 버그`는 아니다. [cargo-mutants의 결과 설명](https://mutants.rs/using-results.html)에 따르면 missed mutant는 테스트의 빈틈일 수도 있고, 원래 코드와 구별되지 않는 equivalent mutation일 수도 있다. 그래서 숫자만 올리는 것보다 survivor를 직접 분류하는 작업이 중요하다.

비용도 있다. mutation testing은 기본적으로 mutant마다 build/test를 반복한다. [cargo-mutants 문서](https://mutants.rs/vs-coverage.html)도 큰 코드베이스와 느린 테스트에서는 시간이 오래 걸릴 수 있다고 명시한다.

그래서 이번 실험 질문은 “mutation score를 100%로 만들 수 있는가?”가 아니었다.

> 현재 테스트가 중요한 lifecycle policy를 실제로 깨뜨리는 변경을 감지하는가?

## 실험 범위: production source와 mutant population을 고정했다

대상은 OxideBatch의 lifecycle policy 중 작은 pure-policy slice였다. 공개 실험 owner는 [oxide-batch #628](https://github.com/luceat-lux-vestra/oxide-batch/issues/628), 실험 harness는 DRAFT / DO NOT MERGE 상태의 [PR #629](https://github.com/luceat-lux-vestra/oxide-batch/pull/629)다.

비교 가능성을 위해 다음을 고정했다.

- production source: commit [`2be0442acc8a010a9e2c31163a86c6d46b16c418`](https://github.com/luceat-lux-vestra/oxide-batch/commit/2be0442acc8a010a9e2c31163a86c6d46b16c418)
- Rust: 1.97.1
- cargo-mutants: 27.1.0
- mutation 대상: lifecycle policy의 네 함수
- frozen mutant population: 10개 viable mutant
- Before와 After에서 production source는 동일
- After에서는 test oracle만 바꿈

대상 함수는 다음 네 개였다.

- `is_legal_in_place_transition`
- `validate_transition`
- `validate_restart`
- `validate_expected_version`

mutant population을 고정한 이유는 단순하다. Before와 After에서 source나 mutation selection이 달라지면 score가 바뀌어도 테스트가 좋아졌기 때문인지, 비교 대상이 달라졌기 때문인지 분리하기 어렵다.

## Before: 10개 중 8개는 잡았고, 2개는 살아남았다

초기 lifecycle property oracle은 4개 테스트였다.

결과는 다음과 같았다.

| 항목 | Before |
| --- | ---: |
| Oracle tests | 4 |
| Viable mutants | 10 |
| Caught | 8 |
| Missed | 2 |
| Timeout | 0 |
| Unviable | 0 |
| Mutation score | 80% |

중요한 것은 80%라는 숫자보다 **무엇이 살아남았는가**였다.

첫 번째 survivor는 `validate_expected_version`의 검증을 없애고 항상 `Ok(())`를 반환하게 만든 mutation이었다. 즉 stale execution version을 거부해야 하는 로직이 사라져도 선택한 테스트는 실패하지 않았다.

두 번째 survivor는 `validate_restart`가 항상 `Ok(())`를 반환하도록 만든 mutation이었다. 즉 restart할 수 없는 status에서도 restart를 허용하는 변경이 들어가도 테스트가 잡지 못했다.

둘 다 “동작이 사실상 같은 equivalent mutant”로 보기 어려웠다. lifecycle contract의 명시적인 rejection rule을 없애는 변경이기 때문이다.

이 시점에서 mutation testing은 이미 한 가지 역할을 했다. “coverage가 몇 퍼센트인가?”보다 훨씬 구체적인 질문을 던졌다.

> stale-version rejection과 non-restartable restart rejection을 지금 테스트가 실제로 보증하고 있는가?

답은 아니었다.

## Intervention: production code는 그대로 두고 negative test 두 개만 추가했다

다음 단계에서는 production logic을 고치지 않았다. mutation operator도 바꾸지 않았다. 기존 10개 mutant population도 그대로 유지했다.

추가한 것은 두 개의 좁은 negative test였다.

1. stale expected version으로 restart를 시도하면 `StaleVersion`을 반환하고 기존 execution state가 바뀌지 않는지 검증
2. restart할 수 없는 status에서 job/step restart attempt가 `NotRestartable`로 거부되는지 검증

그리고 PR HEAD의 test file만 fixed production source 위에 overlay해서 같은 source, 같은 mutant population을 다시 실행했다.

clean lifecycle oracle은 6개 테스트 모두 통과했다. 이후 exact candidate CI [run 42093990320](https://github.com/luceat-lux-vestra/oxide-batch/actions/runs/42093990320)도 성공했고, mutation run [42093990117](https://github.com/luceat-lux-vestra/oxide-batch/actions/runs/42093990117)도 성공했다.

## After: 8/10에서 10/10으로

공개된 [AFTER evidence](https://github.com/luceat-lux-vestra/oxide-batch/issues/628#issuecomment-6667730546) 기준 비교는 다음과 같다.

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

두 survivor 모두 `CaughtMutant`로 바뀌었다.

여기서 가장 의미 있는 변화는 score가 100%가 된 사실 자체가 아니다. **처음에는 검증되지 않던 두 rejection rule이 이제 실제 실패 신호로 연결됐다는 것**이다.

## 이 결과로 말할 수 있는 것과 말할 수 없는 것

이번 실험으로 말할 수 있는 것은 제한적이다.

말할 수 있는 것:

- 이 lifecycle slice에서 선택한 기존 oracle에는 실제 test-sensitivity gap 두 개가 있었다.
- mutation testing이 그 gap을 구체적인 code change 형태로 드러냈다.
- production source와 mutant population을 고정한 상태에서 test-only intervention으로 두 gap을 모두 닫았다.
- 이 bounded run에서는 mutation 단계의 wall time이 약 4.6%, clean oracle까지 포함한 측정 구간이 약 5.0% 늘었다.

말할 수 없는 것:

- “100% mutation score이므로 production-safe하다.”
- “OxideBatch 전체 테스트가 충분하다.”
- “모든 Rust 프로젝트가 mutation testing을 써야 한다.”
- “mutation testing을 모든 PR에서 required gate로 돌려야 한다.”
- “이 결과가 AI 생산성이나 보안 향상을 증명한다.”
- “약 5%라는 비용이 다른 코드베이스에서도 비슷하다.”

특히 실험은 하나의 lifecycle slice와 한 번의 comparable Before/After pair만 사용했다. run-to-run variance를 측정한 벤치마크가 아니다.

cargo-mutants 자체에도 한계가 있다. [공식 limitations 문서](https://mutants.rs/limitations.html)는 hermetic하고 안정적인 테스트가 필요하며, type 정보를 완전히 이해하지 못해 unviable mutant를 만들 수 있고, 일부 조건부 컴파일이나 build 환경을 완전히 모델링하지 못한다고 설명한다.

그래서 100%라는 숫자를 품질 badge처럼 쓰는 순간 실험의 의미가 오히려 약해진다.

## 내 결론: PR gate보다 targeted manual diagnostic

이번 결과를 보고 mutation testing을 CI의 기본 gate로 넣지는 않기로 했다.

대신 다음 조건에 맞는 곳에서 **targeted manual diagnostic**으로 쓰는 쪽이 합리적이라고 판단했다.

- policy/state-transition처럼 semantics가 좁고 중요한 코드
- deterministic하고 hermetic한 테스트가 있는 영역
- survivor가 equivalent인지 실제 contract gap인지 사람이 분류할 수 있는 범위
- source와 mutation population을 고정해 Before/After를 비교할 수 있는 실험
- PR critical path 밖에서 몇 분~수십 분의 추가 비용을 감수할 가치가 있는 영역

반대로 일반적인 line coverage 대체 지표나 “mutation score 100%” 목표로 쓰는 것은 이번 근거에서 벗어난다. 기존 unit/property/conformance/failure 테스트가 primary evidence이고, mutation testing은 **그 evidence가 실제로 민감한지 압박해 보는 보조 도구**에 가깝다.

이 판단은 Thoughtworks의 Radar ring 철학과도 잘 맞는다. `Trial`은 “무조건 도입”이 아니라 실제 프로젝트에서 써 보고 자신의 toolkit에 들어갈지 판단하는 단계다. 그리고 Vol.35의 human-in-the-loop 비판도 형식적인 승인보다 실제로 시스템을 steering할 수 있는 신호를 요구한다.

## Radar를 읽고 해야 할 일은 목록을 복사하는 것이 아니다

이번에 가장 크게 남은 것은 mutation score보다 방법론이었다.

외부 Radar에서 흥미로운 practice를 발견했다면 바로 정책으로 옮기기보다 다음처럼 좁힐 수 있다.

1. 현재 프로젝트에서 실제로 존재하는 gap을 하나 고른다.
2. Before를 먼저 고정한다.
3. production behavior를 가능한 한 그대로 둔 채 작은 intervention을 한다.
4. 동일한 comparator로 After를 잰다.
5. 개선뿐 아니라 비용과 적용하지 않을 범위까지 기록한다.

이번 mutation-testing 실험에서는 그 절차가 잘 작동했다. 두 개의 missed mutant가 두 개의 구체적인 negative test로 이어졌고, 동시에 14분대 mutation run이라는 비용도 확인했다.

그래서 결론은 “mutation testing을 도입했다”보다 조금 더 좁다.

> 중요한 정책 로직에서 테스트의 민감도를 의심할 이유가 있을 때, mutation testing은 수동으로 꺼내 볼 가치가 있었다. 하지만 한 번의 10-mutant 실험을 CI 정책으로 일반화할 이유는 아직 없다.

Radar는 답이라기보다 실험할 질문을 고르는 데 더 유용했다.
