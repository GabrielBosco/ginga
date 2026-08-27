import type { AuthPayload } from "../auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      botAuth?: {
        applicationId: string;
        botUserId: string;
        clientId: string;
      };
    }
  }
}

export {};
