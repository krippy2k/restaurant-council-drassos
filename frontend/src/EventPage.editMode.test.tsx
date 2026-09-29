import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fetchContacts } from "./api";

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
    fetchMe: vi.fn(async () => ({ user })),
    fetchEvent: vi.fn(async () => ({ event, preferences: [] })),
    fetchContacts: vi.fn(async () => ({ contacts: [] })),
    fetchEventInvitations: vi.fn(async () => ({ invitations: [] })),
  };
});

describe("event details edit mode", () => {
  beforeEach(() => {
    localStorage.setItem("restaurant-council-token", "session-1");
    window.history.pushState({}, "", "/events/evt-1");
  });

  it("opens the event details page on Chat instead of Form", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Friday dinner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toHaveClass("primary");
    expect(screen.getByRole("button", { name: "Form" })).toHaveClass("ghost");
    expect(screen.getByPlaceholderText("Make it 5 miles and 4pm.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Distance (miles)")).not.toBeInTheDocument();
  });

  it("still lets the host switch to the Form editor", async () => {
    const session = userEvent.setup();
    render(<App />);

    expect(await screen.findByPlaceholderText("Make it 5 miles and 4pm.")).toBeInTheDocument();
    await session.click(screen.getByRole("button", { name: "Form" }));

    expect(screen.getByLabelText("Distance (miles)")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Make it 5 miles and 4pm.")).not.toBeInTheDocument();
  });

  it("lists Invite a contact before Invite by email", async () => {
    vi.mocked(fetchContacts).mockResolvedValueOnce({
      contacts: [
        {
          id: "c1",
          ownerId: "u1",
          name: "Pat",
          email: "pat@example.com",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    render(<App />);

    const contact = await screen.findByLabelText("Invite a contact");
    const email = screen.getByLabelText("Invite by email");
    expect(contact.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
