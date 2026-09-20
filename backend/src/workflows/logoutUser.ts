import { workflow } from "@drassos/core";
import { revokeToken } from "../sessions.js";

export type LogoutUserInput = {
  userId: string;
  tokenId: string;
  expiresAt: string;
};

export type LogoutUserOutput = {
  loggedOut: true;
  userId: string;
};

export const logoutUserWorkflow = workflow<LogoutUserInput, LogoutUserOutput>("logout-user", async (ctx) => {
  const result = await ctx.step("revoke-session", async () =>
    revokeToken({
      userId: String(ctx.input.userId ?? ""),
      tokenId: String(ctx.input.tokenId ?? ""),
      expiresAt: String(ctx.input.expiresAt ?? ""),
      revokedAt: ctx.now().toISOString(),
    }),
  );
  return { loggedOut: true, userId: result.userId };
});
