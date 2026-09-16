import crypto from "crypto";

/* =========================================================
   CONFIG
========================================================= */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const MAX_AUTH_AGE_SECONDS = Number(
    process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || 86400
);


/* =========================================================
   VALIDATION
========================================================= */

if (!TELEGRAM_BOT_TOKEN) {
    console.warn(
        "WARNING: TELEGRAM_BOT_TOKEN is not set."
    );
}


/* =========================================================
   HELPERS
========================================================= */

function parseInitData(initData) {
    const params = new URLSearchParams(initData);

    const data = {};

    for (const [key, value] of params.entries()) {
        data[key] = value;
    }

    return {
        params,
        data
    };
}


function createDataCheckString(params) {
    return [...params.entries()]
        .filter(([key]) => key !== "hash")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
}


function createTelegramSecretKey() {
    return crypto
        .createHash("sha256")
        .update(TELEGRAM_BOT_TOKEN)
        .digest();
}


function safeCompareHex(a, b) {
    if (!a || !b) {
        return false;
    }

    const aBuffer = Buffer.from(a, "hex");
    const bBuffer = Buffer.from(b, "hex");

    if (aBuffer.length !== bBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(aBuffer, bBuffer);
}


/* =========================================================
   MAIN VALIDATION
========================================================= */

export function validateTelegramInitData(initData) {
    if (!TELEGRAM_BOT_TOKEN) {
        const error = new Error(
            "TELEGRAM_BOT_TOKEN is not configured."
        );

        error.code = "TELEGRAM_BOT_TOKEN_MISSING";

        throw error;
    }

    if (
        typeof initData !== "string" ||
        !initData.trim()
    ) {
        const error = new Error(
            "Telegram initData is required."
        );

        error.code = "INIT_DATA_MISSING";

        throw error;
    }

    const { params, data } = parseInitData(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
        const error = new Error(
            "Telegram initData hash is missing."
        );

        error.code = "HASH_MISSING";

        throw error;
    }


    /* -----------------------------------------------------
       Validate hash
    ----------------------------------------------------- */

    const dataCheckString =
        createDataCheckString(params);

    const secretKey =
        createTelegramSecretKey();

    const calculatedHash =
        crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

    if (
        !safeCompareHex(
            receivedHash,
            calculatedHash
        )
    ) {
        const error = new Error(
            "Invalid Telegram initData signature."
        );

        error.code = "INVALID_HASH";

        throw error;
    }


    /* -----------------------------------------------------
       Validate auth_date
    ----------------------------------------------------- */

    const authDate = Number(
        params.get("auth_date")
    );

    if (
        !Number.isInteger(authDate) ||
        authDate <= 0
    ) {
        const error = new Error(
            "Invalid Telegram auth_date."
        );

        error.code = "INVALID_AUTH_DATE";

        throw error;
    }

    const now = Math.floor(
        Date.now() / 1000
    );

    const age = now - authDate;

    if (
        age < 0 ||
        age > MAX_AUTH_AGE_SECONDS
    ) {
        const error = new Error(
            "Telegram initData has expired."
        );

        error.code = "AUTH_DATA_EXPIRED";

        throw error;
    }


    /* -----------------------------------------------------
       Parse Telegram user
    ----------------------------------------------------- */

    const userRaw = params.get("user");

    if (!userRaw) {
        const error = new Error(
            "Telegram user data is missing."
        );

        error.code = "USER_MISSING";

        throw error;
    }

    let user;

    try {
        user = JSON.parse(userRaw);
    } catch {
        const error = new Error(
            "Invalid Telegram user JSON."
        );

        error.code = "INVALID_USER_JSON";

        throw error;
    }


    /* -----------------------------------------------------
       Validate Telegram user ID
    ----------------------------------------------------- */

    const telegramId =
        Number(user.id);

    if (
        !Number.isSafeInteger(telegramId) ||
        telegramId <= 0
    ) {
        const error = new Error(
            "Invalid Telegram user ID."
        );

        error.code = "INVALID_TELEGRAM_USER_ID";

        throw error;
    }


    /* -----------------------------------------------------
       Return validated data
    ----------------------------------------------------- */

    return {
        user: {
            ...user,
            id: telegramId
        },

        authDate,

        queryId:
            params.get("query_id") || null,

        start_param:
            params.get("start_param") || null,

        startParam:
            params.get("start_param") || null
    };
}


/* =========================================================
   DEFAULT EXPORT
========================================================= */

export default validateTelegramInitData;
