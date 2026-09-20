import { workflow } from "@drassos/core";
import type { PublicUser } from "../types.js";
import { claimInvitationsForUser } from "../invitations.js";
import { getUserById, registerUser } from "../users.js";

export type RegisterUserInput = {
  name: string;
  email: string;
  password: string;
};

export type RegisterUserOutput = {
  user: PublicUser;
};

export const registerUserWorkflow = workflow<RegisterUserInput, RegisterUserOutput>(
  "register-user",
  async (ctx) => {
    const user = await ctx.step("register-user", async () =>
      registerUser({
        name: String(ctx.input.name ?? ""),
        email: String(ctx.input.email ?? ""),
        password: String(ctx.input.password ?? ""),
        id: ctx.uuid(),
        createdAt: ctx.now().toISOString(),
      }),
    );
    await ctx.step("claim-invitations", async () => claimInvitationsForUser(user));
    const claimed = await getUserById(user.id);
    return { user: claimed ?? user };
  },
);
