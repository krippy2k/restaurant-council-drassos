import type { CouncilRestaurant } from "./api";
import { RestaurantCard } from "./RestaurantCard";

type RestaurantGroupProps = {
  restaurants: CouncilRestaurant[];
  eventId?: string;
  userId?: string;
  eventDate?: string;
  timezone?: string;
  onFeedbackStart?: () => void;
  onCouncilResult?: (result: {
    restaurant: CouncilRestaurant;
    restaurants?: CouncilRestaurant[];
    searchedAt?: string;
  }) => void;
};

function RestaurantGroup({
  heading,
  restaurants,
  ...card
}: RestaurantGroupProps & { heading: string }) {
  if (restaurants.length === 0) {
    return null;
  }
  return (
    <section className="event-form restaurant-group">
      <h2 className="events-heading">{heading}</h2>
      <ul className="event-list restaurant-list">
        {restaurants.map((restaurant) => (
          <RestaurantCard key={restaurant.placeId} restaurant={restaurant} {...card} />
        ))}
      </ul>
    </section>
  );
}

export function CouncilPicks(props: RestaurantGroupProps) {
  return <RestaurantGroup heading="Council Picks" {...props} />;
}

export function AlsoConsidered(props: RestaurantGroupProps) {
  return <RestaurantGroup heading="Also considered" {...props} />;
}
