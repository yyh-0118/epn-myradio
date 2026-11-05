import type { FastifyRequest } from "fastify";
import type { JsonObject } from "../../src/types/analysis";

export function readRequestId(request: FastifyRequest): string {
  return readHeader(request.headers["x-request-id"]) ?? createId("request");
}

export function readTraceId(request: FastifyRequest): string {
  return readHeader(request.headers["x-trace-id"]) ?? readRequestId(request);
}

export function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function logRequestEvent(
  request: FastifyRequest,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  details: JsonObject = {},
): void {
  request.log[level](
    {
      ...details,
      requestId: readRequestId(request),
      traceId: readTraceId(request),
    },
    message,
  );
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
