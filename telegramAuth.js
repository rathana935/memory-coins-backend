import crypto from "crypto";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.warn("WARNING: BOT_TOKEN environment variable is not set.");
}

export function validateTelegramInitData(initData) {
    if (!initData || typeof initData !== "string") {
        return {
            valid: false,
            user: null,
            error: "Missing Telegram initData"
        };
    }

    if (!BOT_TOKEN) {
        return {
            valid: false,
            user: null,
            error: "BOT_TOKEN is not configured"
        };
    }

    try {
        const params = new URLSearchParams(initData);

        const receivedHash = params.get("hash");

        if (!receivedHash) {
            return {
                valid: false,
                user: null,
                error: "Missing hash"
            };
        }

        params.delete("hash");

        const dataCheckString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        const secretKey = crypto
            .createHmac("sha256", "WebAppData")
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        const receivedBuffer = Buffer.from(receivedHash, "hex");
        const calculatedBuffer = Buffer.from(calculatedHash, "hex");

        if (
            receivedBuffer.length !== calculatedBuffer.length ||
            !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
        ) {
            return {
                valid: false,
                user: null,
                error: "Invalid Telegram signature"
            };
        }

        const authDate = Number(params.get("auth_date"));

        if (!authDate || !Number.isFinite(authDate)) {
            return {
                valid: false,
                user: null,
                error: "Missing or invalid auth_date"
            };
        }

        // Reject data older than 24 hours.
        const now = Math.floor(Date.now() / 1000);

        if (now - authDate > 86400) {
            return {
                valid: false,
                user: null,
                error: "Telegram initData has expired"
            };
        }

        let user = null;

        const userString = params.get("user");

        if (userString) {
            try {
                user = JSON.parse(userString);
            } catch {
                return {
                    valid: false,
                    user: null,
                    error: "Invalid Telegram user data"
                };
            }
        }

        return {
            valid: true,
            user
        };

    } catch (error) {
        console.error("Telegram initData validation error:", error);

        return {
            valid: false,
            user: null,
            error: "Invalid Telegram initData"
        };
    }
}
