import { afterEach, describe, expect, it } from "vitest";
import { createTestRuntime, type TestRuntime } from "@drassos/testing";
import { createCouncilApp } from "../src/app.ts";
import { isTokenRevoked } from "../src/sessions.ts";
import { loginUserWorkflow } from "../src/workflows/loginUser.ts";
import { logoutUserWorkflow } from "../src/workflows/logoutUser.ts";
import { registerUserWorkflow } from "../src/workflows/registerUser.ts";

describe("register-user and login-user workflows", () => {
  const runtimes: TestRuntime[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.stop();
    }
  });

  it("registers an account, then signs in with the same credentials", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const email = `host-${crypto.randomUUID()}@council.test`;
    const password = "correct-horse";

    const registered = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email,
      password,
    });
    expect(registered.status).toBe("COMPLETED");
    expect(registered.output?.user).toMatchObject({ name: "Ada Chen", email });
    expect(registered.output?.user.id).toEqual(expect.any(String));

    const loggedIn = await runtime.execute(loginUserWorkflow, { email, password });
    expect(loggedIn.status).toBe("COMPLETED");
    expect(loggedIn.output?.user).toMatchObject({
      id: registered.output?.user.id,
      email,
    });
  }, 20_000);

  it("fails login with the wrong password", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const email = `host-${crypto.randomUUID()}@council.test`;
    await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email,
      password: "correct-horse",
    });

    const failed = await runtime.execute(loginUserWorkflow, {
      email,
      password: "wrong-password",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.error?.message).toMatch(/Invalid email or password/i);
  }, 20_000);

  it("revokes the session on logout", async () => {
    const runtime = await createTestRuntime({
      app: createCouncilApp({ models: {} }),
      allowReplace: true,
    });
    runtimes.push(runtime);

    const email = `host-${crypto.randomUUID()}@council.test`;
    const registered = await runtime.execute(registerUserWorkflow, {
      name: "Ada Chen",
      email,
      password: "correct-horse",
    });
    const tokenId = crypto.randomUUID();
    const loggedOut = await runtime.execute(logoutUserWorkflow, {
      userId: registered.output!.user.id,
      tokenId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(loggedOut.status).toBe("COMPLETED");
    expect(loggedOut.output).toEqual({ loggedOut: true, userId: registered.output!.user.id });
    expect(await isTokenRevoked(tokenId)).toBe(true);
  }, 20_000);
});
