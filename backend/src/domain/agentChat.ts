import { z } from "zod";

export const AGENT_CHAT_MENTIONS = ["@council", "@agent"] as const;

export type AgentChatMention = (typeof AGENT_CHAT_MENTIONS)[number];

export type ParsedAgentChatRequest = {
  mention: AgentChatMention;
  query: string;
};

const PREFIX = /^@(council|agent)\b/i;

export const agentChatReplySchema = z.object({
  reply: z.string().min(1).max(2000),
});

export type AgentChatReply = z.infer<typeof agentChatReplySchema>;

export function parseAgentChatRequest(body: string): ParsedAgentChatRequest | undefined {
  const text = body.trim();
  const match = PREFIX.exec(text);
  if (!match) {
    return undefined;
  }
  const mention = `@${match[1]!.toLowerCase()}` as AgentChatMention;
  const query = text.slice(match[0].length).replace(/^[\s,:;-]+/, "").trim();
  return { mention, query };
}

export function replyFromAgentOutput(output: unknown): string {
  if (typeof output === "string") {
    const text = output.trim();
    if (text) {
      return text.slice(0, 2000);
    }
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as {
      reply?: unknown;
      restaurantName?: unknown;
      hoursForDay?: unknown;
      hours?: unknown;
      item?: unknown;
      found?: unknown;
    };
    const reply = String(record.reply ?? "").trim();
    if (reply) {
      return reply.slice(0, 2000);
    }
    const restaurantName = String(record.restaurantName ?? "").trim();
    const item = String(record.item ?? "").trim();
    if (item && restaurantName) {
      if (record.found === true) {
        return `${restaurantName} lists ${item}.`.slice(0, 2000);
      }
      return `I could not confirm ${item} at ${restaurantName} from the published menu.`.slice(0, 2000);
    }
    const hoursForDay = String(record.hoursForDay ?? "").trim();
    if (hoursForDay) {
      return (restaurantName ? `${restaurantName}: ${hoursForDay}.` : hoursForDay).slice(0, 2000);
    }
    const hours = Array.isArray(record.hours) ? record.hours.map((line) => String(line)).filter(Boolean) : [];
    if (restaurantName && hours.length > 0) {
      return `${restaurantName}: ${hours.join("; ")}.`.slice(0, 2000);
    }
  }
  return "I couldn't finish that request. You can try again.";
}
