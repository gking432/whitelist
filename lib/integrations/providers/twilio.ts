// Twilio REST adapter (pilot stack). Server-side only; credentials are
// decrypted from integration_secrets. Plain fetch with HTTP basic auth — no
// SDK dependency. SMS sends happen exclusively from the approval-resolution
// path and only when the connection runs in live mode.

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

export class TwilioError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TwilioError";
    this.status = status;
  }
}

function authHeader(credentials: TwilioCredentials): string {
  return `Basic ${Buffer.from(
    `${credentials.accountSid}:${credentials.authToken}`,
  ).toString("base64")}`;
}

export async function testTwilioConnection(
  credentials: TwilioCredentials,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  try {
    const response = await fetch(
      `${TWILIO_BASE}/Accounts/${encodeURIComponent(credentials.accountSid)}.json`,
      {
        headers: { Authorization: authHeader(credentials) },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        detail:
          response.status === 401
            ? "Twilio rejected the Account SID / Auth Token pair."
            : `Twilio returned an error (${response.status}). Try again shortly.`,
      };
    }

    const account = (await response.json()) as {
      friendly_name?: string;
      status?: string;
    };

    const numbersResponse = await fetch(
      `${TWILIO_BASE}/Accounts/${encodeURIComponent(credentials.accountSid)}` +
        `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(credentials.fromNumber)}&PageSize=1`,
      {
        headers: { Authorization: authHeader(credentials) },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!numbersResponse.ok) {
      return {
        ok: false,
        detail:
          "Twilio credentials worked, but Northstar could not verify the configured phone number.",
      };
    }

    const numbers = (await numbersResponse.json()) as {
      incoming_phone_numbers?: {
        phone_number?: string;
        friendly_name?: string;
        capabilities?: { sms?: boolean; voice?: boolean };
      }[];
    };
    const number = numbers.incoming_phone_numbers?.[0];

    if (!number) {
      return {
        ok: false,
        detail:
          "The phone number was not found in this Twilio account. Enter it in +15551234567 format.",
      };
    }

    if (!number.capabilities?.sms || !number.capabilities?.voice) {
      return {
        ok: false,
        detail:
          "This Twilio number must support both SMS and Voice for the full Northstar package.",
      };
    }

    return {
      ok: true,
      detail: `Connected to Twilio account "${account.friendly_name ?? credentials.accountSid}" (${account.status ?? "active"}). ${number.phone_number ?? credentials.fromNumber} is ready for approved SMS and AI phone answering.`,
    };
  } catch {
    return { ok: false, detail: "Could not reach Twilio." };
  }
}

export type TwilioSendOutcome = {
  messageSid: string;
  status: string;
};

export async function sendSms(
  credentials: TwilioCredentials,
  to: string,
  body: string,
): Promise<TwilioSendOutcome> {
  const params = new URLSearchParams({
    From: credentials.fromNumber,
    To: to,
    Body: body,
  });

  const response = await fetch(
    `${TWILIO_BASE}/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(credentials),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    let detail = `status ${response.status}`;

    try {
      const errorBody = (await response.json()) as {
        message?: string;
        code?: number;
      };

      if (errorBody.message) {
        detail = `${errorBody.message}${errorBody.code ? ` (code ${errorBody.code})` : ""}`;
      }
    } catch {
      // keep the status-only detail
    }

    throw new TwilioError(`Twilio send failed: ${detail}`, response.status);
  }

  const message = (await response.json()) as { sid: string; status: string };

  return { messageSid: message.sid, status: message.status };
}
