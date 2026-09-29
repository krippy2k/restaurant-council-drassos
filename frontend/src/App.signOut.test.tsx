import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const user = { id: "u1", name: "Ada", email: "ada@example.com" };
const event = {
  id: "evt-1",
  ownerId: "u1",
  name: "Friday dinner",
  status: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.ts")>();
  return {
    ...actual,
    logout: vi.fn(async () => ({ loggedOut: true as const, userId: "u1" })),
    login: vi.fn(async () => ({ token: "after-login", user })),
    fetchMe: vi.fn(async () => ({ user })),
    fetchEvents: vi.fn(async () => ({ events: [] })),
    fetchInvitations: vi.fn(async () => ({ invitations: [] })),
    fetchEvent: vi.fn(async () => ({ event, preferences: [] })),
    fetchContacts: vi.fn(async () => ({ contacts: [] })),
    fetchEventInvitations: vi.fn(async () => ({ invitations: [] })),
  };
});

describe("sign-out navigation", () => {
  beforeEach(() => {
    localStorage.setItem("restaurant-council-token", "session-1");
    window.history.pushState({}, "", "/events/evt-1");
  });

  it("returns to / so the next login opens the dashboard instead of the leftover event URL", async () => {
    const session = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Friday dinner" })).toBeInTheDocument();

    await session.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(screen.queryByRole("heading", { name: "Friday dinner" })).not.toBeInTheDocument();

    await session.type(screen.getByLabelText("Email"), "ada@example.com");
    await session.type(screen.getByLabelText("Password"), "password1");
    await session.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Your events. Open one to review or edit it.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Friday dinner" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
