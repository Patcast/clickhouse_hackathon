import { createRuntime } from "./runtime.js";

const runtime = createRuntime();

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
await runtime.app.listen({ host, port });

process.once("SIGINT", () => void runtime.close());
process.once("SIGTERM", () => void runtime.close());
