> In this article, "RequestScopeBean" means a request-scoped context bean implemented with Spring's `@RequestScope`.

Spring's request scope ties a bean instance to the lifetime of the current HTTP request. `@RequestScope` is the convenience annotation for declaring that scope, and it uses a scoped proxy by default. That lets a longer-lived singleton depend on a request-scoped bean while the actual target instance is resolved for the current request.

The mechanism itself is straightforward. The harder design question is what belongs in that scope.

During one HTTP request, several components may want to share values such as:

- a correlation ID;
- the request start time;
- diagnostic metadata;
- a calculation or lookup result that should be reused only within the current request.

Those values look like natural candidates because their lifetime is request-bound. But if every value that varies per request goes into the same bean, it quickly turns into request-local global state.

The practical conclusion is:

> A RequestScopeBean is useful for infrastructure state that naturally belongs to one request and is shared by a small number of boundary components. It should be avoided once it starts hiding business inputs or becoming a general-purpose storage object.

## First distinguish business input from request context

The first question is not where a value came from, but what the value means.

Values such as `productId`, `quantity`, or `searchCondition` can change a use-case result. Whether they came from a path variable, query parameter, or request body, they are business inputs and should usually remain visible in a method signature or an explicit command or context object.

Values such as `correlationId` or `requestStartedAt` are different when they are used only for logging, tracing, or diagnostics and intermediate business layers do not interpret them. Those values are much closer to request-scoped infrastructure context.

Request-local memoization is another useful example. If the same deterministic calculation or lookup is repeated during one request but has no reason to survive into the next request, a small request-scoped cache can express that lifetime more accurately than an application-wide cache.

That still does not mean the lookup result should become a hidden business dependency. "Cache this only for one request" and "hide this dependency from the use case" are separate decisions.

The useful question is not "did this value come from HTTP?" but "which layer needs to understand what this value means?"

## Parameter relay is not automatically bad

Consider a call chain like this.

~~~text
Controller
  -> Application Service
      -> Use Case
          -> Diagnostics Adapter
~~~

Suppose only the final Diagnostics Adapter needs a `correlationId` and request start time, while the intermediate layers do not use either value.

Adding those diagnostic values to every method can create signature noise whose only purpose is transportation. A RequestScopeBean can be one way to eliminate that relay.

But inconvenient parameters do not automatically belong in request scope.

Explicit parameters have important properties.

- The caller's obligations are visible.
- Tests depend less on hidden request state.
- Business inputs remain visible in the static structure of the code.
- Crossing an asynchronous or execution-context boundary makes required state transfer explicit.

And if a correlation ID exists only for logging or tracing, MDC or an observability framework's trace context may be a better fit than a custom RequestScopeBean.

So RequestScopeBean is not primarily a technique for "getting rid of parameters." It is a choice about where request-lifetime state belongs.

## Why putting request context into DTOs causes trouble

Another tempting approach is to mix server-side request information into a client-facing DTO.

For example, a request DTO may gradually acquire values that the client never sent:

- a correlation ID;
- the request start time;
- a server-derived diagnostic flag;
- internal metadata obtained from a request-local cache.

This is convenient because the DTO already travels through the application.

Over time, however, the DTO now represents two different things.

- Input supplied by the client
- Internal state created while the server processes the request

That makes provenance harder to see. Validation timing becomes less obvious, and it becomes unclear which fields belong to the transport contract and which are internal-only.

A DTO is easier to reason about when it keeps its original role: representing an external contract or an explicit use-case input.

## When RequestScopeBean fits well

A RequestScopeBean is worth considering when most of these conditions are true.

~~~text
1. The value or state belongs to exactly one HTTP request.
2. Intermediate business layers do not use it; they would only relay it.
3. Only a small number of boundary or infrastructure components consume it.
4. It is not a core business input.
5. Discarding it when the request ends is the natural lifecycle.
~~~

Relatively general examples include:

- request diagnostic context initialized by a Filter or Interceptor;
- correlation metadata used for error responses or audit records;
- a small memoization/cache that exists only for one request;
- request-derived rendering metadata used only at the web boundary.

The common property is that the state is created with the request and can disappear with the request.

Request-local caching is a particularly clear example. If one expensive operation is repeated several times during a request but there is no reason to retain its result for later requests, request scope can model the intended lifetime directly.

## When RequestScopeBean becomes dangerous

The design is drifting toward a request-local Service Locator or global state when patterns like these appear.

- General-purpose Services inject it directly.
- Mappers read from it.
- Validators depend on hidden request state.
- Repositories access request context.
- Most Clients retrieve values from the same bean.
- New fields are added whenever another argument feels inconvenient.
- Core business decision inputs move from method parameters into the bean.

At that point, method signatures stop describing real dependencies.

~~~java
public Result execute(Command command) {
    // The method appears to depend only on command,
    // but the result may also depend on hidden request-scoped state.
}
~~~

Tests also need request-scope infrastructure. Spring supports testing request-scoped beans, but those tests require web context such as a `WebApplicationContext` and mock request rather than being plain-object tests.

The design gained convenience by losing dependency visibility and test simplicity.

## Understand Spring's scoped proxy

Injecting a RequestScopeBean into a singleton Service or Controller does not make the Service itself request-scoped.

Spring can inject a scoped proxy when a shorter-lived request-scoped bean is used as a dependency of a longer-lived bean. `@RequestScope` is defined to use a class-based proxy by default.

Conceptually:

~~~text
Singleton Service
    -> Request-scoped proxy
        -> actual RequestContext instance for the current HTTP request
~~~

This mechanism is what makes a request-scoped dependency usable from a singleton bean.

But the existence of the proxy does not solve the design problem. Being able to inject the bean anywhere is not the same as having a good reason to inject it anywhere.

## Keep direct injection narrowly scoped

If a RequestScopeBean is used, the most important design rule is deciding which components may inject it directly.

A reasonable policy can look like this.

~~~text
Direct injection allowed
- Filter / Interceptor responsible for initialization
- boundary components that build error, audit, or diagnostic output
- a small helper that actually owns request-local memoization

Direct injection disallowed
- general Application / Domain Services
- Mappers
- Validators
- Repositories
- most outbound Clients
~~~

With this boundary, the bean remains a short bridge around the request edge instead of becoming a general storage mechanism.

If the context object keeps accumulating unrelated fields, that is a useful signal that the boundary is eroding.

## When an explicit context record is better

Parameter explosion can also be reduced without RequestScopeBean.

When related values move together through one processing pipeline and that flow should remain visible in code, an explicit context record is often a better fit.

~~~java
public record RequestExecutionContext(
        String correlationId,
        Instant startedAt
) {
}
~~~

This has useful properties.

- Dependencies remain visible in method signatures.
- Tests can construct an ordinary object without request-scope infrastructure.
- Values that must cross an asynchronous boundary can be chosen explicitly.
- The code records which values belong to one processing context.

If intermediate layers receive the record only to pass it through unchanged and only one or two request-edge components actually consume it, RequestScopeBean may again be worth considering.

The two approaches are not direct competitors. They trade dependency visibility against transport overhead.

## Treat asynchronous boundaries separately

In Servlet-based applications, current request information is commonly associated with the request-processing thread. Spring's `RequestContextHolder` also exposes `RequestAttributes` associated with the current thread.

That means code running in another executor, an asynchronous event, or a scheduler should not assume that request-scoped state will automatically follow it.

If an asynchronous task genuinely needs a value, copy that value into explicit data and pass it across the boundary.

This limitation is also a useful design signal: if the value still matters outside the request, it may not belong in hidden request-scoped state in the first place.

## A practical decision rule

The choice can be reduced to a few questions.

~~~text
Does the value change the business result?
→ Keep it as an explicit input.

Does the value still matter after the request ends?
→ Consider a model outside request scope.

Do intermediate layers actually use the value?
→ Prefer an explicit parameter or context object.

Do intermediate layers not care about it, while only a few request-edge components consume it?
→ Consider RequestScopeBean.

Do you only need to reuse the same calculation or lookup within one request?
→ Small request-local memoization can be a good candidate.

Is "passing another parameter is annoying" the main reason?
→ Do not use RequestScopeBean.

Are direct injection sites steadily increasing?
→ The design is probably crossing the intended boundary.
~~~

## Conclusion

RequestScopeBean is not inherently a bad design. It is a first-class Spring scope and is useful when state should genuinely have the same lifetime as one HTTP request.

Those benefits survive only while the scope of use remains narrow.

The key rule is:

> Request-scoped infrastructure state may be hidden, but business input dependencies should not be.

When introducing RequestScopeBean, the important architectural decision is not simply whether to use it. Decide which kinds of state are allowed in it and where direct injection must stop.

## References

- Spring Framework Reference: Bean Scopes — <https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html>
- Spring Framework API: RequestScope — <https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/annotation/RequestScope.html>
- Spring Framework Reference: Testing Request- and Session-scoped Beans — <https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/web-scoped-beans.html>
- Spring Framework API: RequestContextHolder — <https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/request/RequestContextHolder.html>
