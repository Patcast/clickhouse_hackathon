import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AnalyticsStore } from "./analytics.js";
import {
  passageFacadeDocumentSchema,
  resultSubmissionSchema,
  selectPassageRequestSchema,
  sessionFacadeSubmissionSchema,
  userIdSchema,
  userInfoUpsertRequestSchema,
} from "./contract.js";
import {
  IdempotencyConflictError,
  InvalidSubmissionError,
  NoEligiblePassageError,
  ResultConflictError,
  SessionNotFoundError,
  type PassageRepository,
} from "./repository.js";

export function createApp(options: {
  repository: PassageRepository;
  repositoryMode: "memory" | "postgres";
  analytics?: AnalyticsStore;
  corsOrigins?: string[];
  logger?: boolean;
  serveTeamLab?: boolean;
  teamLabAccessToken?: string;
  secureTeamLabCookie?: boolean;
}, instance?: FastifyInstance): FastifyInstance {
  const app = instance ?? Fastify({ logger: options.logger ?? false });
  void app.register(cors, {
    origin: options.corsOrigins?.length ? options.corsOrigins : true,
    methods: ["GET", "HEAD", "POST", "PUT", "OPTIONS"],
  });

  if (options.teamLabAccessToken) {
    const accessToken = options.teamLabAccessToken;
    app.addHook("onRequest", async (request, reply) => {
      const pathname = request.url.split("?", 1)[0] ?? request.url;
      const requiresAccess =
        pathname === "/health" ||
        (pathname.startsWith("/api/") && pathname !== "/api/team-lab/auth");
      if (!requiresAccess) return;

      const sessionToken = readCookie(
        request.headers.cookie,
        "read_to_play_team_lab",
      );
      if (!sessionToken || !tokensMatch(sessionToken, accessToken)) {
        return reply.code(401).send({
          error: {
            code: "TEAM_LAB_AUTH_REQUIRED",
            message: "A valid team-lab access link is required",
          },
        });
      }
    });

    app.post("/api/team-lab/auth", async (request, reply) => {
      const submitted = (request.body as { token?: unknown } | undefined)?.token;
      if (typeof submitted !== "string" || !tokensMatch(submitted, accessToken)) {
        return reply.code(401).send({
          error: {
            code: "TEAM_LAB_AUTH_INVALID",
            message: "The team-lab access link is invalid or expired",
          },
        });
      }

      reply.headers({
        "cache-control": "no-store",
        "set-cookie": [
          `read_to_play_team_lab=${encodeURIComponent(accessToken)}`,
          "Path=/",
          "HttpOnly",
          "SameSite=Strict",
          "Max-Age=28800",
          ...(options.secureTeamLabCookie ? ["Secure"] : []),
        ].join("; "),
      });
      return reply.code(204).send();
    });
  }
  if (options.serveTeamLab) {
    void app.register(fastifyStatic, {
      root: fileURLToPath(new URL("../web", import.meta.url)),
      prefix: "/",
    });
  }

  app.get("/health", async () => {
    const operationalProbe = await Promise.allSettled([
      options.repository.healthCheck?.() ??
        Promise.resolve({ readingEventCount: 0 }),
    ]);
    const analyticsProbe = options.analytics
      ? await Promise.allSettled([
          options.analytics.healthCheck?.() ??
            Promise.reject(new Error("Analytics health check unavailable")),
        ])
      : [];
    const operational = operationalProbe[0];
    const analytics = analyticsProbe[0];
    const operationalReachable = operational?.status === "fulfilled";
    const analyticsReachable = analytics?.status === "fulfilled";
    const cloudReady =
      options.repositoryMode === "postgres" &&
      operationalReachable &&
      Boolean(options.analytics) &&
      analyticsReachable;

    return {
      status: cloudReady || options.repositoryMode === "memory" ? "ok" : "degraded",
      operationalStore: options.repositoryMode,
      analyticsStore: options.analytics ? "clickhouse" : "not-configured",
      checks: {
        operationalStore: {
          status: operationalReachable ? "reachable" : "unreachable",
          ...(operational?.status === "fulfilled"
            ? { readingEventCount: operational.value.readingEventCount }
            : {}),
        },
        analyticsStore: options.analytics
          ? {
              status: analyticsReachable ? "reachable" : "unreachable",
              ...(analytics?.status === "fulfilled"
                ? {
                    replicatedEventCount:
                      analytics.value.replicatedEventCount,
                  }
                : {}),
            }
          : { status: "not-configured" },
      },
      schemaVersion: "1.0",
    };
  });

  app.get("/api/v1/user-info", async (request, reply) => {
    const query = request.query as { userId?: unknown };
    const parsed = userIdSchema.safeParse(query.userId);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "userId is required",
          details: parsed.error.flatten(),
        },
      });
    }
    const user = await options.repository.getUserInfo(parsed.data);
    if (!user) {
      return reply.code(404).send({
        error: { code: "USER_NOT_FOUND", message: "User profile not found" },
      });
    }
    reply.header("cache-control", "no-store");
    return { schemaVersion: "1.0", user };
  });

  app.post("/api/v1/user-info", async (request, reply) => {
    const parsed = userInfoUpsertRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "User profile is invalid",
          details: parsed.error.flatten(),
        },
      });
    }
    const user = await options.repository.upsertUserInfo(parsed.data);
    reply.header("cache-control", "no-store");
    return reply.code(200).send({ schemaVersion: "1.0", user });
  });

  app.get("/api/v1/passage", async (request, reply) => {
    const query = request.query as { userId?: unknown };
    const parsedUserId = userIdSchema.safeParse(query.userId);
    if (!parsedUserId.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "userId is required",
          details: parsedUserId.error.flatten(),
        },
      });
    }
    const user = await options.repository.getUserInfo(parsedUserId.data);
    if (!user) {
      return reply.code(404).send({
        error: { code: "USER_NOT_FOUND", message: "User profile not found" },
      });
    }
    const rawKey = request.headers["idempotency-key"];
    if (typeof rawKey !== "string" || !rawKey.trim()) {
      return reply.code(400).send({
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Idempotency-Key is required for passage assignment",
        },
      });
    }
    const idempotencyKey = rawKey.trim();
    const profile = user.readingProfile;
    try {
      const outcome = await options.repository.selectAndAssign(
        {
          schemaVersion: "1.0",
          childId: user.id,
          readingBand: {
            system: "lexile",
            min: profile.lexileBand.min,
            target: profile.lexileBand.target,
            max: profile.lexileBand.max,
          },
          preferences: {
            categories: profile.preferredCategories,
            topics: profile.preferredTopics,
            fleschKincaidGrade: profile.fleschKincaidGrade,
            daleChall: profile.daleChall,
          },
          excludePassageIds: [],
        },
        idempotencyKey,
      );
      const { sessionId: _sessionId, childId, ...document } = outcome.document;
      const facade = passageFacadeDocumentSchema.parse({
        ...document,
        userId: childId,
      });
      reply.header("cache-control", "no-store");
      reply.header("x-idempotent-replay", String(outcome.replayed));
      return reply.code(200).send(facade);
    } catch (error) {
      if (error instanceof NoEligiblePassageError) {
        return reply.code(422).send({
          error: { code: "NO_ELIGIBLE_PASSAGE", message: error.message },
        });
      }
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({
          error: { code: "IDEMPOTENCY_CONFLICT", message: error.message },
        });
      }
      throw error;
    }
  });

  app.post("/api/v1/session", async (request, reply) => {
    const parsed = sessionFacadeSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Session document is invalid",
          details: parsed.error.flatten(),
        },
      });
    }
    try {
      const outcome = await options.repository.submitUserResult(parsed.data);
      const receipt = outcome.receipt;
      return reply.code(outcome.replayed ? 200 : 201).send({
        schemaVersion: receipt.schemaVersion,
        status: receipt.status,
        receivedAt: receipt.receivedAt,
        summary: receipt.summary,
        analyticsSyncStatus: receipt.analyticsSyncStatus,
      });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return reply.code(404).send({
          error: { code: "SESSION_NOT_FOUND", message: error.message },
        });
      }
      if (error instanceof ResultConflictError) {
        return reply.code(409).send({
          error: { code: "RESULT_CONFLICT", message: error.message },
        });
      }
      if (error instanceof InvalidSubmissionError) {
        return reply.code(422).send({
          error: { code: "INVALID_RESULT", message: error.message },
        });
      }
      throw error;
    }
  });

  app.post("/api/v1/passages/select", async (request, reply) => {
    const parsed = selectPassageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Selection request is invalid",
          details: parsed.error.flatten(),
        },
      });
    }

    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey =
      typeof rawKey === "string" && rawKey.trim()
        ? rawKey.trim()
        : crypto.randomUUID();

    try {
      const outcome = await options.repository.selectAndAssign(
        parsed.data,
        idempotencyKey,
      );
      reply.header("x-idempotent-replay", String(outcome.replayed));
      return reply.code(200).send(outcome.document);
    } catch (error) {
      if (error instanceof NoEligiblePassageError) {
        return reply.code(422).send({
          error: {
            code: "NO_ELIGIBLE_PASSAGE",
            message: error.message,
          },
        });
      }
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message: error.message,
          },
        });
      }
      throw error;
    }
  });

  app.put<{ Params: { sessionId: string } }>(
    "/api/v1/reading-sessions/:sessionId/result",
    async (request, reply) => {
      const parsed = resultSubmissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Result document is invalid",
            details: parsed.error.flatten(),
          },
        });
      }

      if (parsed.data.sessionId !== request.params.sessionId) {
        return reply.code(400).send({
          error: {
            code: "SESSION_ID_MISMATCH",
            message: "Path sessionId must match the result document",
          },
        });
      }

      try {
        const outcome = await options.repository.submitResult(
          request.params.sessionId,
          parsed.data,
        );
        return reply.code(outcome.replayed ? 200 : 201).send(outcome.receipt);
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          return reply.code(404).send({
            error: { code: "SESSION_NOT_FOUND", message: error.message },
          });
        }
        if (error instanceof ResultConflictError) {
          return reply.code(409).send({
            error: { code: "RESULT_CONFLICT", message: error.message },
          });
        }
        if (error instanceof InvalidSubmissionError) {
          return reply.code(422).send({
            error: { code: "INVALID_RESULT", message: error.message },
          });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { childId: string } }>(
    "/api/v1/analytics/children/:childId/progress",
    async (request, reply) => {
      if (!options.analytics) {
        return reply.code(503).send({
          error: {
            code: "ANALYTICS_NOT_CONFIGURED",
            message: "Configure ClickHouse after the CDC destination is ready",
          },
        });
      }
      return {
        childId: request.params.childId,
        days: await options.analytics.childProgress(request.params.childId),
      };
    },
  );

  return app;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const prefix = `${name}=`;
  const encoded = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (encoded === undefined) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function tokensMatch(submitted: string, expected: string): boolean {
  const submittedBytes = Buffer.from(submitted);
  const expectedBytes = Buffer.from(expected);
  return (
    submittedBytes.length === expectedBytes.length &&
    timingSafeEqual(submittedBytes, expectedBytes)
  );
}
