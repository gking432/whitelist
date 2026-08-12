// Twilio REST adapter (pilot stack). Server-side only; credentials are
// decrypted from integration_secrets. Plain fetch with HTTP basic auth — no
// SDK dependency. SMS sends happen exclusively from the approval-resolution
// path and only when the connection runs in live mode.

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  phoneHandlingMode?: "ai_answered" | "staff_assisted";
  staffForwardNumber?: string;
};

export type ManagedTwilioProvisionInput = {
  parentAccountSid: string;
  parentAuthToken: string;
  clientName: string;
  ownerLabel: string;
  areaCode?: string;
  smsUrl: string;
  voiceUrl: string;
  voiceStatusUrl: string;
};

export type ManagedTwilioProvisionResult =
  | { ok: true; credentials: TwilioCredentials; detail: string }
  | { ok: false; detail: string };

export class TwilioError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TwilioError";
    this.status = status;
  }
}

function authHeader(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
): string {
  return `Basic ${Buffer.from(
    `${credentials.accountSid}:${credentials.authToken}`,
  ).toString("base64")}`;
}

async function twilioFormRequest(
  url: string,
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  body: URLSearchParams,
) {
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(credentials),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function testTwilioParentAccount(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
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
            ? "Twilio rejected the Account SID and Auth Token."
            : `Twilio returned an error (${response.status}).`,
      };
    }

    const account = (await response.json()) as {
      friendly_name?: string;
      status?: string;
      type?: string;
    };

    if (account.status && account.status !== "active") {
      return {
        ok: false,
        detail: `The Twilio account is ${account.status}, not active.`,
      };
    }

    return {
      ok: true,
      detail: `Connected to ${account.friendly_name ?? credentials.accountSid}. Client subaccounts and usage will belong to this partner account.`,
    };
  } catch {
    return { ok: false, detail: "Could not reach Twilio." };
  }
}

export async function provisionManagedTwilioNumber(
  input: ManagedTwilioProvisionInput,
): Promise<ManagedTwilioProvisionResult> {
  const parentCredentials = {
    accountSid: input.parentAccountSid,
    authToken: input.parentAuthToken,
  };

  try {
    const accountResponse = await twilioFormRequest(
      `${TWILIO_BASE}/Accounts.json`,
      parentCredentials,
      new URLSearchParams({
        FriendlyName: `${input.ownerLabel} - ${input.clientName}`,
      }),
    );

    if (!accountResponse.ok) {
      return {
        ok: false,
        detail: `Twilio could not create the client subaccount (${accountResponse.status}).`,
      };
    }

    const account = (await accountResponse.json()) as {
      sid: string;
      auth_token: string;
    };
    const childCredentials = {
      accountSid: account.sid,
      authToken: account.auth_token,
    };
    const closeUnusedSubaccount = async () => {
      await twilioFormRequest(
        `${TWILIO_BASE}/Accounts/${encodeURIComponent(account.sid)}.json`,
        parentCredentials,
        new URLSearchParams({ Status: "closed" }),
      ).catch(() => undefined);
    };
    const query = new URLSearchParams({
      SmsEnabled: "true",
      VoiceEnabled: "true",
      ExcludeAllAddressRequired: "true",
      PageSize: "1",
    });

    if (input.areaCode) query.set("AreaCode", input.areaCode);

    const searchResponse = await fetch(
      `${TWILIO_BASE}/Accounts/${encodeURIComponent(account.sid)}` +
        `/AvailablePhoneNumbers/US/Local.json?${query.toString()}`,
      {
        headers: { Authorization: authHeader(childCredentials) },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!searchResponse.ok) {
      await closeUnusedSubaccount();
      return {
        ok: false,
        detail: `The Twilio subaccount was created, but number search failed (${searchResponse.status}).`,
      };
    }

    const available = (await searchResponse.json()) as {
      available_phone_numbers?: { phone_number: string }[];
    };
    const phoneNumber = available.available_phone_numbers?.[0]?.phone_number;

    if (!phoneNumber) {
      await closeUnusedSubaccount();
      return {
        ok: false,
        detail: input.areaCode
          ? `No voice-and-SMS number is available in area code ${input.areaCode}. Try another area code.`
          : "No eligible Twilio number is currently available.",
      };
    }

    const purchaseResponse = await twilioFormRequest(
      `${TWILIO_BASE}/Accounts/${encodeURIComponent(account.sid)}/IncomingPhoneNumbers.json`,
      childCredentials,
      new URLSearchParams({
        PhoneNumber: phoneNumber,
        FriendlyName: input.clientName,
        SmsUrl: input.smsUrl,
        SmsMethod: "POST",
        VoiceUrl: input.voiceUrl,
        VoiceMethod: "POST",
        StatusCallback: input.voiceStatusUrl,
        StatusCallbackMethod: "POST",
      }),
    );

    if (!purchaseResponse.ok) {
      await closeUnusedSubaccount();
      return {
        ok: false,
        detail: `The Twilio subaccount was created, but number purchase failed (${purchaseResponse.status}).`,
      };
    }

    return {
      ok: true,
      credentials: {
        ...childCredentials,
        fromNumber: phoneNumber,
        phoneHandlingMode: "ai_answered",
      },
      detail: `${phoneNumber} was purchased and configured for voice and SMS. The client's existing number can forward to it or be ported later.`,
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error
          ? error.message
          : "The phone number could not be provisioned.",
    };
  }
}

type TwilioIncomingNumber = {
  sid?: string;
  phone_number?: string;
  friendly_name?: string;
  capabilities?: { sms?: boolean; voice?: boolean };
};

async function findIncomingNumber(
  credentials: TwilioCredentials,
): Promise<TwilioIncomingNumber | null> {
  const response = await fetch(
    `${TWILIO_BASE}/Accounts/${encodeURIComponent(credentials.accountSid)}` +
      `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(credentials.fromNumber)}&PageSize=1`,
    {
      headers: { Authorization: authHeader(credentials) },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) return null;

  const body = (await response.json()) as {
    incoming_phone_numbers?: TwilioIncomingNumber[];
  };

  return body.incoming_phone_numbers?.[0] ?? null;
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

    const number = await findIncomingNumber(credentials);

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
          "This Twilio number must support both SMS and Voice for the full phone package.",
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

export async function configureTwilioNumber(
  credentials: TwilioCredentials,
  input: {
    smsUrl: string;
    voiceUrl: string;
    voiceStatusUrl: string;
  },
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  try {
    const number = await findIncomingNumber(credentials);

    if (!number?.sid) {
      return {
        ok: false,
        detail:
          "The Twilio number could not be found for automatic configuration.",
      };
    }

    const params = new URLSearchParams({
      SmsUrl: input.smsUrl,
      SmsMethod: "POST",
      VoiceUrl: input.voiceUrl,
      VoiceMethod: "POST",
      StatusCallback: input.voiceStatusUrl,
      StatusCallbackMethod: "POST",
    });
    const response = await fetch(
      `${TWILIO_BASE}/Accounts/${encodeURIComponent(credentials.accountSid)}` +
        `/IncomingPhoneNumbers/${encodeURIComponent(number.sid)}.json`,
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
      return {
        ok: false,
        detail: `Twilio accepted the credentials but could not update the phone number (${response.status}).`,
      };
    }

    return {
      ok: true,
      detail:
        "Twilio is connected and the number's SMS, incoming-call, and hangup webhooks were configured automatically.",
    };
  } catch {
    return {
      ok: false,
      detail:
        "Twilio is connected, but the number could not be configured automatically.",
    };
  }
}

export type TwilioSendOutcome = {
  messageSid: string;
  status: string;
};

export type TwilioCallOutcome = {
  callSid: string;
  status: string;
};

async function twilioError(
  response: Response,
  prefix: string,
): Promise<TwilioError> {
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
    // Keep the status-only detail when Twilio does not return JSON.
  }

  return new TwilioError(`${prefix}: ${detail}`, response.status);
}

export async function createOutboundCall(
  credentials: TwilioCredentials,
  input: {
    to: string;
    twiml: string;
    statusCallbackUrl: string;
  },
): Promise<TwilioCallOutcome> {
  const params = new URLSearchParams({
    From: credentials.fromNumber,
    To: input.to,
    Twiml: input.twiml,
    StatusCallback: input.statusCallbackUrl,
    StatusCallbackMethod: "POST",
  });
  const response = await twilioFormRequest(
    `${TWILIO_BASE}/Accounts/${encodeURIComponent(credentials.accountSid)}/Calls.json`,
    credentials,
    params,
  );

  if (!response.ok) {
    throw await twilioError(response, "Twilio call failed");
  }

  const call = (await response.json()) as { sid: string; status: string };
  return { callSid: call.sid, status: call.status };
}

export async function completeTwilioCall(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  callSid: string,
): Promise<void> {
  const response = await twilioFormRequest(
    `${TWILIO_BASE}/Accounts/${encodeURIComponent(credentials.accountSid)}` +
      `/Calls/${encodeURIComponent(callSid)}.json`,
    credentials,
    new URLSearchParams({ Status: "completed" }),
  );

  if (!response.ok) {
    throw await twilioError(response, "Twilio hangup failed");
  }
}

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
    throw await twilioError(response, "Twilio send failed");
  }

  const message = (await response.json()) as { sid: string; status: string };

  return { messageSid: message.sid, status: message.status };
}
