// Email delivery adapter (Resend). Server-side only; credentials are
// decrypted from integration_secrets. Plain fetch, no SDK. Email sends
// happen exclusively from the approval-resolution path and only when the
// connection runs in live mode — exactly like SMS.

const RESEND_BASE = "https://api.resend.com";

export type EmailCredentials = {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
};

export class EmailProviderError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "EmailProviderError";
    this.status = status;
  }
}

function fromHeader(credentials: EmailCredentials): string {
  return credentials.fromName
    ? `${credentials.fromName} <${credentials.fromEmail}>`
    : credentials.fromEmail;
}

export async function testEmailConnection(
  credentials: EmailCredentials,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  try {
    const response = await fetch(`${RESEND_BASE}/domains`, {
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail:
          response.status === 401
            ? "Resend rejected the API key."
            : `Resend returned an error (${response.status}). Try again shortly.`,
      };
    }

    const body = (await response.json()) as {
      data?: { name?: string; status?: string }[];
    };
    const domains = body.data ?? [];
    const fromDomain = credentials.fromEmail.split("@")[1] ?? "";
    const verified = domains.some(
      (domain) => domain.name === fromDomain && domain.status === "verified",
    );

    return {
      ok: true,
      detail: verified
        ? `Key accepted and the ${fromDomain} domain is verified. Northstar can send email from ${credentials.fromEmail} after approval.`
        : `Key accepted. Note: ${fromDomain || "the sending domain"} is not verified in Resend yet — sends may be rejected until it is (or use Resend's onboarding sender).`,
    };
  } catch {
    return { ok: false, detail: "Could not reach Resend." };
  }
}

export type EmailSendOutcome = {
  messageId: string;
};

export async function sendEmail(
  credentials: EmailCredentials,
  message: { to: string; subject: string; body: string },
): Promise<EmailSendOutcome> {
  const response = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromHeader(credentials),
      to: [message.to],
      subject: message.subject,
      text: message.body,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    let detail = `status ${response.status}`;

    try {
      const errorBody = (await response.json()) as { message?: string };

      if (errorBody.message) {
        detail = errorBody.message;
      }
    } catch {
      // keep the status-only detail
    }

    throw new EmailProviderError(`Email send failed: ${detail}`, response.status);
  }

  const body = (await response.json()) as { id: string };

  return { messageId: body.id };
}
