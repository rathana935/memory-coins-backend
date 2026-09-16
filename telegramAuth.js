const crypto = require("crypto");

function validateTelegramInitData(initData) {
  if (!initData || typeof initData !== "string") {
    throw new Error("Telegram initData is missing");
  }

  const botToken = String(
    process.env.TELEGRAM_BOT_TOKEN || ""
  ).trim();

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram initData hash is missing");
  }

  params.delete("hash");

  /*
   * Telegram requires the data-check-string
   * to be sorted alphabetically by parameter name.
   */
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  /*
   * Telegram Mini App authentication:
   *
   * secret_key =
   * HMAC-SHA256(
   *   key = "WebAppData",
   *   data = botToken
   * )
   */
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  /*
   * Calculate the expected Telegram hash.
   */
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const calculatedBuffer = Buffer.from(calculatedHash, "hex");

  /*
   * Compare hashes safely.
   */
  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error(
      "Invalid Telegram initData signature. Check that Render TELEGRAM_BOT_TOKEN belongs to the same bot that launches this Mini App."
    );
  }

  /*
   * Validate auth_date.
   */
  const authDate = Number(params.get("auth_date"));

  if (!Number.isFinite(authDate)) {
    throw new Error(
      "Telegram auth_date is missing or invalid"
    );
  }

  /*
   * Maximum age of Telegram authentication data.
   *
   * Default: 24 hours.
   */
  const maxAge = Number(
    process.env.MAX_AUTH_AGE || 86400
  );

  const now = Math.floor(Date.now() / 1000);

  /*
   * Allow a small clock difference.
   */
  if (authDate > now + 30) {
    throw new Error(
      "Telegram auth_date is from the future"
    );
  }

  /*
   * Reject old authentication data.
   */
  if (now - authDate > maxAge) {
    throw new Error(
      "Telegram initData has expired"
    );
  }

  /*
   * Read Telegram user information.
   */
  const userString = params.get("user");

  if (!userString) {
    throw new Error(
      "Telegram user data is missing"
    );
  }

  let user;

  try {
    user = JSON.parse(userString);
  } catch {
    throw new Error(
      "Telegram user data is invalid JSON"
    );
  }

  if (!user || !user.id) {
    throw new Error(
      "Telegram user ID is missing"
    );
  }

  /*
   * Return verified Telegram information.
   */
  return {
    user,
    authDate,
    queryId: params.get("query_id") || null
  };
}

module.exports = {
  validateTelegramInitData
};
