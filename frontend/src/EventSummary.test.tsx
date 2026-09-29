import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventSummary } from "./EventSummary";

describe("event summary", () => {
  const details = {
    name: "Friday dinner",
    date: "2026-09-27T16:00:00",
    location: "Bamford Park",
    radiusMiles: 5,
  };

  it("stacks labeled date, time, location, and distance on the details page", () => {
    render(<EventSummary {...details} />);

    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Bamford Park")).toBeInTheDocument();
    expect(screen.getByText("5 miles")).toBeInTheDocument();
  });

  it("packs date, time, location, and distance onto one line when compact", () => {
    render(<EventSummary compact {...details} />);

    expect(screen.queryByText("Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
    expect(screen.getByText(/Bamford Park/)).toHaveTextContent(/·/);
    expect(screen.getByText(/Bamford Park/)).toHaveTextContent(/5 miles/);
  });
});
