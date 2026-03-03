import { config } from "./config.js";

function getTwilioAuthHeader() {
  if (!config.twilioAccountSid || !config.twilioAuthToken) {
    throw new Error("Twilio credentials are missing");
  }
  return `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64")}`;
}

function getTwilioServiceBase() {
  if (!config.twilioVerifyServiceSid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID is required for Twilio OTP");
  }
  return `https://verify.twilio.com/v2/Services/${encodeURIComponent(config.twilioVerifyServiceSid)}`;
}

async function twilioFormPost(path, params) {
  const response = await fetch(`${getTwilioServiceBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: getTwilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params).toString()
  });

  if (!response.ok) {
    let details = "";
    try {
      const payload = await response.json();
      details = payload?.message || "";
    } catch {
      // Best effort parse; keep generic error below.
    }
    throw new Error(details ? `Twilio OTP error: ${details}` : "Twilio OTP request failed");
  }

  return response.json();
}

export async function sendOtpByProvider(phone) {
  if (config.smsProvider === "twilio") {
    const response = await twilioFormPost("/Verifications", {
      To: phone,
      Channel: "sms"
    });

    return {
      provider: "twilio",
      providerRef: response.sid,
      demoCode: null
    };
  }

  return {
    provider: "mock",
    providerRef: null,
    demoCode: null
  };
}

export async function verifyOtpByProvider({ phone, code, provider }) {
  if (provider === "twilio") {
    const response = await twilioFormPost("/VerificationChecks", {
      To: phone,
      Code: String(code)
    });

    return response.status === "approved";
  }

  return false;
}
