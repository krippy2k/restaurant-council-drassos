import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CouncilRestaurant } from "./api";
import { RestaurantCard } from "./RestaurantCard";

function renderCard(restaurant: Partial<CouncilRestaurant> & Pick<CouncilRestaurant, "placeId" | "name">) {
  return render(
    <ul>
      <RestaurantCard restaurant={restaurant} />
    </ul>,
  );
}

describe("restaurant card contact links", () => {
  it("shows the phone under the address and Website and View Menu buttons when those links exist", () => {
    renderCard({
      placeId: "noodles",
      name: "Noodle Shop",
      address: "1 Main St",
      phone: "(555) 0100",
      website: "https://noodles.example",
      menuUrl: "https://noodles.example/menu",
    });

    const address = screen.getByText("1 Main St");
    const phone = screen.getByRole("link", { name: "(555) 0100" });
    expect(address.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(phone).toHaveAttribute("href", "tel:5550100");

    const website = screen.getByRole("link", { name: "Website" });
    expect(website).toHaveAttribute("href", "https://noodles.example");
    expect(website).toHaveAttribute("target", "_blank");
    expect(website).toHaveAttribute("rel", "noreferrer");

    const menu = screen.getByRole("link", { name: "View Menu" });
    expect(menu).toHaveAttribute("href", "https://noodles.example/menu");
    expect(menu).toHaveAttribute("target", "_blank");
  });

  it("omits phone, Website, and View Menu when those fields are missing", () => {
    renderCard({
      placeId: "secret",
      name: "Secret Kitchen",
      address: "2 Oak Ave",
    });

    expect(screen.getByText("2 Oak Ave")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View Menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /tel:/i })).not.toBeInTheDocument();
  });

  it("shows Website without View Menu when the site is a homepage", () => {
    renderCard({
      placeId: "home",
      name: "Home Kitchen",
      address: "3 Pine Rd",
      website: "https://home.example",
    });

    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://home.example");
    expect(screen.queryByRole("link", { name: "View Menu" })).not.toBeInTheDocument();
  });
});
