import "server-only";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
  const configuredBaseUrl = process.env.APP_BASE_URL;

  if (!endpoint || !secret || !configuredBaseUrl) {
    throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
  }

  let baseUrl: URL;
  let gatewayUrl: URL;
  try {
    baseUrl = new URL(configuredBaseUrl);
    gatewayUrl = new URL(endpoint);
  } catch {
    throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
  }

  if (
    process.env.NODE_ENV === "production" &&
    (baseUrl.protocol !== "https:" || gatewayUrl.protocol !== "https:")
  ) {
    throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
  }

  const verificationUrl = new URL("/verify-email", baseUrl);
  verificationUrl.hash = "token=" + encodeURIComponent(token);
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(verificationUrl.toString());
  const subject = "Verify your Mnemosyne account";
  const textBody =
    "Verify your Mnemosyne account by opening this link:\n\n" +
    verificationUrl.toString() +
    "\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.";
  const htmlBody =
    "<p>Confirm your email address to activate your Mnemosyne account.</p>" +
    '<p><a href="' + safeUrl + '">Verify email address</a></p>' +
    "<p>This link expires in 24 hours. If you did not create this account, ignore this message.</p>" +
    "<p>Account: " + safeEmail + "</p>";

  let response: Response;
  try {
    response = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        secret,
        to: email,
        subject,
        textBody,
        htmlBody,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
  }

  const payload = await response.json().catch(() => null) as { success?: unknown } | null;
  if (!response.ok || payload?.success !== true) {
    throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
  }
}
