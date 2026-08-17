// Turns a failed WhatsApp send into something the person at the screen can act
// on. Every adapter throws `<provider> send failed (<status>): <body>`, which
// is right for the server log and useless on a screen: "Couldn't send the
// message. Try again." reads as a blip worth retrying even when retrying can
// never work, so people press Retry at a disconnected phone all afternoon.
//
// Same shape and same job as sheetFailure() in routes/clients.ts.

export type SendProblem =
  | "disconnected"
  | "credentials"
  | "too_many"
  | "bad_chat"
  | "provider_down"
  | "unknown";

function textOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusOf(err: unknown): number | undefined {
  // The adapters put it in brackets: "Periskope send failed (401): {...}".
  const found = textOf(err).match(/\((\d{3})\)/);
  return found ? Number(found[1]) : undefined;
}

export function sendProblemOf(err: unknown): SendProblem {
  const text = textOf(err).toLowerCase();
  const status = statusOf(err);

  // Checked before the plain 401 below: Periskope answers 401 both for a key
  // it won't accept and for a phone that is switched off, and those need
  // opposite things done about them.
  if (
    text.includes("phone server instance is switched off") ||
    text.includes("phone/restart") ||
    text.includes("disconnected") ||
    text.includes("not connected")
  ) {
    return "disconnected";
  }
  if (status === 401 || status === 403) return "credentials";
  if (status === 429) return "too_many";
  if (status === 404 || status === 400) return "bad_chat";
  if (status !== undefined && status >= 500) return "provider_down";
  return "unknown";
}

export function sendFailure(err: unknown): { status: number; error: string; detail?: string } {
  // What the provider actually said, carried alongside all of these — so a
  // cause none of them anticipated can still be acted on.
  const detail = textOf(err);

  switch (sendProblemOf(err)) {
    case "disconnected":
      return {
        status: 503,
        detail,
        error:
          "WhatsApp is not connected, so no messages can be sent to anyone right now. " +
          "Someone needs to open Periskope and link the number again by scanning the QR code. " +
          "Nothing is lost — send this again once it is back.",
      };
    case "credentials":
      return {
        status: 502,
        detail,
        error:
          "The WhatsApp connection isn't working. This affects every client, not just this one — " +
          "an admin should check the WhatsApp setup.",
      };
    case "too_many":
      return {
        status: 503,
        detail,
        error: "Too many messages were sent in the last minute. Wait a minute, then press Retry.",
      };
    case "bad_chat":
      return {
        status: 502,
        detail,
        error:
          "WhatsApp wouldn't accept this group or number. Check the client's WhatsApp group on the " +
          "Clients screen, and that the sending number is still in that group.",
      };
    case "provider_down":
      return {
        status: 503,
        detail,
        error: "WhatsApp was busy and didn't take the message. Wait a minute, then press Retry.",
      };
    default:
      return {
        status: 502,
        detail,
        error: "Couldn't send the message. Press Retry, and if it keeps happening tell an admin.",
      };
  }
}
