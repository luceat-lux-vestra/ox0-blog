> 이 글에서 RequestScopeBean은 Spring의 `@RequestScope`를 적용한 요청 스코프 컨텍스트 Bean을 뜻한다.

Spring의 request scope는 현재 HTTP 요청의 수명주기에 맞춰 Bean 인스턴스를 관리한다. `@RequestScope`는 이 scope를 선언하기 위한 편의 애노테이션이고, 기본적으로 scoped proxy를 사용한다. 그래서 singleton Bean이 request-scoped Bean을 의존하더라도 실제 대상 인스턴스는 현재 요청에 맞춰 해석될 수 있다.

이 기능 자체는 단순하다. 어려운 부분은 무엇을 request scope에 넣을 것인가다.

요청 하나를 처리하는 동안 여러 컴포넌트가 다음과 같은 정보를 공유하고 싶을 수 있다.

- correlation ID
- 요청 시작 시각
- 진단용 메타데이터
- 한 요청 안에서만 재사용할 계산 또는 조회 결과

이런 값은 하나의 HTTP 요청에 묶인다는 점에서는 RequestScopeBean과 잘 맞아 보인다. 하지만 "요청마다 값이 다르다"는 이유만으로 모든 값을 넣기 시작하면 금방 요청 단위 전역 상태가 된다.

이 글의 결론은 다음과 같다.

> RequestScopeBean은 요청 수명주기에 자연스럽게 속하는 인프라 상태를 소수의 경계 컴포넌트가 공유할 때 유용하다. 비즈니스 입력을 숨기거나 어디서든 꺼내 쓰는 저장소가 되는 순간에는 피해야 한다.

## 먼저 구분해야 할 것: 비즈니스 입력과 요청 컨텍스트

가장 먼저 봐야 할 것은 값의 출처보다 의미다.

예를 들어 `productId`, `quantity`, `searchCondition`처럼 유스케이스 결과를 바꾸는 값은 HTTP path, query, body 어디에서 왔든 비즈니스 입력이다. 이런 값은 메서드 시그니처나 명시적인 command/context에 드러나는 편이 낫다.

반대로 `correlationId`나 `requestStartedAt`처럼 로깅, 추적, 진단에 사용되고 중간 비즈니스 계층은 의미를 해석하지 않는 값은 성격이 다르다. 이런 값은 요청 단위 인프라 컨텍스트에 가깝다.

또 다른 예시는 request-local memoization이다. 한 요청을 처리하는 동안 동일한 계산이나 조회를 여러 번 수행하지만 결과를 다음 요청까지 보존할 이유가 없다면, 요청 스코프에 작은 캐시를 두는 방식은 전역 캐시보다 수명주기를 더 정확하게 표현할 수 있다.

다만 그 조회 결과 자체가 유스케이스의 핵심 판단값이라면 이야기가 달라진다. "요청 안에서만 캐시한다"와 "비즈니스 의존성을 숨긴다"는 별개의 문제다.

판단 기준은 "HTTP에서 왔는가"가 아니라 "누가 이 값의 의미를 알아야 하는가"다.

## 파라미터 릴레이가 항상 나쁜 것은 아니다

다음과 같은 호출 흐름을 생각해보자.

~~~text
Controller
  -> Application Service
      -> Use Case
          -> Diagnostics Adapter
~~~

최하단 Diagnostics Adapter에서만 `correlationId`와 요청 시작 시각이 필요하고 중간 계층은 두 값을 전혀 사용하지 않는다고 하자.

이 경우 모든 메서드에 진단용 값을 계속 추가하면 호출 시그니처가 단순 전달을 위해 길어질 수 있다. RequestScopeBean은 이런 릴레이를 줄이는 한 가지 방법이 될 수 있다.

하지만 "파라미터가 많다"는 이유만으로 request scope로 옮기면 안 된다.

명시적 파라미터에는 중요한 장점이 있다.

- 호출자가 무엇을 제공해야 하는지 드러난다.
- 테스트가 숨은 요청 상태에 덜 의존한다.
- 비즈니스 입력이 정적 구조에 남는다.
- 비동기 작업이나 다른 실행 컨텍스트로 넘어갈 때 어떤 값을 전달해야 하는지 명확해진다.

그리고 correlation ID처럼 순수하게 로깅이나 tracing에만 쓰는 값이라면, 커스텀 RequestScopeBean보다 MDC나 관측성 도구의 trace context가 더 적절할 수도 있다.

즉, RequestScopeBean은 "파라미터 전달을 없애는 기술"이 아니라 "요청 수명주기에 속하는 상태를 어디에 둘 것인가"에 대한 선택지다.

## DTO에 요청 컨텍스트를 넣는 방식의 문제

다른 유혹은 서버 내부의 요청 정보를 클라이언트 DTO에 섞는 것이다.

예를 들어 클라이언트가 보내지 않은 다음 값을 request DTO에 추가할 수 있다.

- correlation ID
- 요청 시작 시각
- 서버가 계산한 진단 플래그
- request-local 캐시에서 얻은 내부 메타데이터

처음에는 편하다. DTO가 이미 여러 계층을 통과하기 때문이다.

하지만 시간이 지나면 DTO가 두 역할을 동시에 갖게 된다.

- 클라이언트가 제공한 입력
- 서버가 요청 처리 중 만든 내부 상태

그러면 코드만 보고 값의 출처를 알기 어려워진다. 검증 시점도 흐려지고, 직렬화 대상인지 내부 전용인지 경계도 모호해진다.

DTO는 가능한 한 외부 계약 또는 명시적인 유스케이스 입력이라는 본래 역할을 유지하는 편이 낫다.

## RequestScopeBean이 잘 맞는 경우

RequestScopeBean을 고려할 만한 조건은 다음과 같다.

~~~text
1. 값이나 상태가 정확히 하나의 HTTP 요청에 종속된다.
2. 중간 비즈니스 계층은 그 값을 사용하지 않고 단순 전달만 한다.
3. 실제 사용 지점이 소수의 경계 또는 인프라 컴포넌트에 제한된다.
4. 비즈니스 유스케이스의 핵심 입력값이 아니다.
5. 요청이 끝나면 함께 사라지는 것이 자연스럽다.
~~~

비교적 일반적인 예시는 다음과 같다.

- Filter 또는 Interceptor에서 만든 요청 진단 컨텍스트
- 예외 응답이나 감사 기록에 붙일 correlation metadata
- 한 요청 안에서만 유지되는 작은 memoization/cache
- 웹 경계에서만 필요한 request-derived rendering metadata

공통점은 "요청과 함께 생성되고 요청과 함께 버려져도 된다"는 것이다.

특히 request-local cache는 유용한 예시다. 동일 요청 안에서만 반복되는 비용이 큰 작업을 한 번만 수행하고 싶지만, 다음 요청까지 결과를 유지할 이유가 없다면 request scope가 수명주기를 명확하게 표현한다.

## RequestScopeBean이 위험해지는 순간

다음 징후가 보이면 사실상 요청 단위 Service Locator 또는 전역 상태로 변하고 있다고 봐야 한다.

- 일반 Service가 직접 주입받는다.
- Mapper가 컨텍스트를 조회한다.
- Validator가 숨은 요청 상태에 의존한다.
- Repository가 요청 컨텍스트를 읽는다.
- 대부분의 Client가 같은 Bean을 직접 조회한다.
- 새 인자를 추가하기 귀찮을 때마다 Bean에 필드를 늘린다.
- 핵심 비즈니스 판단값이 메서드 인자 대신 Bean 안으로 들어간다.

이 구조에서는 메서드 시그니처만 봐서는 실제 입력 의존성을 알 수 없다.

~~~java
public Result execute(Command command) {
    // 겉으로는 command만 필요해 보이지만
    // 실제 결과가 숨은 request-scoped state에 의존할 수 있다.
}
~~~

테스트 역시 요청 스코프를 구성해야 한다. Spring은 request-scoped Bean 테스트를 지원하지만, 일반 POJO 테스트보다 `WebApplicationContext`, mock request 같은 웹 컨텍스트가 추가로 필요하다.

편의성을 얻는 대신 의존성의 가시성과 테스트 단순성을 잃는 셈이다.

## Spring의 scoped proxy를 이해해야 한다

RequestScopeBean을 singleton Service나 Controller에 주입했다고 해서 그 Service까지 request-scoped가 되는 것은 아니다.

Spring은 request-scoped Bean을 더 긴 수명의 Bean에 주입할 때 scoped proxy를 사용할 수 있다. `@RequestScope`는 기본적으로 class-based proxy를 사용하도록 정의되어 있다.

개념적으로는 다음과 같다.

~~~text
Singleton Service
    -> Request-scoped proxy
        -> 현재 HTTP 요청의 실제 RequestContext 인스턴스
~~~

이 메커니즘 덕분에 singleton Bean이 request-scoped 의존성을 가질 수 있다.

하지만 프록시가 있다는 사실이 설계 문제를 해결해 주지는 않는다. 어디서든 주입할 수 있다는 것과 어디서든 주입해야 한다는 것은 전혀 다른 문제다.

## 직접 주입 범위를 좁혀라

RequestScopeBean을 쓴다면 가장 중요한 규칙은 "누가 직접 주입받을 수 있는가"다.

예를 들어 다음 정도로 제한할 수 있다.

~~~text
직접 주입 허용
- 요청 초입에서 값을 초기화하는 Filter / Interceptor
- 예외 응답, 감사, 진단 정보를 만드는 경계 컴포넌트
- request-local memoization을 실제로 소유하는 작은 helper

직접 주입 비허용
- 일반 Application / Domain Service
- Mapper
- Validator
- Repository
- 대부분의 외부 Client
~~~

이렇게 하면 RequestScopeBean은 범용 저장소가 아니라 요청 경계의 짧은 연결 통로로 남는다.

또한 컨텍스트 객체가 계속 비대해진다면 구조가 무너지고 있다는 신호로 보는 편이 좋다.

## 명시적인 context record가 더 나은 경우

RequestScopeBean 없이도 파라미터 폭발을 줄일 수 있다.

관련 값이 하나의 처리 파이프라인에서 함께 움직이고, 그 흐름 자체가 코드에 드러나야 한다면 명시적인 context record가 더 적합하다.

~~~java
public record RequestExecutionContext(
        String correlationId,
        Instant startedAt
) {
}
~~~

이 방식은 몇 가지 장점이 있다.

- 의존성이 메서드 시그니처에 남는다.
- 테스트가 일반 객체 생성만으로 가능하다.
- 비동기 작업으로 넘길 값을 명시적으로 선택할 수 있다.
- 값들이 하나의 처리 문맥을 이룬다는 사실이 코드에 남는다.

반대로 중간 계층이 이 객체를 계속 받아서 그대로 다음 계층으로 넘기기만 하고, 실제 소비자는 요청 경계의 한두 컴포넌트뿐이라면 RequestScopeBean을 다시 검토할 수 있다.

결국 두 방식은 경쟁 관계라기보다 가시성과 전달 비용 사이의 선택이다.

## 비동기 경계는 별도로 생각해야 한다

Servlet 기반 애플리케이션에서는 현재 요청 정보가 요청 처리 스레드와 연결되는 경우가 많다. Spring의 `RequestContextHolder` 역시 현재 스레드에 연결된 `RequestAttributes`를 다루는 API다.

따라서 별도 executor, 비동기 이벤트, 스케줄러처럼 요청 처리 경계를 벗어나는 코드에서 request-scoped state가 그대로 따라올 것이라고 가정하면 안 된다.

비동기 작업에 꼭 필요한 값이라면 명시적인 데이터로 복사해서 전달하는 쪽이 더 안전하다.

이 제약은 오히려 좋은 설계 신호가 된다. 요청 밖에서도 필요한 값이라면 정말 request scope에 숨길 값인지 다시 생각해 볼 수 있기 때문이다.

## 실무 판단 규칙

다음 질문으로 정리할 수 있다.

~~~text
이 값이 비즈니스 결과를 바꾸는가?
→ 명시적인 입력으로 둔다.

요청이 끝난 뒤에도 의미가 남는가?
→ request scope 밖의 모델을 검토한다.

중간 계층이 값을 실제로 사용하는가?
→ 명시적인 파라미터나 context가 낫다.

중간 계층은 전혀 모르고 요청 경계의 소수 컴포넌트만 사용하는가?
→ RequestScopeBean을 검토할 수 있다.

한 요청 안에서만 같은 계산/조회를 재사용하고 싶은가?
→ 작은 request-local memoization은 좋은 후보가 될 수 있다.

"파라미터 넘기기 귀찮다"가 가장 큰 이유인가?
→ RequestScopeBean을 쓰지 않는다.

직접 주입 지점이 계속 늘어나는가?
→ 이미 경계를 넘고 있을 가능성이 높다.
~~~

## 결론

RequestScopeBean 자체가 나쁜 구조는 아니다. Spring이 제공하는 정식 scope이고, 하나의 HTTP 요청과 정확히 같은 수명주기를 가져야 하는 상태를 표현하는 데 유용하다.

하지만 그 장점은 사용 범위를 좁혔을 때만 유지된다.

가장 중요한 기준은 다음 한 문장으로 정리할 수 있다.

> 요청 단위 인프라 상태는 숨길 수 있지만, 비즈니스 로직의 입력 의존성까지 숨겨서는 안 된다.

RequestScopeBean을 도입할 때는 "쓸 것인가"보다 "어떤 종류의 상태만 허용하고 어디까지 주입할 것인가"를 먼저 결정하는 편이 안전하다.

## 참고

- Spring Framework Reference: Bean Scopes — <https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html>
- Spring Framework API: RequestScope — <https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/annotation/RequestScope.html>
- Spring Framework Reference: Testing Request- and Session-scoped Beans — <https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/web-scoped-beans.html>
- Spring Framework API: RequestContextHolder — <https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/request/RequestContextHolder.html>
