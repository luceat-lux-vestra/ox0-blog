> In this article, "RequestScopeBean" means a request-scoped context bean implemented with Spring's @RequestScope.

During a single HTTP request, several layers may need access to common request information: a request identifier, the calling application, a country code, or a routing-specific site code. These values originate at the request boundary, but they do not always belong to the business DTO itself.

That usually leaves three choices.

1. Keep passing the values through method parameters.
2. Add them to a request DTO or shared BaseRequest object.
3. Store them in a Spring request-scoped bean and inject that bean where needed.

A RequestScopeBean appears to solve both DTO pollution and long parameter relay chains. The problem is that this convenience is easy to overuse. Without a strict boundary, the bean becomes request-local global state.

The practical conclusion is simple.

> A RequestScopeBean is useful for sharing request-scoped infrastructure context across a small number of boundary components, but it should be avoided once it starts hiding business inputs or becoming a general-purpose request storage object.

## First distinguish business input from request context

The first question is not where a value came from, but what the value means.

A countryCode arriving in an HTTP header does not automatically make it request infrastructure. If pricing policy changes by country and the value changes the result of a use case, it is effectively a business input. It should usually remain visible in a method signature or in an explicit command or context object.

A requestId used only for logging, tracing, or correlation with downstream calls is different. Intermediate service layers usually do not interpret it. That makes it much closer to request-scoped infrastructure context.

The useful distinction is therefore not "HTTP-derived versus not HTTP-derived." It is "which layer needs to understand the meaning of this value?"

## Parameter relay is not automatically bad

Consider a call chain like this.

~~~text
Controller
  -> Application Service
      -> Domain Service
          -> External Provider
~~~

Suppose only the final Provider needs a siteCode and the intermediate three layers merely forward it. Adding siteCode to every method can become signature noise created only to transport a value.

That does not mean every inconvenient parameter belongs in RequestScopeBean.

Explicit parameters have important properties.

- The caller's obligations are visible.
- Tests do not depend on hidden request context.
- Business inputs remain visible in the static structure of the code.
- Crossing an asynchronous or execution-context boundary makes state transfer explicit.

The cost of parameter relay therefore has to be weighed against the value of explicit dependencies.

## Why putting request context into DTOs causes trouble

Another tempting approach is to inject server-side request information into the DTO itself.

For example, requestId, authentication results, or internal routing values that were never sent by the client may be added to BaseRequest and populated by a Filter, Interceptor, or Advice.

This is convenient because the DTO already travels through the application.

Over time, however, the DTO now represents two different things.

- Input supplied by the client
- Internal context calculated or injected by the server

That makes provenance harder to see. Validation timing becomes less obvious, and it becomes unclear which fields belong to the transport contract and which are internal-only.

A DTO is easier to reason about when it keeps its original role: representing an external contract or explicit use-case input.

## When RequestScopeBean fits well

A RequestScopeBean is worth considering when most of these conditions are true.

~~~text
1. The value belongs to exactly one request.
2. Intermediate layers do not use it; they would only relay it.
3. Only a small number of infrastructure-oriented components consume it.
4. It is not a core input to the business use case.
5. Putting it in the DTO would blur external input and internal context.
~~~

Typical consumers might include:

- a Filter or Interceptor that initializes request context;
- a Resolver that determines an outbound integration route;
- a Provider that propagates tracing information;
- a logging or correlation component at an infrastructure boundary.

The important property is that the number of consumers stays small and their responsibilities stay clear.

## When RequestScopeBean becomes dangerous

The design is drifting toward a request-local Service Locator or global state when patterns like these appear.

- General-purpose Services inject it directly.
- Mappers read from it.
- Validators depend on hidden request state.
- Repositories access request context.
- Most outbound Clients retrieve values from the same bean.
- New fields are added whenever passing another parameter feels inconvenient.

At that point, method signatures stop describing real dependencies.

~~~java
public Result execute(Command command) {
    // The method appears to depend only on command,
    // but it also depends on request-scoped state.
}
~~~

Tests now need request-scope setup, and asynchronous execution or thread changes introduce lifecycle concerns.

The code gained convenience by losing dependency visibility.

## Keep direct injection narrowly scoped

If a RequestScopeBean is used, the most important design rule is deciding which components may inject it directly.

A reasonable policy can look like this.

~~~text
Direct injection allowed
- Filter / Interceptor responsible for initialization
- One or two Providers / Resolvers that actually consume the values

Direct injection disallowed
- General Services
- Mappers
- Validators
- Repositories
- Most Clients
~~~

With this boundary, the bean remains a short bridge between request-edge infrastructure components instead of becoming a general storage mechanism.

The context object should also stay small. If it continually accumulates unrelated fields, that is evidence that the boundary is eroding.

## When an explicit context record is better

Parameter explosion can also be reduced without RequestScopeBean.

When several related values move together through one processing pipeline and the flow itself should remain visible in code, an explicit context record is often a better choice.

~~~java
public record RoutingContext(
        String appId,
        String countryCode,
        String siteCode,
        String requestId
) {
}
~~~

This has useful properties.

- Dependencies remain in method signatures.
- Tests can construct a normal object without request-scope infrastructure.
- The context can cross request scope if the design requires it.
- The values that form one processing context are explicit.

If intermediate layers receive this record only to pass it onward unchanged, RequestScopeBean may again become worth considering.

The two approaches are therefore not direct competitors. They trade dependency visibility against transport overhead.

## A practical decision rule

The choice can be reduced to a few questions.

~~~text
Does the value change the business result?
→ Keep it as an explicit input.

Do intermediate layers actually use the value?
→ Prefer an explicit parameter or context object.

Do intermediate layers not care about it, while only a few request-edge components consume it?
→ Consider RequestScopeBean.

Is "passing another parameter is annoying" the main reason?
→ Do not use RequestScopeBean.

Are direct injection sites steadily increasing?
→ The design is probably crossing the intended boundary.
~~~

## Conclusion

RequestScopeBean is not inherently a bad design. Its lifecycle matches one request, it can keep internal context out of external DTOs, and it can eliminate meaningless parameter relay.

Those benefits survive only while the scope of use remains narrow.

The key rule is:

> Request-scoped infrastructure context may be hidden, but business input dependencies should not be.

When introducing RequestScopeBean, the important architectural decision is not simply whether to use it. It is deciding where its use must stop.


## Reference

- Spring Framework Reference: Bean Scopes — <https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html>
