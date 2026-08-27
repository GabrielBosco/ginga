import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Rota nao encontrada" });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, details: error.details });
  }

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path?.[0] ? String(issue.path[0]) : undefined;
    const message = issue?.message && issue.message !== "Invalid input"
      ? issue.message
      : "Revise os dados informados e tente novamente.";
    return res.status(400).json({ error: message, field, details: error.flatten() });
  }

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "Arquivo acima do limite permitido" : error.message;
    return res.status(400).json({ error: message });
  }

  const requestId = String(res.getHeader("X-Request-Id") || req.headers["x-request-id"] || "");
  console.error("[API 500]", {
    method: req.method,
    path: req.originalUrl,
    requestId: requestId || undefined,
    error
  });
  return res.status(500).json({ error: "Erro interno do servidor", requestId: requestId || undefined });
}
