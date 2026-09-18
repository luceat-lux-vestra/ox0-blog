> In this article, "RequestScopeBean" is shorthand for a Spring bean annotated with [`@RequestScope`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/annotation/RequestScope.html).

Spring's request scope ties a bean instance to the lifetime of the current HTTP request. `@RequestScope` is the convenience annotation for declaring that scope, and it uses a [scoped proxy](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html#beans-factory-scopes-other-injection) by default. That lets a longer-lived singleton depend on a request-scoped bean while the actual target instance is resolved for the current request.

The mechanism itself is straightforward. The harder design question is what belongs in that scope.

During one HTTP request, many kinds of "current request information" may be needed. They are not all candidates for a RequestScopeBean.

- correlation IDs or diagnostic fields used only in logs → [MDC](https://www.slf4j.org/manual.html#mdc)
- trace state that crosses service boundaries → [Trace Context / Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- the current authenticated principal and authorities → Spring Security's [SecurityContext](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html#servlet-authentication-securitycontext)
- inputs that determine a use-case result → an Application Command or explicit parameters
- a stateful helper or memoizer that reuses a result for the same input only within one request → sometimes a RequestScopeBean

Request scope is therefore **not a general context store for anything that varies per request. It is a bean-lifecycle mechanism that ties one bean instance to one HTTP request.**

A more conservative conclusion is:

> Do not start with a RequestScopeBean as the default request-context store. Prefer more specific mechanisms such as MDC, Trace Context, SecurityContext, and explicit inputs. Consider a RequestScopeBean only when the bean itself needs independent per-request state or behavior and its natural lifetime is exactly one HTTP request.

## First distinguish business input from request context

The first question is not where a value came from, but what the value means.

Values such as `productId`, `quantity`, or `searchCondition` can change a use-case result. Whether they came from a path variable, query parameter, or request body, they are business inputs and should usually remain visible in a method signature or an explicit application command/use-case input object.

A value such as `correlationId` used only for log correlation is a better fit for MDC. Trace/span state that must cross service boundaries belongs in a standard propagation mechanism such as OpenTelemetry Context. Authentication state already has Spring Security's SecurityContext.

That means the useful split is not "business data vs RequestScopeBean." **If a dedicated context mechanism already exists, there is less reason to invent another request-scoped context bean.**

One remaining candidate is request-local memoization. If several components repeat the same expensive lookup during one request but the result must not be shared across requests, a small per-request memoizer can model that lifetime. But if the framework already offers a dedicated abstraction—Spring GraphQL's [DataLoader](https://docs.spring.io/spring-graphql/reference/request-execution.html#request-execution-dataloader) is one example—use that abstraction first.

The useful question becomes: **"Is there already a more precise mechanism for this responsibility, and does the object itself really need request-local state?"**

## What does Command mean here?

The word `Command` in this article does not mean the full [GoF Command Pattern](https://sourcemaking.com/design_patterns/command). Here it means an **application command or use-case input object that explicitly groups the intent and business inputs required by one application use case**.

That distinction matters because `Command` is used in several different contexts.

- **[DDD (Domain-Driven Design)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice)** is an approach for tackling complex business domains through explicit domain models. In a layered DDD description, the application layer coordinates use cases and delegates business-rule execution to the domain layer. DDD itself does not require every use case to be represented by a class named `Command`.
- **[CQRS (Command Query Responsibility Segregation)](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)** separates the model used for state-changing commands from the model used for queries. Microsoft's CQRS guidance recommends expressing commands as concrete business tasks or user intent rather than low-level field updates.
- The **GoF Command Pattern** encapsulates a request or operation as an object so invocation can be decoupled from the receiver, enabling execution concerns such as deferral, queuing, logging, or undo.

An Application Command is not mandatory either. If a use case has only a few inputs and a separate object adds no meaning, explicit method parameters may be enough. A command/use-case input object becomes useful when several business inputs form one cohesive use-case intent.

So an object like the following does not by itself mean that the application implements CQRS or the GoF Command Pattern.

~~~java
public record PlaceOrderCommand(
        CustomerId customerId,
        List<OrderLineInput> lines,
        DeliveryAddress deliveryAddress
) {
}
~~~

The important part is not the class name but its **responsibility**. Inputs that determine the outcome of the ordering use case remain explicit in the command. If a `correlationId` exists only for logging or tracing, putting it into `PlaceOrderCommand` merely to avoid relaying another value blurs that responsibility.

Conceptually, the split can look like this.

~~~text
HTTP DTO
    -> mapping
Application Command
    -> Application Service / Use Case

Log-only diagnostic data
    -> MDC

Distributed tracing context
    -> Trace Context / Propagator

Current authenticated principal and authorities
    -> SecurityContext

Small collaborator that truly needs independent per-request state
    -> RequestScopeBean only when needed
~~~

An application command and a RequestScopeBean are therefore not alternatives to each other. The more important rule is to **prefer the dedicated abstraction for each responsibility and keep RequestScopeBean close to the end of the decision process**.

## Parameter relay is not automatically bad

Consider a call chain like this.

~~~text
Controller
  -> Application Service
      -> Use Case
          -> Diagnostics Adapter
~~~

Suppose only the final Diagnostics Adapter needs a `correlationId`, while intermediate layers do not use it.

Relaying a diagnostic value through every method is awkward, but creating a RequestScopeBean is not the default solution. If the value exists only for log correlation, MDC is the more precise abstraction. If it belongs to distributed tracing, use Trace Context.

If the use case itself needs a value, hiding it because transportation is inconvenient is still the wrong trade. Explicit parameters and Application Commands have important properties.

- The caller's obligations are visible.
- Tests depend less on hidden request state.
- Business inputs remain visible in the static structure of the code.
- Crossing an asynchronous or execution-context boundary makes required state transfer explicit.

So **"intermediate layers do not use this value" is not enough to justify RequestScopeBean.** First check whether a dedicated mechanism already owns that responsibility.

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

### Thinking in terms of payload and envelope

Messaging patterns have long separated application payload from infrastructure metadata used for delivery, routing, or correlation. Enterprise Integration Patterns' [Envelope Wrapper](https://www.enterpriseintegrationpatterns.com/patterns/messaging/EnvelopeWrapper.html) and [Correlation Identifier](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html) are representative examples.

An HTTP request object is not literally the same thing as a messaging envelope, but the design question still helps: **is this value payload that the use case interprets, or metadata that the transport/infrastructure manages?**

An order quantity is close to payload. Pure tracing or correlation information is closer to infrastructure metadata. If both are indiscriminately pushed into one request DTO, the boundary between the transport contract and internal execution context becomes blurred again.

## So when is RequestScopeBean actually useful?

Once the alternatives are separated, the useful range is narrower than it first appears. It is worth considering when most of these conditions hold.

~~~text
1. The bean itself has state or behavior that should live for exactly one request.
2. Sharing that state with another request would be incorrect.
3. No more specific mechanism such as MDC, Trace Context, or SecurityContext owns the responsibility.
4. Consumers are limited to the web boundary or framework-integration layer.
5. The state does not need to survive asynchronous work or the end of the request.
~~~

### Real case 1: a request-dependent framework customizer

A [public springdoc-openapi issue](https://github.com/springdoc/springdoc-openapi/issues/2571) shows an MVC configuration that creates a request-scoped `ServerBaseUrlCustomizer` so the OpenAPI server base URL can depend on the reverse proxy's `X-Forwarded-Prefix` header for the current request.

This is a strong fit for request scope because:

- the value is not a business-use-case input;
- the **framework extension object itself** depends on the current HTTP request;
- request scope can make the collaborator's creation and disposal explicitly follow the current request;
- Application and Domain Services do not need to know about the customizer.

A singleton customizer is not automatically wrong; it can still be safe if it obtains the current request through a proper proxy or another context abstraction. The point of the example is narrower: **when a framework collaborator itself has request-dependent behavior, tying that collaborator's lifecycle to the request can be a natural design.**

### Real case 2: request-local memoization

Spring GraphQL DataLoader keeps loaded entities in a **per-request cache** and registers DataLoaders per request. The goal is to eliminate duplicate I/O inside one request without sharing cached data across requests or users.

That is not literally an `@RequestScope` bean, but it demonstrates a real lifecycle where request-scoped state is useful. In GraphQL, DataLoader is the dedicated abstraction and should be preferred. In ordinary Spring MVC code with the same deduplication need and no dedicated abstraction, a small request-scoped memoizer helper can be a reasonable implementation.

The limit matters: the memoizer should deduplicate repeated loads for keys that are already explicit. It should not become a hidden provider of business inputs.

### What about Spring's official LoginAction example?

[Spring Framework documentation](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/web-scoped-beans.html) uses a request-scoped `LoginAction` with request parameters to demonstrate request-scope semantics. That example is valid for showing that each HTTP request gets an isolated bean instance.

It does **not** need to be treated as a recommendation for modern authentication design. Username and password are not automatically ordinary business-use-case inputs. In Spring Security form login, [`UsernamePasswordAuthenticationFilter`](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/form.html) extracts them from the `HttpServletRequest`, creates a `UsernamePasswordAuthenticationToken`, and passes it to the [`AuthenticationManager`](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html#servlet-authentication-authenticationmanager). In that architecture, credentials belong to the **authentication boundary**, not to an ordinary Controller/Application Command by default.

If an application owns a custom login API or authentication use case, it may still model credentials as an explicit request/authentication input object. The important distinction remains: **explicitly modeling authentication input is different from hiding credentials inside a mutable request-scoped bean.**

An official example that demonstrates scope mechanics and an architectural recommendation for the authentication boundary are two different things.

## When RequestScopeBean becomes dangerous

The design is drifting toward request-local ambient/global state when patterns like these appear. Constructor injection alone does not make the bean a Service Locator; the problem is a generic "current request" object that hides data dependencies behind shared execution context.

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

Tests that exercise the actual request-scope wiring and lifecycle need request-scope infrastructure. Spring's [request-scoped bean testing](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/web-scoped-beans.html) uses a `WebApplicationContext` and mock request. That is a different test boundary from testing the bean's pure logic as an ordinary object.

As hidden request-state dependencies spread, more tests need that integration boundary, so the convenience should be weighed against dependency visibility and test setup cost.

## The Ambient Context perspective

The term **[Ambient Context](https://blog.ploeh.dk/2019/01/21/some-thoughts-on-anti-patterns/)** is useful for describing this risk. An ambient context is context that code can obtain from the current execution environment without the caller explicitly passing it. Static "current" contexts and thread-local state are common forms.

Mark Seemann classifies Ambient Context as an anti-pattern from a dependency-injection perspective. The central problem is that dependencies move outside the visible call structure, making the real inputs and dependencies harder to discover from the code.

That does not mean every RequestScopeBean is automatically an Ambient Context. If it is constructor-injected into a small set of boundary components, the object dependency itself is visible. However, when method results broadly depend on "current request" values inside that bean, the data dependency can disappear from the call signature. If current-context access through APIs such as [`RequestContextHolder`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/context/request/RequestContextHolder.html) also spreads through the application, the design takes on the more typical properties of Ambient Context.

The more precise warning sign is therefore not "does this application use request scope?" but **"did data or dependencies that should be explicit move behind shared current-execution context?"**

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
Possible direct consumers
- framework adapters / customizers whose behavior depends on the current request
- a small helper that actually owns request-local memoization

Normally not direct consumers
- general Application / Domain Services
- Mappers
- Validators
- Repositories
- most outbound Clients
~~~

If a Filter or Interceptor starts filling a generic "RequestContext bag," stop and classify the data again. Logging data may belong in MDC, tracing data in Trace Context, and authentication in SecurityContext.

This keeps RequestScopeBean as a **genuinely request-lifetime stateful collaborator** rather than a general storage mechanism.

If the context object keeps accumulating unrelated fields, that is a useful signal that the boundary is eroding.

## When an Application Command or explicit context record is better

Parameter explosion can also be reduced without RequestScopeBean. Start by classifying what the values mean.

~~~text
Business intent and inputs that determine the use-case result
→ Application Command

Diagnostic key-value data used only in logs
→ MDC

Trace context that crosses service/process boundaries
→ Trace Context / Context Propagation

Current authenticated principal and authorities
→ SecurityContext

Processing context that several layers actually understand and pass together
→ explicit Context record (a project-defined context object passed explicitly as a method argument)

A bean that itself needs independent per-request state and has no better dedicated abstraction
→ consider RequestScopeBean
~~~

It is also useful to distinguish **[Introduce Parameter Object](https://refactoring.com/catalog/introduceParameterObject.html)**. Martin Fowler's refactoring groups parameters that repeatedly travel together into one object. If `startDate` and `endDate` repeatedly appear as a pair, for example, they can become a `DateRange`.

The resulting code may look similar—a single record or value object—but the motivation differs.

~~~text
Parameter Object
→ structurally groups parameters that repeatedly travel together

Application Command
→ models the intent and business inputs of one use case

Context Object
→ explicitly carries processing context that several layers actually understand
~~~

An Application Command can group related business inputs around one use case. When related values instead move together through one processing pipeline and several layers should see that processing context explicitly, a context record is often a better fit.

For example, if several layers genuinely understand and use one cohesive execution concern such as a **deadline or execution policy**, the project can define an `ExecutionContext` and pass it explicitly as a method argument. Values that already belong to a dedicated mechanism, such as a log-only correlation ID, do not need to be collected into that object again.

This has useful properties.

- Dependencies remain visible in method signatures.
- Tests can construct an ordinary object without request-scope infrastructure.
- Values that must cross an asynchronous boundary can be chosen explicitly.
- The code records which values belong to one processing context.

If intermediate layers receive the record only to pass it through unchanged, first ask whether the data actually belongs in MDC, Trace Context, SecurityContext, or another dedicated context. Only after those options are ruled out—and the **object itself needs to be a request-local stateful collaborator**—should RequestScopeBean come back into consideration.

So this is not merely a trade between dependency visibility and transport overhead. The first question is whether a more specific abstraction already exists.

## Treat asynchronous boundaries and Context Propagation separately

In Servlet-based applications, current request information is commonly associated with the request-processing thread. Spring's `RequestContextHolder` also exposes `RequestAttributes` associated with the current thread.

That means code running in another executor, an asynchronous event, or a scheduler should not assume that request-scoped state will automatically follow it.

If an asynchronous task genuinely needs a value, copy that value into explicit data and pass it across the boundary.

A related but distinct concern is **Context Propagation**. OpenTelemetry defines Context as a mechanism for carrying execution-scoped values across logically associated execution units, and propagation as the mechanism that moves that context across service or process boundaries. Trace IDs and span IDs are typical examples in distributed tracing.

So if a value such as a correlation identifier must continue across service boundaries for observability, a standard trace context and [Propagator](https://opentelemetry.io/docs/specs/otel/context/api-propagators/) should usually be considered before inventing propagation around a RequestScopeBean. RequestScopeBean models **request lifetime inside the current process**; Context Propagation addresses **how context crosses execution boundaries**.

Facilities such as OpenTelemetry [Baggage](https://opentelemetry.io/docs/concepts/signals/baggage/) can propagate arbitrary key-value data as well, but convenience is not a reason to place business data or sensitive information there indiscriminately. Baggage can travel to downstream or external services, so propagation scope and data sensitivity require separate control.

This limitation is also a useful design signal: if the value still matters outside the request, ask whether it is explicit application input, request-local state, or a standard propagation concern rather than automatically hiding it in request scope.

## A practical decision rule

Use this order to avoid selecting RequestScopeBean too early.

~~~text
Does the value change an application business-use-case result?
→ Application Command or explicit parameter.

Is it diagnostic data used only in logs?
→ MDC.

Is it observability context that must cross service boundaries?
→ Trace Context / Context Propagation.

Is it the current authenticated principal or authorities?
→ SecurityContext.

Does the framework already provide a request-specific context abstraction?
→ Prefer that abstraction.

Are you deduplicating repeated loads only within one request?
→ Use a dedicated tool such as DataLoader when available.
→ Otherwise consider a small request-scoped memoizer.

Does the bean itself need mutable state or behavior isolated per request?
→ RequestScopeBean can be a candidate.

Is the main reason simply that passing values through methods is annoying?
→ Do not use RequestScopeBean.

Is the bean turning into a Map/DTO-like bag of "current request information"?
→ Split the responsibilities again.
~~~

## Conclusion

Once the responsibilities are separated, RequestScopeBean has a fairly narrow practical range. That is not a defect. Spring request scope is **a bean-lifecycle feature, not a pattern telling applications to store all request information in one place.**

Most common needs already have more specific tools.

- business input → Application Command / explicit parameter
- log correlation → MDC
- distributed tracing → Trace Context / Context Propagation
- current authenticated principal/authorities → SecurityContext
- framework-specific per-request cache/context → the framework's own abstraction

If the remaining requirement is genuinely **"this Spring bean itself must exist as an independent stateful collaborator for exactly one HTTP request,"** then RequestScopeBean is meaningful. A request-dependent framework customizer and a small request-local memoizer without a better dedicated abstraction are representative cases.

The final rule is therefore:

> Do not start with RequestScopeBean as a request-context store. First look for the dedicated abstraction for the responsibility, and choose request scope only when the bean's own lifetime should match the HTTP request.

## References

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
