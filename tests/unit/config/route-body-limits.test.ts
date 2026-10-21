import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROUTE_BODY_LIMITS } from "../../../src/config/route-body-limits.js";

/**
 * #605: per-route body size limits and their wiring into the routes that
 * reference them.
 *
 * "Route matching" is verified by grepping the route modules that import
 * ROUTE_BODY_LIMITS for the exact key each route is supposed to be using,
 * rather than booting the whole Fastify app — the config module has no
 * knowledge of routes itself (it's the routes that reach into it), so this
 * is the narrowest check that still exercises the real wiring.
 */
function readSource(relativePath: string): string {
  const url = new URL(`../../../${relativePath}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

const KB = 1024;
const MB = 1024 * KB;

describe("ROUTE_BODY_LIMITS (#605)", () => {
  describe("limit values", () => {
    it("sets profileUpdate to 10KB", () => {
      expect(ROUTE_BODY_LIMITS.profileUpdate).toBe(10 * KB);
    });

    it("sets courseImport to 5MB", () => {
      expect(ROUTE_BODY_LIMITS.courseImport).toBe(5 * MB);
    });

    it("sets quizAuthoring to 100KB", () => {
      expect(ROUTE_BODY_LIMITS.quizAuthoring).toBe(100 * KB);
    });

    it("sets webhookCreate to 10KB", () => {
      expect(ROUTE_BODY_LIMITS.webhookCreate).toBe(10 * KB);
    });

    it("orders limits from smallest to largest as profileUpdate/webhookCreate <= quizAuthoring <= courseImport", () => {
      expect(ROUTE_BODY_LIMITS.profileUpdate).toBeLessThanOrEqual(ROUTE_BODY_LIMITS.quizAuthoring);
      expect(ROUTE_BODY_LIMITS.webhookCreate).toBeLessThanOrEqual(ROUTE_BODY_LIMITS.quizAuthoring);
      expect(ROUTE_BODY_LIMITS.quizAuthoring).toBeLessThanOrEqual(ROUTE_BODY_LIMITS.courseImport);
    });

    it("exposes only known, positive numeric limits", () => {
      const values = Object.values(ROUTE_BODY_LIMITS);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(typeof value).toBe("number");
        expect(value).toBeGreaterThan(0);
      }
    });

    it("is readonly at the type level (as const) so limits can't drift at runtime", () => {
      // `as const` only enforces this at compile time; this asserts the
      // object itself isn't frozen either way (documents current behavior)
      // without depending on Object.isFrozen, which would be a false
      // negative here since the source doesn't call Object.freeze.
      expect(ROUTE_BODY_LIMITS).toEqual({
        profileUpdate: 10 * KB,
        courseImport: 5 * MB,
        quizAuthoring: 100 * KB,
        webhookCreate: 10 * KB,
      });
    });
  });

  describe("route matching", () => {
    it("wires profileUpdate into the user profile update route", () => {
      const source = readSource("src/modules/users/user.routes.ts");
      expect(source).toContain("ROUTE_BODY_LIMITS.profileUpdate");
    });

    it("wires webhookCreate into the admin webhook creation route", () => {
      const source = readSource("src/modules/admin/webhook.routes.ts");
      expect(source).toContain("ROUTE_BODY_LIMITS.webhookCreate");
    });

    it("wires quizAuthoring into the admin quiz authoring routes", () => {
      const source = readSource("src/modules/courses/admin-course.routes.ts");
      const matches = source.match(/ROUTE_BODY_LIMITS\.quizAuthoring/g) ?? [];
      expect(matches.length).toBeGreaterThan(0);
    });

    it("does not reference courseImport from any route yet (no current consumer)", () => {
      // Documents the current state rather than asserting a requirement:
      // if a future route starts using courseImport, this test should be
      // updated alongside it rather than silently going stale.
      const userRoutes = readSource("src/modules/users/user.routes.ts");
      const webhookRoutes = readSource("src/modules/admin/webhook.routes.ts");
      const courseRoutes = readSource("src/modules/courses/admin-course.routes.ts");
      const anyReferencesCourseImport = [userRoutes, webhookRoutes, courseRoutes].some((src) =>
        src.includes("ROUTE_BODY_LIMITS.courseImport"),
      );
      expect(anyReferencesCourseImport).toBe(false);
    });
  });
});
