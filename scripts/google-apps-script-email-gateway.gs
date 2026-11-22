/**
 * Mnemosyne email verification gateway.
 *
 * Deploy as a Google Apps Script Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Set Script Property MNEMOSYNE_EMAIL_SECRET to the same high-entropy value
 * as GOOGLE_APPS_SCRIPT_SECRET in the Mnemosyne server environment.
 *
 * The endpoint accepts only server-originated JSON that includes this secret.
 * Never put the secret in browser code, query strings, or source control.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: "Invalid request" });
    }

    var payload = JSON.parse(e.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties()
      .getProperty("MNEMOSYNE_EMAIL_SECRET");

    if (!expectedSecret || !payload.secret ||
        !constantTimeEqual(String(payload.secret), String(expectedSecret))) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    var recipient = String(payload.to || "").trim();
    var subject = String(payload.subject || "").trim();
    var textBody = String(payload.textBody || "");
    var htmlBody = String(payload.htmlBody || "");

    if (!isValidEmail(recipient) || !subject ||
        subject.length > 180 || !textBody || textBody.length > 10000 ||
        !htmlBody || htmlBody.length > 20000) {
      return jsonResponse({ success: false, error: "Invalid email payload" });
    }

    // Google enforces the account's daily recipient quota. The server applies
    // rate limits before reaching this gateway; this endpoint is not public UI.
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: "Mnemosyne",
    });

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Mnemosyne mail gateway error: " + String(error && error.message || error));
    return jsonResponse({ success: false, error: "Delivery failed" });
  }
}

function isValidEmail(email) {
  return email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  var mismatch = 0;
  for (var i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
