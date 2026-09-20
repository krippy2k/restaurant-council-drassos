  export type EventStatus =
    | "draft"
    | "collecting_preferences"
    | "negotiating"
    | "decided";
  
  export interface EventLocation {
    latitude: number;
    longitude: number;
  }
  
  export type EventSearchAreaSource =
    | "address"
    | "city"
    | "neighborhood"
    | "landmark"
    | "coordinates";
  
  export interface EventSearchArea {
    displayName: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    source?: EventSearchAreaSource;
    providerPlaceId?: string;
  }
  
  export interface EventRestaurantSearchPolicy {
    minimumOpenAfterEventMinutes: number;
  }

  export interface EventConstraint {
    type: string;
    label: string;
    strength: "required" | "preferred";
  }

  export interface CreateEventCommand {
    name: string;
    date?: string;
    timezone?: string;
    locationLabel: string;
    radiusMiles: number;
    restaurantSearchPolicy?: EventRestaurantSearchPolicy;
    searchArea: EventSearchArea;
    constraints?: EventConstraint[];
  }
  
  export interface Event {
    id: string;
    ownerId: string;
    name: string;
    date?: string;
    timezone?: string;
    locationLabel?: string;
    location?: EventLocation;
    searchArea?: EventSearchArea;
    restaurantSearchPolicy?: EventRestaurantSearchPolicy;
    constraints?: EventConstraint[];
    status: EventStatus;
    createdAt: string;
    updatedAt: string;
  }
  
  export type EventRole = "owner" | "member";
  export type MemberStatus = "invited" | "joined" | "ready";
  
  export interface EventMember {
    eventId: string;
    userId: string;
    role: EventRole;
    status: MemberStatus;
    joinedAt?: string;
  }
  
export type InvitationType = "email";
export type InvitationStatus = "pending" | "accepted" | "rejected";

export interface Invitation {
  id: string;
  eventId: string;
  invitedBy: string;
  email: string;
  userId: string | null;
  status: InvitationStatus;
  rejectReason?: string;
  createdAt: string;
  respondedAt?: string;
  workflowRunId?: string;
}

export interface Contact {
  id: string;
  ownerId: string;
  name: string;
  email: string;
  userId?: string | null;
  createdAt: string;
}

export interface EventChatMessage {
  id: string;
  eventId: string;
  userId: string;
  body: string;
  createdAt: string;
}
  
  export const PREFERENCE_CATEGORIES = [
    "cuisine",
    "price",
    "dietary",
    "allergies",
    "accessibility",
    "distance",
    "atmosphere",
    "seating",
    "dislikes",
    "favorites",
    "freeform"
  ] as const;
  
  export type PreferenceCategory = (typeof PREFERENCE_CATEGORIES)[number];
  export type PreferenceVisibility = "PUBLIC" | "PRIVATE";
  export type PreferencePriority = "LOW" | "MEDIUM" | "HIGH" | "HARD";
  
  export type PreferenceValue = Record<string, unknown>;
  
  export interface Preference {
    id: string;
    eventId: string;
    userId: string;
    category: PreferenceCategory;
    visibility: PreferenceVisibility;
    priority: PreferencePriority;
    value?: PreferenceValue;
    createdAt: string;
    updatedAt: string;
  }
  
  export interface PrivatePreferenceRecord {
    id: string;
    preferenceId: string;
    userId: string;
    eventId: string;
    category: PreferenceCategory;
    sourceText?: string;
    structuredValue: PreferenceValue;
    createdAt: string;
    updatedAt: string;
  }
  
  export type CouncilStatus =
    | "CREATED"
    | "COLLECTING_PREFERENCES"
    | "DERIVING_CONSTRAINTS"
    | "SEARCHING"
    | "EVALUATING"
    | "NEGOTIATING"
    | "COMPLETE"
    | "FAILED";
  
  export interface CouncilSessionRecord {
    id: string;
    eventId: string;
    status: CouncilStatus;
    stateJson: string;
    createdAt: string;
    updatedAt: string;
  }
  
  export interface AuditEvent {
    id: string;
    eventId?: string;
    actorType: string;
    actorId: string;
    action: string;
    resource?: string;
    decision?: string;
    reason?: string;
    createdAt: string;
  }
  

  export interface CreatorPreferenceDraft {
    category: string;
    visibility: PreferenceVisibility;
    priority: PreferencePriority;
    value: Record<string, unknown>;
  }
