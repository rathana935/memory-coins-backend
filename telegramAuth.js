import crypto from "crypto";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.warn(
        "WARNING: BOT_TOKEN environment variable is not set."
    );
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

        // Remove hash before creating data-check-string
        params.delete("hash");

        const dataCheckString = [...params.entries()]
            .sort(([keyA], [keyB]) =>
                keyA.localeCompare(keyB)
            )
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        /*
         * Telegram Web App validation:
         *
         * secret_key = HMAC-SHA256(
         *     key = "WebAppData",
         *     message = BOT_TOKEN
         * )
         */
        const secretKey = crypto
            .createHmac("sha256", "WebAppData")
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        // Validate hexadecimal hash format first
        if (!/^[0-9a-fA-F]{64}$/.test(receivedHash)) {
            return {
                valid: false,
                user: null,
                error: "Invalid Telegram hash format"
            };
        }

        const receivedBuffer = Buffer.from(
            receivedHash,
            "hex"
        );

        const calculatedBuffer = Buffer.from(
            calculatedHash,
            "hex"
        );

        if (
            receivedBuffer.length !== calculatedBuffer.length ||
            !crypto.timingSafeEqual(
                receivedBuffer,
                calculatedBuffer
            )
        ) {
            return {
                valid: false,
                user: null,
                error: "Invalid Telegram signature"
            };
        }

        /*
         * Validate auth_date
         */
        const authDate = Number(
            params.get("auth_date")
        );

        if (
            !Number.isInteger(authDate) ||
            authDate <= 0
        ) {
            return {
                valid: false,
                user: null,
                error: "Missing or invalid auth_date"
            };
        }

        /*
         * Reject initData older than 24 hours.
         */
        const now = Math.floor(
            Date.now() / 1000
        );

        if (now - authDate > 86400) {
            return {
                valid: false,
                user: null,
                error: "Telegram initData has expired"
            };
        }

        /*
         * Prevent future-dated data.
         */
        if (authDate > now + 60) {
            return {
                valid: false,
                user: null,
                error: "Telegram auth_date is invalid"
            };
        }

        /*
         * Extract Telegram user
         */
        const userString = params.get("user");

        if (!userString) {
            return {
                valid: false,
                user: null,
                error: "Telegram user data is missing"
            };
        }

        let user;

        try {
            user = JSON.parse(userString);
        } catch {
            return {
                valid: false,
                user: null,
                error: "Invalid Telegram user data"
            };
        }

        if (!user || !user.id) {
            return {
                valid: false,
                user: null,
                error: "Telegram user ID is missing"
            };
        }

        return {
            valid: true,
            user
        };

    } catch (error) {
        console.error(
            "Telegram initData validation error:",
            error
        );

        return {
            valid: false,
            user: null,
            error: "Invalid Telegram initData"
        };
    }
}
