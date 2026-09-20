import { workflow } from "@drassos/core";
import type { PublicUser } from "../types.js";
import { claimInvitationsForUser } from "../invitations.js";
import { authenticateUser, getUserById } from "../users.js";

export type LoginUserInput = {
  email: string;
  password: string;
};

export type LoginUserOutput = {
  user: PublicUser;
};

export const loginUserWorkflow = workflow<LoginUserInput, LoginUserOutput>("login-user", async (ctx) => {
  const user = await ctx.step("authenticate", async () =>
    authenticateUser(String(ctx.input.email ?? ""), String(ctx.input.password ?? "")),
  );
  await ctx.step("claim-invitations", async () => claimInvitationsForUser(user));
  const claimed = await getUserById(user.id);
  return { user: claimed ?? user };
});
