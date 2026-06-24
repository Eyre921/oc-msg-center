import { pino } from "pino";

export function createLogger(level: string) {
  const pretty = process.env.NODE_ENV !== "production" && process.stdout.isTTY;
  return pino({
    level,
    transport: pretty
      ? { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
