import { workflow } from "@drassos/core";
import { addContact } from "../contacts.js";
import type { Contact } from "../domain/types.js";

export type AddContactInput = {
  ownerId: string;
  name: string;
  email: string;
};

export type AddContactOutput = {
  contact: Contact;
};

export const addContactWorkflow = workflow<AddContactInput, AddContactOutput>("add-contact", async (ctx) => {
  const contact = await ctx.step("add-contact", async () =>
    addContact({
      id: ctx.uuid(),
      ownerId: ctx.input.ownerId,
      name: String(ctx.input.name ?? ""),
      email: String(ctx.input.email ?? ""),
      createdAt: ctx.now().toISOString(),
    }),
  );
  return { contact };
});
