# Restaurant Council

A split frontend/backend web app. Register or log in (Drassos `register-user` and `login-user` workflows), then describe an event. A Drassos Create Event workflow asks an agent to draft a `CreateEventCommand`, then waits for you to accept it or request changes before the event is saved. Hosts invite people with `invite-to-event` (by email or a saved contact). That run stays waiting until the guest accepts or rejects the invitation. People add dietary and price constraints with `add-event-preferences`; those are public unless they ask to keep them private.

Set `OPENAI_API_KEY` in `backend/.env` so the interpret-event agent can call the model.

## Prerequisites

- Node.js 20+

## Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

API listens on `http://127.0.0.1:3001`. The same process starts a Drassos Console on `http://127.0.0.1:3100` so you can inspect `create-event`, `update-event`, `delete-event`, `invite-to-event`, and `start-council` runs.

Set `GOOGLE_PLACES_API_KEY` so Council can search nearby restaurants.

Build the Console UI once from the engine repo if `apps/console/dist` is missing:

```bash
cd ../../drassos-engine
pnpm --filter @drassos/console build
```

Do not also run `pnpm dev` in `drassos-engine` unless you pass this app as `--entry` — that is a second engine with a different store.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to the backend.

## API

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| `POST` | `/api/register` | no | `{ "name", "email", "password" }` |
| `POST` | `/api/login` | no | `{ "email", "password" }` |
| `POST` | `/api/logout` | Bearer token | — |
| `GET` | `/api/me` | Bearer token | — |
| `POST` | `/api/workflow` | Bearer token | `{ "message", "timezone?" }` → waiting command or event |
| `GET` | `/api/workflow/:runId` | Bearer token | current snapshot |
| `GET` | `/api/events` | Bearer token | owned and joined events |
| `GET` | `/api/events/:eventId` | Bearer token | event plus visible constraints |
| `POST` | `/api/events/:eventId/preferences` | Bearer token | `{ "message" }` |
| `GET` | `/api/events/:eventId/chat` | Bearer token | event chat messages |
| `POST` | `/api/events/:eventId/chat` | Bearer token | `{ "message" }` |
| `POST` | `/api/events/:eventId/council` | Bearer token | start-council search |
| `GET` | `/api/events/:eventId/restaurants` | Bearer token | filtered restaurant list |
| `PATCH` | `/api/events/:eventId` | Bearer token | form fields |
| `POST` | `/api/events/:eventId/interpret` | Bearer token | `{ "message" }` |
| `POST` | `/api/events/:eventId/invite` | Bearer token | `{ "email"? , "contactId"? , "contactName"? }` |
| `GET` | `/api/events/:eventId/invitations` | Bearer token | host-only invite list |
| `GET` | `/api/contacts` | Bearer token | saved contacts |
| `POST` | `/api/contacts` | Bearer token | `{ "name", "email" }` |
| `GET` | `/api/invitations` | Bearer token | pending invites for the current user |
| `POST` | `/api/invitations/:invitationId/respond` | Bearer token | `{ "outcome": "accepted" \| "rejected", "reason"? }` |
