import Fastify from "fastify";
import { createRuntime } from "./src/runtime.js";

const { app } = createRuntime(Fastify({ logger: true }));

void app.listen({
  host: "0.0.0.0",
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
});
