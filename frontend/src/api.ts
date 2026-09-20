export type PublicUser = {
  id: string;
  name: string;
  email: string;
  pendingInvitationIds?: string[];
};

export type AuthResponse = {
  token: string;
  user: PublicUser;
};

export type EventSearchArea = {
  displayName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  source?: string;
  providerPlaceId?: string;
};

export type EventConstraint = {
  type: string;
  label: string;
  strength: "required" | "preferred";
};

export type CreateEventCommand = {
  name: string;
  date?: string;
  timezone?: string;
  locationLabel: string;
  radiusMiles: number;
  searchArea: EventSearchArea;
  constraints?: EventConstraint[];
};

export type CouncilEvent = {
  id: string;
  ownerId: string;
  name: string;
  date?: string;
  timezone?: string;
  locationLabel?: string;
  searchArea?: EventSearchArea;
  constraints?: EventConstraint[];
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowSnapshot = {
  runId: string;
  status: string;
  command?: CreateEventCommand;
  interactionId?: string;
  event?: CouncilEvent;
  deleted?: boolean;
  error?: string;
};

const tokenKey = "restaurant-council-token";

export function getToken(): string | null {
  return localStorage.getItem(tokenKey);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(tokenKey, token);
  } else {
    localStorage.removeItem(tokenKey);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

export function register(body: { name: string; email: string; password: string }) {
  return request<AuthResponse>("/api/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function login(body: { email: string; password: string }) {
  return request<AuthResponse>("/api/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchMe() {
  return request<{ user: PublicUser }>("/api/me");
}

export function logout() {
  return request<{ loggedOut: true; userId: string }>("/api/logout", {
    method: "POST",
  });
}

function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

export function startWorkflow(message: string) {
  return request<WorkflowSnapshot>("/api/workflow", {
    method: "POST",
    body: JSON.stringify({ message, timezone: timezone() }),
  });
}

export function decideWorkflow(
  runId: string,
  decision:
    | { outcome: "approved" }
    | { outcome: "changes_requested"; feedback: string }
    | { outcome: "rejected"; reason?: string },
) {
  return request<WorkflowSnapshot>(`/api/workflow/${runId}/decision`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
}

export function fetchEvents() {
  return request<{ events: CouncilEvent[] }>("/api/events");
}

export function fetchEvent(eventId: string) {
  return request<{ event: CouncilEvent; preferences: EventPreference[] }>(`/api/events/${eventId}`);
}

export function updateEvent(
  eventId: string,
  body: {
    name: string;
    date: string;
    time: string;
    locationLabel: string;
    radiusMiles: number;
    kidFriendly: boolean;
    timezone?: string;
  },
) {
  return request<{ event: CouncilEvent }>(`/api/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...body, timezone: body.timezone ?? timezone() }),
  });
}

export function startDeleteWorkflow(eventId: string) {
  return request<WorkflowSnapshot>(`/api/events/${eventId}/delete`, {
    method: "POST",
  });
}

export function interpretEventChange(eventId: string, message: string) {
  return request<{ event: CouncilEvent }>(`/api/events/${eventId}/interpret`, {
    method: "POST",
    body: JSON.stringify({ message, timezone: timezone() }),
  });
}

export type Contact = {
  id: string;
  ownerId: string;
  name: string;
  email: string;
  userId?: string | null;
  createdAt: string;
};

export type EventInvitation = {
  id: string;
  eventId: string;
  invitedBy: string;
  email: string;
  userId: string | null;
  status: "pending" | "accepted" | "rejected";
  rejectReason?: string;
  createdAt: string;
  respondedAt?: string;
  eventName: string;
  eventDate?: string;
  hostName: string;
};

export function fetchContacts() {
  return request<{ contacts: Contact[] }>("/api/contacts");
}

export function addContact(body: { name: string; email: string }) {
  return request<{ contact: Contact }>("/api/contacts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchInvitations() {
  return request<{ invitations: EventInvitation[] }>("/api/invitations");
}

export function respondToInvitation(invitationId: string, body: { outcome: "accepted" | "rejected"; reason?: string }) {
  return request<{ invitation: EventInvitation }>(`/api/invitations/${invitationId}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchEventInvitations(eventId: string) {
  return request<{ invitations: EventInvitation[] }>(`/api/events/${eventId}/invitations`);
}

export type EventPreference = {
  id: string;
  eventId: string;
  userId: string;
  category: string;
  visibility: "PUBLIC" | "PRIVATE";
  priority: "LOW" | "MEDIUM" | "HIGH" | "HARD";
  label: string;
  userName: string;
  mine: boolean;
};

export function addEventPreferences(eventId: string, message: string) {
  return request<{ preferences: EventPreference[] }>(`/api/events/${eventId}/preferences`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export type EventChatMessage = {
  id: string;
  eventId: string;
  userId: string;
  body: string;
  createdAt: string;
  userName: string;
  mine: boolean;
};

export function fetchEventChat(eventId: string) {
  return request<{ messages: EventChatMessage[] }>(`/api/events/${eventId}/chat`);
}

export function sendEventChat(eventId: string, message: string) {
  return request<{ messages: EventChatMessage[] }>(`/api/events/${eventId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export type ConstraintVerificationResult = "meets" | "does_not_meet" | "unknown";
export type ConstraintContactMethod = "phone" | "email" | "in-person" | "other";

export type ConstraintVerification = {
  id: string;
  result: ConstraintVerificationResult;
  method: ConstraintContactMethod;
  notes?: string;
  verifiedByUserId: string;
  verifiedByName: string;
  verifiedAt: string;
  summary: string;
};

export type CouncilRestaurant = {
  placeId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  priceLevel?: string;
  types?: string[];
  rating?: number;
  reviewCount?: number;
  photoUrl?: string;
  hours?: string[];
  openNow?: boolean | null;
  website?: string;
  phone?: string;
  email?: string;
  userScores?: Array<{ userId: string; userName: string; score: number }>;
  dietaryAssessments?: Array<{
    requirement: string;
    status: "confirmed" | "likely" | "uncertain" | "unsupported" | "conflicting";
  }>;
  constraintFlags?: Array<{
    id: string;
    label: string;
    status: "mismatch" | "uncertain";
  }>;
  constraintChecks?: Array<{
    id: string;
    label: string;
    confirmed: boolean;
    confirmation?: string;
    verifications?: ConstraintVerification[];
  }>;
  councilScore?: number;
  explanations?: string[];
  picked?: boolean;
};

export function fetchRestaurants(eventId: string) {
  return request<{ restaurants: CouncilRestaurant[]; searchedAt: string | null }>(
    `/api/events/${eventId}/restaurants`,
  );
}

export function startCouncil(eventId: string) {
  return request<{ restaurants: CouncilRestaurant[]; searchedAt: string }>(`/api/events/${eventId}/council`, {
    method: "POST",
  });
}

export function verifyRestaurantConstraint(
  eventId: string,
  placeId: string,
  body: {
    constraintId: string;
    result: ConstraintVerificationResult;
    method: ConstraintContactMethod;
    notes?: string;
  },
) {
  return request<{ restaurant: CouncilRestaurant }>(
    `/api/events/${eventId}/restaurants/${encodeURIComponent(placeId)}/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export type CouncilProgress = {
  eventId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  agent: string;
  tool: string;
  error?: string;
};

export function fetchCouncilProgress(eventId: string) {
  return request<{ progress: CouncilProgress | null }>(`/api/events/${eventId}/council/progress`);
}

export function inviteToEvent(
  eventId: string,
  body: { email?: string; contactId?: string; contactName?: string },
) {
  return request<{ invitation: EventInvitation }>(`/api/events/${eventId}/invite`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
