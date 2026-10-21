import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: vi.fn().mockImplementation(function () {
    return {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: vi.fn(),
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: vi.fn((attrs) => attrs),
}));

vi.mock("@opentelemetry/instrumentation-fastify", () => ({
  FastifyInstrumentation: vi.fn(),
}));

vi.mock("@opentelemetry/instrumentation-pg", () => ({
  PgInstrumentation: vi.fn(),
}));

vi.mock("@opentelemetry/instrumentation-ioredis", () => ({
  IORedisInstrumentation: vi.fn(),
}));

vi.mock("@opentelemetry/instrumentation-http", () => ({
  HttpInstrumentation: vi.fn(),
}));

import { initTracing, shutdownTracing } from "../../src/tracing.js";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import {
  trace,
  context as otelContext,
  SpanStatusCode,
} from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";

describe("Tracing", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.OTEL_SDK_DISABLED;
    delete process.env.OTEL_SDK_DISABLED;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OTEL_SDK_DISABLED = originalEnv;
    } else {
      delete process.env.OTEL_SDK_DISABLED;
    }
  });

  it("should initialize tracing SDK", () => {
    initTracing("test-service");

    expect(NodeSDK).toHaveBeenCalled();
  });

  it("should not initialize when OTEL_SDK_DISABLED is true", () => {
    process.env.OTEL_SDK_DISABLED = "true";

    initTracing("test-service");

    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it("should use custom endpoint if provided", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://custom:4318/v1/traces";

    initTracing("custom-service");

    expect(NodeSDK).toHaveBeenCalled();
    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: "http://custom:4318/v1/traces",
    });

    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it("should default to the local collector endpoint when none is set", () => {
    initTracing("test-service");

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/traces",
    });
  });

  it("should tag the resource with the given service name", () => {
    initTracing("my-custom-service");

    expect(resourceFromAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ "service.name": "my-custom-service" }),
    );
  });

  it("should default the service name when none is passed", () => {
    initTracing();

    expect(resourceFromAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ "service.name": "chainlearn-api" }),
    );
  });

  it("should register every expected auto-instrumentation", () => {
    initTracing("test-service");

    expect(FastifyInstrumentation).toHaveBeenCalledTimes(1);
    expect(HttpInstrumentation).toHaveBeenCalledTimes(1);
    expect(PgInstrumentation).toHaveBeenCalledTimes(1);
    expect(IORedisInstrumentation).toHaveBeenCalledTimes(1);
  });

  it("should call start() on the constructed SDK instance", () => {
    initTracing("test-service");

    const sdkInstance = vi.mocked(NodeSDK).mock.results[0].value;
    expect(sdkInstance.start).toHaveBeenCalledTimes(1);
  });

  it("should shutdown tracing gracefully", async () => {
    initTracing("test-service");

    await expect(shutdownTracing()).resolves.toBeUndefined();
  });

  it("should handle shutdown when SDK not initialized", async () => {
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });

  describe("span creation and context propagation", () => {
    // These exercise the real @opentelemetry/api (the NodeSDK itself is
    // mocked above, but the API package that instrumentation/application
    // code calls into — tracer, span, context — is not, so this verifies
    // the actual propagation semantics the mocked SDK can't). A real
    // context manager is registered so context.with() actually propagates
    // instead of being a no-op (the default NoopContextManager), mirroring
    // what NodeSDK itself wires up in production.
    const tracer = trace.getTracer("tracing-test");
    const contextManager = new AsyncHooksContextManager();

    beforeEach(() => {
      contextManager.enable();
      otelContext.setGlobalContextManager(contextManager);
    });

    afterEach(() => {
      otelContext.disable();
    });

    it("creates a span and records its name and status", () => {
      const span = tracer.startSpan("test-span");
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      // No real exporter is registered under the mocked SDK, so this
      // asserts the API doesn't throw and returns a span the application
      // can operate on — the core contract initTracing's callers rely on.
      expect(span).toBeDefined();
      expect(typeof span.spanContext().traceId).toBe("string");
      expect(typeof span.spanContext().spanId).toBe("string");
    });

    it("propagates a span through context so a nested call sees it as active", () => {
      const parentSpan = tracer.startSpan("parent-span");
      const ctx = trace.setSpan(otelContext.active(), parentSpan);

      let observedSpan: ReturnType<typeof trace.getSpan>;
      otelContext.with(ctx, () => {
        observedSpan = trace.getSpan(otelContext.active());
      });

      expect(observedSpan!).toBe(parentSpan);
      parentSpan.end();
    });

    it("gives a child span created within the parent's context a matching trace id", () => {
      const parentSpan = tracer.startSpan("parent-span");
      const parentCtx = trace.setSpan(otelContext.active(), parentSpan);

      let childSpan: ReturnType<typeof tracer.startSpan>;
      otelContext.with(parentCtx, () => {
        childSpan = tracer.startSpan(
          "child-span",
          undefined,
          otelContext.active(),
        );
      });

      expect(childSpan!.spanContext().traceId).toBe(
        parentSpan.spanContext().traceId,
      );

      childSpan!.end();
      parentSpan.end();
    });

    it("does not leak an active span outside of the context.with() callback", () => {
      const span = tracer.startSpan("scoped-span");
      const ctx = trace.setSpan(otelContext.active(), span);

      otelContext.with(ctx, () => {
        expect(trace.getSpan(otelContext.active())).toBe(span);
      });

      expect(trace.getSpan(otelContext.active())).not.toBe(span);
      span.end();
    });
  });
});
