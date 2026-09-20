export type PublicUser = {
  id: string;
  name: string;
  email: string;
  pendingInvitationIds?: string[];
};

export type StoredUser = PublicUser & {
  passwordHash: string;
  createdAt: string;
  pendingInvitationIds?: string[];
};

export type AuthTokenPayload = {
  sub: string;
  email: string;
  jti?: string;
  exp?: number;
};
