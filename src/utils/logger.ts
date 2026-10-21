import pino from "pino";
import { getRequestId } from "./request-context.js";

// Reads process.env.NODE_ENV directly rather than importing config/index.ts:
// that module imports this one (to log its own validation warnings/errors),
// so importing config here would form a cycle — ESM leaves the not-yet-
// initialized `config` export as undefined partway through that cycle,
// which crashed every request (and every test, since buildApp() creates a
// logger on every call) before config had finished evaluating.
const nodeEnv = process.env.NODE_ENV ?? "development";

export const logger = pino({
  level: nodeEnv === "production" ? "info" : nodeEnv === "test" ? "silent" : "debug",
  transport:
    nodeEnv !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  serializers: {
    req(request) {
      return { method: request.method, url: request.url };
    },
    res(reply) {
      return { statusCode: reply.statusCode };
    },
  },
  // #287: every log line written through this shared logger — which is
  // nearly all of them; `request.log` is used almost nowhere in this
  // codebase — automatically picks up the current request's ID from the
  // AsyncLocalStorage context server.ts populates on every request. This
  // covers call sites that don't explicitly pass `requestId` today without
  // having to touch each one individually. An explicit `requestId` in the
  // log call's own fields still wins (pino merges the mixin object first,
  // then the call's fields on top).
  mixin() {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },
});
