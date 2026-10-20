import { describe, it, expect, vi, beforeEach } from "vitest";
import { responseEnvelope } from "../../../src/middleware/response-envelope.js";
import type { FastifyRequest, FastifyReply } from "fastify";

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    id: "req-123",
    url: "/api/v1/test",
    apiVersion: "v1",
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeReply(statusCode: number): FastifyReply {
  return { statusCode } as unknown as FastifyReply;
}

describe("responseEnvelope", () => {
  it("wraps a 2xx JSON response with meta", async () => {
    const req = makeRequest();
    const reply = makeReply(200);
    const input = JSON.stringify({ data: "hello" });

    const result = await responseEnvelope(req, reply, input);
    const parsed = JSON.parse(result as string);

    expect(parsed.data).toBe("hello");
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.requestId).toBe("req-123");
    expect(parsed.meta.version).toBe("v1");
    expect(typeof parsed.meta.timestamp).toBe("string");
  });

  it("does not double-wrap if meta already exists", async () => {
    const req = makeRequest();
    const reply = makeReply(200);
    const input = JSON.stringify({ data: "x", meta: { version: "v1", timestamp: "t", requestId: "r" } });

    const result = await responseEnvelope(req, reply, input);
    const parsed = JSON.parse(result as string);

    expect(parsed.meta.requestId).toBe("r");
  });

  it("passes through 4xx responses unchanged", async () => {
    const req = makeRequest();
    const reply = makeReply(400);
    const input = JSON.stringify({ error: "bad request" });

    const result = await responseEnvelope(req, reply, input);
    expect(result).toBe(input);
  });

  it("passes through 5xx responses unchanged", async () => {
    const req = makeRequest();
    const reply = makeReply(500);
    const input = JSON.stringify({ error: "internal" });

    const result = await responseEnvelope(req, reply, input);
    expect(result).toBe(input);
  });

  it("passes through non-JSON 2xx responses unchanged", async () => {
    const req = makeRequest();
    const reply = makeReply(200);
    const input = "%PDF-1.4 binary";

    const result = await responseEnvelope(req, reply, input);
    expect(result).toBe(input);
  });

  it("injects requestId from request.id", async () => {
    const req = makeRequest({ id: "unique-id-xyz" } as any);
    const reply = makeReply(201);
    const input = JSON.stringify({ created: true });

    const result = await responseEnvelope(req, reply, input);
    const parsed = JSON.parse(result as string);

    expect(parsed.meta.requestId).toBe("unique-id-xyz");
  });
});
