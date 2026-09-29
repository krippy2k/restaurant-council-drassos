import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fetchCouncilProgress, fetchRestaurants, startCouncil } from "./api";

const user = { id: "u1", name: "Ada", email: "ada@example.com" };
const event = {
  id: "evt-1",
  ownerId: "u1",
  name: "Friday dinner",
  date: "2026-09-27T16:00:00",
  locationLabel: "Bamford Park",
  searchArea: { displayName: "Bamford Park", radiusMeters: 8046.7 },
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
    fetchEventChat: vi.fn(async () => ({ messages: [] })),
    fetchRestaurants: vi.fn(async () => ({ restaurants: [], searchedAt: null })),
    fetchCouncilProgress: vi.fn(async () => ({ progress: null })),
    startCouncil: vi.fn(async () => ({ restaurants: [], searchedAt: null })),
  };
});

describe("council page event details", () => {
  beforeEach(() => {
    localStorage.setItem("restaurant-council-token", "session-1");
    window.history.pushState({}, "", "/events/evt-1/council");
    vi.mocked(fetchRestaurants).mockResolvedValue({ restaurants: [], searchedAt: null });
    vi.mocked(fetchCouncilProgress).mockResolvedValue({ progress: null });
  });

  it("shows a compact event summary with location and date", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Friday dinner council" })).toBeInTheDocument();
    const line = await screen.findByText(/Bamford Park/);
    expect(line).toHaveTextContent(/5 miles/);
    expect(line).toHaveTextContent(/·/);
    expect(screen.queryByText("Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
  });

  it("renders Also considered in its own section under Council Picks", async () => {
    vi.mocked(fetchRestaurants).mockResolvedValueOnce({
      restaurants: [
        { placeId: "pick-1", name: "Noodle Shop", picked: true },
        { placeId: "other-1", name: "Pizza Place", picked: false },
      ],
      searchedAt: "2026-09-22T12:00:00.000Z",
    });
    render(<App />);

    const picks = await screen.findByRole("heading", { name: "Council Picks" });
    const also = screen.getByRole("heading", { name: "Also considered" });
    expect(picks.compareDocumentPosition(also) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(also.closest("section")).not.toBe(picks.closest("section"));
    expect(screen.getByText("Noodle Shop")).toBeInTheDocument();
    expect(screen.getByText("Pizza Place")).toBeInTheDocument();
  });

  it("does not say no restaurants survived while Council is still convening", async () => {
    vi.mocked(fetchRestaurants).mockResolvedValue({
      restaurants: [],
      searchedAt: "2026-09-22T12:00:00.000Z",
    });
    vi.mocked(fetchCouncilProgress).mockResolvedValue({
      progress: { eventId: "evt-1", status: "RUNNING", agent: "Scout", tool: "Restaurant search" },
    });
    vi.mocked(startCouncil).mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Friday dinner council" })).toBeInTheDocument();
    expect(await screen.findByText("Restaurant search")).toBeInTheDocument();
    expect(screen.queryByText(/survived the required constraints/i)).not.toBeInTheDocument();
  });
});
