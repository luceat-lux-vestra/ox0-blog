> 이 글에서 `RequestScopeBean`은 편의상 Spring의 [`@RequestScope`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/annotation/RequestScope.html)가 적용된 Bean을 가리킨다.

Spring의 request scope는 현재 HTTP 요청의 수명주기에 맞춰 Bean 인스턴스를 관리한다. `@RequestScope`는 이 scope를 선언하기 위한 편의 애노테이션이고, 기본적으로 [scoped proxy](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html#beans-factory-scopes-other-injection)를 사용한다. 그래서 singleton Bean이 request-scoped Bean을 의존하더라도 실제 대상 인스턴스는 현재 요청에 맞춰 해석될 수 있다.

이 기능 자체는 단순하다. 어려운 부분은 무엇을 request scope에 넣을 것인가다.

요청 하나를 처리하는 동안 여러 종류의 "현재 요청 정보"가 필요할 수 있다. 하지만 이 값들이 모두 RequestScopeBean의 후보인 것은 아니다.

- 로그에만 붙일 correlation ID나 진단 필드 → [MDC](https://www.slf4j.org/manual.html#mdc)
- 서비스 경계를 넘어 이어져야 하는 trace 정보 → [Trace Context / Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- 현재 인증 사용자와 권한 → Spring Security의 [SecurityContext](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html#servlet-authentication-securitycontext)
- 유스케이스 결과를 결정하는 입력 → Application Command나 명시적 파라미터
- 한 요청 안에서만 살아야 하는 stateful helper나 같은 입력의 결과를 재사용하는 memoization → 경우에 따라 RequestScopeBean

즉 request scope는 **"요청마다 값이 다르다"를 해결하는 범용 컨텍스트 저장소가 아니라 Bean의 수명주기를 HTTP 요청과 맞추는 메커니즘**이다.

이 글의 결론도 그에 맞춰 더 보수적으로 잡는 편이 낫다.

> RequestScopeBean을 기본적인 request context 저장소로 쓰지 않는다. MDC, Trace Context, SecurityContext, 명시적 입력처럼 더 구체적인 메커니즘이 있으면 먼저 그것을 사용한다. Bean 자체가 요청마다 독립적인 상태나 동작을 가져야 하고 그 수명이 정확히 하나의 HTTP 요청이어야 할 때만 RequestScopeBean을 검토한다.

## 먼저 구분해야 할 것: 비즈니스 입력과 요청 컨텍스트

가장 먼저 봐야 할 것은 값의 출처보다 의미다.

예를 들어 `productId`, `quantity`, `searchCondition`처럼 유스케이스 결과를 바꾸는 값은 HTTP path, query, body 어디에서 왔든 비즈니스 입력이다. 이런 값은 메서드 시그니처나 명시적인 application command/use-case input object에 드러나는 편이 낫다.

반대로 `correlationId`처럼 로그 상관관계에만 필요한 값은 MDC가 더 직접적인 도구다. trace/span처럼 서비스 경계를 넘어야 하는 관측성 문맥은 OpenTelemetry 같은 표준 Context Propagation이 더 적합하다. 인증 주체와 권한은 Spring Security의 SecurityContext가 이미 담당한다.

여기서 중요한 점은 "비즈니스가 아니면 RequestScopeBean"이라는 이분법도 틀렸다는 것이다. **전용 컨텍스트가 이미 존재한다면 커스텀 RequestScopeBean을 하나 더 만들 이유가 줄어든다.**

RequestScopeBean이 남는 후보 중 하나는 request-local memoization이다. 한 요청 안에서 동일한 비용 큰 조회를 여러 컴포넌트가 반복하지만 다음 요청까지 공유하면 안 되는 경우, 요청마다 별도 인스턴스를 갖는 작은 memoizer는 수명주기를 자연스럽게 표현할 수 있다. 다만 Spring GraphQL의 [DataLoader](https://docs.spring.io/spring-graphql/reference/request-execution.html#request-execution-dataloader)처럼 이미 per-request cache를 제공하는 전용 abstraction이 있다면 그것을 먼저 사용해야 한다.

판단 기준은 "HTTP에서 왔는가"가 아니라 **"이 책임을 이미 더 정확하게 표현하는 전용 메커니즘이 있는가, 그리고 객체 자체가 요청 단위 상태를 가져야 하는가"**다.

## 여기서 말하는 Command는 무엇인가

이 글에서 `Command`라는 단어는 [GoF Command Pattern](https://sourcemaking.com/design_patterns/command) 전체를 뜻하지 않는다. 여기서는 **하나의 애플리케이션 유스케이스가 필요로 하는 의도와 비즈니스 입력을 명시적으로 묶은 application command 또는 use-case input object**라는 의미로 사용한다.

이 구분이 필요한 이유는 `Command`라는 용어가 여러 문맥에서 쓰이기 때문이다.

- **[DDD(Domain-Driven Design)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice)**는 복잡한 비즈니스 도메인을 모델 중심으로 다루는 접근이다. DDD의 계층형 설명에서 application layer는 유스케이스를 조정하고 domain layer에 비즈니스 규칙의 실행을 위임한다. DDD 자체가 모든 유스케이스에 `Command` 클래스를 만들라고 요구하는 것은 아니다.
- **[CQRS(Command Query Responsibility Segregation)](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)**는 상태를 변경하는 command 측과 데이터를 읽는 query 측의 모델을 분리하는 패턴이다. Microsoft의 CQRS 가이드는 command를 저수준 필드 변경보다 사용자의 구체적인 비즈니스 작업이나 의도로 표현하는 것을 권한다.
- **GoF Command Pattern**은 요청이나 연산 자체를 객체로 캡슐화해서 호출자와 실제 수행 대상을 분리하고, 지연 실행, 큐잉, 로깅, undo 같은 실행 제어를 가능하게 하는 행동 패턴이다.

여기서 Application Command 자체도 필수 패턴은 아니다. 입력이 몇 개 안 되고 별도 객체가 의미를 더하지 않는다면 명시적인 메서드 파라미터만으로 충분할 수 있다. 여러 비즈니스 입력이 하나의 유스케이스 의도 아래 응집될 때 command/use-case input object가 유용해진다.

따라서 다음과 같은 객체가 있다고 해서 그 애플리케이션이 CQRS를 채택했거나 GoF Command Pattern을 구현한 것은 아니다.

~~~java
public record PlaceOrderCommand(
        CustomerId customerId,
        List<OrderLineInput> lines,
        DeliveryAddress deliveryAddress
) {
}
~~~

여기서 중요한 것은 클래스 이름이 아니라 **책임**이다. 주문 유스케이스의 결과를 결정하는 입력은 command에 명시적으로 들어간다. 반대로 `correlationId`가 순수하게 로깅과 추적에만 사용된다면, 단지 여러 계층에 전달하기 싫다는 이유로 `PlaceOrderCommand`에 섞는 것은 책임을 흐린다.

개념적으로는 다음처럼 나눌 수 있다.

~~~text
HTTP DTO
    -> mapping
Application Command
    -> Application Service / Use Case

로그 진단 정보
    -> MDC

분산 추적 문맥
    -> Trace Context / Propagator

현재 인증 사용자와 권한
    -> SecurityContext

요청마다 별도 상태를 가져야 하는 작은 collaborator
    -> 필요할 때만 RequestScopeBean
~~~

즉 application command와 RequestScopeBean은 서로 대체 관계가 아니다. 더 중요한 것은 **각 책임에 이미 존재하는 전용 abstraction을 우선하고, RequestScopeBean을 마지막 후보에 가깝게 두는 것**이다.

## 파라미터 릴레이가 항상 나쁜 것은 아니다

다음과 같은 호출 흐름을 생각해보자.

~~~text
Controller
  -> Application Service
      -> Use Case
          -> Diagnostics Adapter
~~~

최하단 Diagnostics Adapter에서만 `correlationId`가 필요하고 중간 계층은 값을 전혀 사용하지 않는다고 하자.

이 경우 진단값을 모든 메서드에 릴레이하는 것도 어색하지만, 그렇다고 RequestScopeBean을 만드는 것이 기본 해법은 아니다. 로그 상관관계만 필요하다면 MDC가 더 정확한 abstraction이고, 분산 tracing이라면 Trace Context를 사용해야 한다.

반대로 유스케이스가 실제로 사용하는 값이라면 전달이 번거롭다는 이유로 숨겨서는 안 된다. 명시적 파라미터나 Application Command에는 중요한 장점이 있다.

- 호출자가 무엇을 제공해야 하는지 드러난다.
- 테스트가 숨은 요청 상태에 덜 의존한다.
- 비즈니스 입력이 정적 구조에 남는다.
- 비동기 작업이나 다른 실행 컨텍스트로 넘어갈 때 어떤 값을 전달해야 하는지 명확해진다.

따라서 **"중간 계층이 사용하지 않는 값"만으로는 RequestScopeBean을 정당화할 수 없다.** 그 값의 책임에 맞는 전용 메커니즘이 없는지 먼저 확인해야 한다.

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

### Payload와 envelope를 구분하는 관점

메시징 패턴에서는 애플리케이션이 실제로 처리할 payload와, 전달·라우팅·상관관계 같은 인프라 메타데이터를 envelope/header로 구분하는 관점이 오래전부터 사용되어 왔다. Enterprise Integration Patterns의 [Envelope Wrapper](https://www.enterpriseintegrationpatterns.com/patterns/messaging/EnvelopeWrapper.html)와 [Correlation Identifier](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html)가 대표적인 예다.

HTTP 요청 객체가 메시징 envelope와 완전히 같은 것은 아니다. 그래도 설계 질문은 유용하다. **이 값이 유스케이스가 해석할 payload인가, 아니면 전달 인프라가 관리할 metadata인가?**

예를 들어 주문 수량은 payload에 가깝지만, 순수한 trace/correlation 정보는 인프라 metadata에 가깝다. 이 구분을 무시하고 모든 것을 하나의 request DTO에 밀어 넣으면 transport contract와 내부 실행 문맥의 경계가 다시 흐려진다.

## 그럼 RequestScopeBean이 실제로 유용한 경우는 무엇인가

정리하고 보면 사용처는 생각보다 좁다. 다음 조건을 대부분 만족할 때 검토할 만하다.

~~~text
1. Bean 자체가 한 요청 동안 유지할 상태나 동작을 가진다.
2. 그 상태를 다음 요청과 공유하면 오히려 잘못된다.
3. MDC, Trace Context, SecurityContext 같은 더 구체적인 전용 메커니즘이 없다.
4. 사용처가 웹 경계나 프레임워크 통합 컴포넌트처럼 제한적이다.
5. 비동기 작업이나 요청 종료 이후까지 이 상태를 가져갈 필요가 없다.
~~~

### 실제 사례 1: 요청마다 달라지는 framework customizer

[springdoc-openapi의 공개 이슈](https://github.com/springdoc/springdoc-openapi/issues/2571)에는 reverse proxy가 넣은 `X-Forwarded-Prefix`를 읽어 OpenAPI server base URL을 요청별로 조정하기 위해 `@RequestScope`인 `ServerBaseUrlCustomizer`를 구성한 실제 사례가 있다.

이 사례가 RequestScopeBean에 잘 맞는 이유는 다음과 같다.

- 값은 비즈니스 유스케이스 입력이 아니다.
- customizer라는 **프레임워크 확장 객체 자체**가 현재 HTTP 요청에 의존한다.
- request scope를 사용하면 그 collaborator의 생성과 폐기 시점을 현재 요청에 명시적으로 맞출 수 있다.
- Application Service나 Domain Service가 이 객체를 알 필요가 없다.

singleton customizer가 항상 틀린 것은 아니다. 현재 요청을 안전하게 주입받거나 별도 context abstraction을 사용한다면 singleton으로도 구현할 수 있다. 이 사례의 의미는 **요청별 동작을 가진 framework collaborator의 lifecycle 자체를 request에 묶는 선택이 자연스러울 수 있다**는 데 있다.

### 실제 사례 2: request-local memoization

Spring GraphQL의 DataLoader는 loaded entity를 **per-request cache**로 유지하고 요청마다 DataLoader 등록을 새로 구성한다. 동일 키를 한 요청 안에서 여러 번 조회할 때 중복 I/O를 줄이되, 다른 요청이나 다른 사용자에게 캐시를 공유하지 않는 것이 목적이다.

이건 `@RequestScope` Bean 자체의 예시는 아니지만 request-scoped lifecycle이 실제로 유용한 대표 사례다. GraphQL에서는 DataLoader라는 전용 abstraction이 있으므로 그것을 쓰는 편이 맞다. 반대로 일반 Spring MVC 코드에서 같은 성질의 중복 조회가 있고 적절한 전용 abstraction이 없다면, 작은 request-scoped memoizer helper는 합리적인 구현이 될 수 있다.

중요한 제한은 **memoizer가 비즈니스 입력을 공급하는 숨은 저장소가 되어서는 안 된다는 것**이다. 이미 명시적으로 주어진 key에 대한 반복 조회를 한 요청 동안 deduplicate하는 정도가 적절하다.

### Spring 공식 LoginAction 예제는 어떻게 봐야 하나

[Spring Framework 문서](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/web-scoped-beans.html)는 request scope의 동작을 설명하기 위해 요청 파라미터의 username/password를 가진 `LoginAction`을 request-scoped Bean으로 보여준다. 이 예시는 "요청마다 새 Bean이 만들어지고 내부 상태가 격리된다"는 scope semantics를 보여주는 데는 유효하다.

하지만 그 예시를 현대적인 인증 설계의 권장안으로 받아들일 필요는 없다. username/password는 일반적인 비즈니스 유스케이스 입력이라고 단정할 값도 아니다. Spring Security의 form login에서는 [`UsernamePasswordAuthenticationFilter`](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/form.html)가 `HttpServletRequest`에서 username/password를 추출해 `UsernamePasswordAuthenticationToken`을 만들고, 이를 [`AuthenticationManager`](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html#servlet-authentication-authenticationmanager)에 전달한다. 즉 이 경우 credentials는 Controller/Application Command의 일반적인 비즈니스 입력이라기보다 **인증 경계(authentication boundary)의 입력**이다.

애플리케이션이 자체 로그인 API나 인증 유스케이스를 별도로 설계한다면 credentials를 명시적인 request/authentication input object로 모델링할 수 있다. 그래도 핵심은 같다. **credentials를 request-scoped mutable Bean에 숨기는 것과, 인증 경계의 입력으로 명시적으로 모델링하는 것은 별개의 선택**이다.

따라서 **공식 문서에 request-scoped object 예제가 있다는 사실과, 실제 애플리케이션에서 그것이 좋은 인증 경계라는 판단은 별개**다.

## RequestScopeBean이 위험해지는 순간

다음 징후가 보이면 RequestScopeBean이 범용 "현재 요청 정보" 저장소가 되어, 명시적이어야 할 데이터 의존성을 숨기는 request-local ambient/global state에 가까워지고 있다고 봐야 한다. 생성자 주입을 사용한다는 사실만으로 Service Locator가 되는 것은 아니다.

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

요청 스코프의 실제 wiring과 lifecycle까지 검증하는 테스트는 요청 스코프 인프라를 구성해야 한다. Spring은 [request-scoped Bean 테스트](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/web-scoped-beans.html)를 위해 `WebApplicationContext`와 mock request를 사용하는 방법을 제공한다. 이는 Bean 자체의 순수 로직을 일반 객체로 테스트하는 것과는 다른 테스트 경계다.

숨은 요청 상태에 의존할수록 이런 통합 테스트 경계가 늘어나므로, 편의성과 의존성 가시성 사이의 비용을 함께 봐야 한다.

## Ambient Context라는 관점

이 위험을 설명할 때 **[Ambient Context](https://blog.ploeh.dk/2019/01/21/some-thoughts-on-anti-patterns/)**라는 용어도 유용하다. Ambient Context는 호출자가 명시적으로 전달하지 않아도 현재 실행 환경 어딘가에서 꺼내 쓸 수 있는 문맥을 가리킨다. 대표적인 형태는 static current context나 thread-local 계열이다.

Mark Seemann은 Dependency Injection 관점에서 Ambient Context를 anti-pattern으로 분류한다. 핵심 문제는 필요한 의존성이 호출 구조 밖으로 숨어서, 코드만 보고 실제 입력과 의존성을 파악하기 어려워진다는 데 있다.

그렇다고 모든 RequestScopeBean이 곧 Ambient Context라는 뜻은 아니다. 생성자 주입을 통해 제한된 경계 컴포넌트에서만 사용한다면 객체 의존성 자체는 보인다. 다만 메서드 결과가 그 Bean 안의 "현재 요청 값"에 광범위하게 의존하면 데이터 의존성은 호출 시그니처 밖으로 숨을 수 있다. [`RequestContextHolder`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/request/RequestContextHolder.html) 같은 current-context 접근까지 애플리케이션 전반에 퍼지면 전형적인 Ambient Context 특성은 더 강해진다.

따라서 더 정확한 경고 신호는 "request scope를 썼는가"가 아니라 **명시적이어야 할 데이터나 의존성이 공유된 현재 실행 문맥 뒤로 숨었는가**다.

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
직접 주입을 허용할 수 있는 후보
- 현재 요청에 따라 동작이 달라지는 framework adapter / customizer
- request-local memoization을 실제로 소유하는 작은 helper

기본적으로 직접 주입하지 않는 곳
- 일반 Application / Domain Service
- Mapper
- Validator
- Repository
- 대부분의 외부 Client
~~~

Filter / Interceptor에서 추출한 값을 넣는 "RequestContext bag"을 만들기 시작했다면 한 번 더 의심하는 편이 좋다. 그 값이 logging이면 MDC, tracing이면 Trace Context, authentication이면 SecurityContext로 갈 수 있는지 먼저 확인해야 한다.

이렇게 해야 RequestScopeBean이 범용 저장소가 아니라 **정말 요청 수명의 stateful collaborator**로 남는다.

또한 컨텍스트 객체가 계속 비대해진다면 구조가 무너지고 있다는 신호로 보는 편이 좋다.

## Application Command와 명시적인 context record가 더 나은 경우

RequestScopeBean 없이도 파라미터 폭발을 줄일 수 있다. 먼저 값의 의미를 나누는 편이 좋다.

~~~text
유스케이스의 비즈니스 의도와 결과를 결정하는 입력
→ Application Command

로그에만 필요한 진단 key-value
→ MDC

서비스/프로세스 경계를 넘는 trace 문맥
→ Trace Context / Context Propagation

현재 인증 사용자와 권한
→ SecurityContext

여러 계층이 실제로 이해하고 함께 전달해야 하는 처리 문맥
→ explicit Context record (프로젝트가 직접 정의해 메서드 인자로 전달하는 context 객체)

Bean 자체가 요청마다 별도 상태를 가져야 하고 전용 abstraction이 없는 경우
→ RequestScopeBean 검토
~~~

여기서 **[Introduce Parameter Object](https://refactoring.com/catalog/introduceParameterObject.html)**도 구분해 둘 필요가 있다. Martin Fowler의 이 refactoring은 여러 메서드에서 반복해서 함께 이동하는 파라미터 묶음을 하나의 객체로 합치는 구조적 개선이다. 예를 들어 `startDate`와 `endDate`가 계속 함께 다닌다면 `DateRange`로 묶을 수 있다.

겉모습은 `record` 하나라서 비슷하지만 목적은 다르다.

~~~text
Parameter Object
→ 반복해서 함께 이동하는 파라미터 묶음을 구조적으로 정리

Application Command
→ 하나의 유스케이스 의도와 비즈니스 입력을 모델링

Context Object
→ 여러 계층이 실제로 이해해야 하는 처리 문맥을 명시적으로 전달
~~~

Application Command는 서로 관련된 비즈니스 입력을 유스케이스 단위로 묶을 수 있다. 반면 관련 값이 하나의 처리 파이프라인에서 함께 움직이고, 여러 계층에서 그 흐름 자체가 코드에 드러나야 한다면 명시적인 context record가 더 적합하다.

예를 들어 여러 계층이 실제로 **deadline이나 execution policy 같은 하나의 처리 문맥을 이해하고 사용한다면**, 프로젝트가 정의한 `ExecutionContext` 같은 객체로 묶어 메서드 인자로 명시적으로 전달할 수 있다. 반대로 correlation ID처럼 전용 컨텍스트가 이미 있는 값까지 이런 객체에 다시 모을 필요는 없다.

이 방식은 몇 가지 장점이 있다.

- 의존성이 메서드 시그니처에 남는다.
- 테스트가 일반 객체 생성만으로 가능하다.
- 비동기 작업으로 넘길 값을 명시적으로 선택할 수 있다.
- 값들이 하나의 처리 문맥을 이룬다는 사실이 코드에 남는다.

반대로 중간 계층이 이 객체를 계속 받아서 그대로 다음 계층으로 넘기기만 한다면, 먼저 그 값이 MDC·Trace Context·SecurityContext 같은 전용 컨텍스트의 책임인지 확인한다. 그래도 해당되지 않고 **객체 자체가 요청 단위 stateful collaborator여야 할 이유가 있을 때만** RequestScopeBean을 다시 검토한다.

따라서 선택 기준은 단순한 가시성과 전달 비용의 trade-off가 아니다. **더 구체적인 abstraction이 있는가**가 먼저다.

## 비동기 경계와 Context Propagation은 별도로 생각해야 한다

Servlet 기반 애플리케이션에서는 현재 요청 정보가 요청 처리 스레드와 연결되는 경우가 많다. Spring의 `RequestContextHolder` 역시 현재 스레드에 연결된 `RequestAttributes`를 다루는 API다.

따라서 별도 executor, 비동기 이벤트, 스케줄러처럼 요청 처리 경계를 벗어나는 코드에서 request-scoped state가 그대로 따라올 것이라고 가정하면 안 된다.

비동기 작업에 꼭 필요한 값이라면 명시적인 데이터로 복사해서 전달하는 쪽이 더 안전하다.

여기서 한 단계 더 나가면 **Context Propagation**이라는 별도 문제를 만나게 된다. OpenTelemetry는 Context를 논리적으로 연결된 실행 단위 사이에서 execution-scoped 값을 운반하는 메커니즘으로 정의하고, propagation을 서비스나 프로세스 경계를 넘어 그 context를 전달하는 메커니즘으로 설명한다. 분산 추적에서는 trace ID와 span ID가 대표적인 전파 대상이다.

즉 `correlationId`처럼 서비스 경계를 넘어 관측성 목적으로 이어져야 하는 값이라면 RequestScopeBean만으로 해결하려 하기보다 표준 trace context와 [Propagator](https://opentelemetry.io/docs/specs/otel/context/api-propagators/)를 먼저 검토하는 편이 낫다. RequestScopeBean은 **현재 프로세스의 요청 수명주기**를 표현하는 수단이고, Context Propagation은 **실행 경계를 넘어 문맥을 전달하는 방법**이다.

OpenTelemetry의 [Baggage](https://opentelemetry.io/docs/concepts/signals/baggage/)처럼 임의의 key-value를 함께 전파하는 수단도 있지만, 편리하다고 비즈니스 데이터나 민감정보를 마구 넣어서는 안 된다. Baggage는 downstream이나 외부 서비스까지 전달될 수 있으므로 전파 범위와 데이터 민감도를 별도로 통제해야 한다.

이 제약은 오히려 좋은 설계 신호가 된다. 요청 밖에서도 필요한 값이라면 정말 request scope에 숨길 값인지, 명시적 입력인지, 아니면 표준 propagation concern인지 다시 생각해 볼 수 있기 때문이다.

## 실무 판단 규칙

다음 순서로 보면 RequestScopeBean을 너무 빨리 선택하는 일을 줄일 수 있다.

~~~text
이 값이 애플리케이션의 비즈니스 유스케이스 결과를 바꾸는가?
→ Application Command나 명시적 파라미터.

로그에만 붙일 진단 정보인가?
→ MDC.

분산 추적이나 서비스 간 전달이 필요한 관측성 문맥인가?
→ Trace Context / Context Propagation.

현재 인증 사용자나 권한인가?
→ SecurityContext.

프레임워크가 이미 request-specific context abstraction을 제공하는가?
→ 그 abstraction을 우선 사용.

동일 요청 안에서 반복되는 조회를 deduplicate하려는가?
→ DataLoader 같은 전용 도구가 있으면 그것을 사용.
→ 없다면 작은 request-scoped memoizer를 검토.

Bean 자체의 동작이나 mutable state가 요청마다 독립적이어야 하는가?
→ RequestScopeBean 후보가 될 수 있다.

단지 여러 값을 파라미터로 넘기기 귀찮은가?
→ RequestScopeBean을 쓰지 않는다.

RequestScopeBean이 Map/DTO 같은 "현재 요청 정보 가방"이 되어 가는가?
→ 설계를 다시 나눈다.
~~~

## 결론

정리하고 보면 RequestScopeBean의 실전 사용처는 넓지 않다. 그게 이상한 것은 아니다. Spring의 request scope는 **모든 요청 정보를 담으라고 제공되는 패턴이 아니라 Bean lifecycle 기능**이기 때문이다.

대부분의 흔한 요구에는 이미 더 구체적인 도구가 있다.

- 비즈니스 입력 → Application Command / explicit parameter
- 로그 상관관계 → MDC
- 분산 추적 → Trace Context / Context Propagation
- 현재 인증된 principal/권한 → SecurityContext
- framework-specific per-request cache/context → 해당 framework abstraction

그 뒤에도 남는 요구가 **"이 Spring Bean 자체가 한 HTTP 요청 동안만 독립적인 stateful collaborator로 존재해야 한다"**라면 RequestScopeBean이 의미가 있다. 요청별 framework customizer나 전용 abstraction이 없는 작은 request-local memoizer가 그 예다.

따라서 최종 규칙은 다음처럼 잡는 편이 정확하다.

> RequestScopeBean을 request context 저장소로 시작하지 않는다. 먼저 책임별 전용 abstraction을 찾고, Bean 자체의 수명이 HTTP 요청과 같아야 할 때만 request scope를 선택한다.

## 참고

- [Spring Framework Reference: Bean Scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html)
- [Spring Framework API: RequestScope](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/annotation/RequestScope.html)
- [Spring Framework Reference: Testing Request- and Session-scoped Beans](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/web-scoped-beans.html)
- [Spring Framework API: RequestContextHolder](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/request/RequestContextHolder.html)
- [Microsoft Learn: DDD-oriented microservice design](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice)
- [Microsoft Learn: CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [SourceMaking: Command Design Pattern](https://sourcemaking.com/design_patterns/command)
- [Martin Fowler: Introduce Parameter Object](https://refactoring.com/catalog/introduceParameterObject.html)
- [Mark Seemann: Some thoughts on anti-patterns](https://blog.ploeh.dk/2019/01/21/some-thoughts-on-anti-patterns/)
- [OpenTelemetry: Context propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [OpenTelemetry: Baggage](https://opentelemetry.io/docs/concepts/signals/baggage/)
- [Enterprise Integration Patterns: Envelope Wrapper](https://www.enterpriseintegrationpatterns.com/patterns/messaging/EnvelopeWrapper.html)
- [Enterprise Integration Patterns: Correlation Identifier](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html)
- [SLF4J Manual: Mapped Diagnostic Context (MDC)](https://www.slf4j.org/manual.html)
- [Spring Security: Servlet Authentication Architecture](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html)
- [Spring Security: Form Login](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/form.html)
- [Spring for GraphQL: Request Execution / DataLoader](https://docs.spring.io/spring-graphql/reference/request-execution.html)
- [springdoc-openapi issue #2571: request-scoped ServerBaseUrlCustomizer example](https://github.com/springdoc/springdoc-openapi/issues/2571)
- [OpenTelemetry: Propagators API](https://opentelemetry.io/docs/specs/otel/context/api-propagators/)
