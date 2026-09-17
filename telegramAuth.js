import crypto from "crypto";

/* =========================================================
   TELEGRAM AUTH CONFIG
========================================================= */

const BOT_TOKEN =
    process.env.BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN;


/* =========================================================
   VALIDATION
========================================================= */

if (!BOT_TOKEN) {
    console.warn(
        "WARNING: BOT_TOKEN / TELEGRAM_BOT_TOKEN is not configured."
    );
}


/* =========================================================
   CONSTANT-TIME COMPARISON
========================================================= */

function safeCompare(a, b) {
    if (
        typeof a !== "string" ||
        typeof b !== "string"
    ) {
        return false;
    }

    const aBuffer =
        Buffer.from(a, "utf8");

    const bBuffer =
        Buffer.from(b, "utf8");

    if (
        aBuffer.length !== bBuffer.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        aBuffer,
        bBuffer
    );
}


/* =========================================================
   PARSE TELEGRAM INIT DATA
========================================================= */

function parseInitData(initData) {

    if (
        typeof initData !== "string"
    ) {
        throw new Error(
            "Telegram initData must be a string."
        );
    }


    const cleanInitData =
        initData.trim();


    if (!cleanInitData) {
        throw new Error(
            "Telegram initData is empty."
        );
    }


    const params =
        new URLSearchParams(
            cleanInitData
        );


    const data = {};

    for (
        const [key, value]
        of params.entries()
    ) {

        data[key] = value;

    }


    return {
        params,
        data
    };
}


/* =========================================================
   VALIDATE TELEGRAM WEB APP INIT DATA
========================================================= */

export function validateTelegramInitData(
    initData
) {

    if (!BOT_TOKEN) {

        const error =
            new Error(
                "Telegram bot token is not configured on the server."
            );

        error.statusCode = 500;

        throw error;
    }


    const {
        params,
        data
    } =
        parseInitData(
            initData
        );


    /* -------------------------------------------------------
       Telegram requires hash
    ------------------------------------------------------- */

    const receivedHash =
        params.get("hash");


    if (!receivedHash) {

        const error =
            new Error(
                "Telegram initData hash is missing."
            );

        error.statusCode = 401;

        throw error;
    }


    /* -------------------------------------------------------
       Remove hash before creating data-check-string
    ------------------------------------------------------- */

    params.delete("hash");


    /* -------------------------------------------------------
       Sort parameters alphabetically
    ------------------------------------------------------- */

    const dataCheckString =
        Array
            .from(params.entries())
            .sort(
                ([keyA], [keyB]) =>
                    keyA.localeCompare(keyB)
            )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");


    /* -------------------------------------------------------
       Telegram secret key
       
       HMAC-SHA256(bot_token, "WebAppData")
    ------------------------------------------------------- */

    const secretKey =
        crypto
            .createHmac(
                "sha256",
                "WebAppData"
            )
            .update(BOT_TOKEN)
            .digest();


    /* -------------------------------------------------------
       Calculate expected hash
    ------------------------------------------------------- */

    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(dataCheckString)
            .digest("hex");


    /* -------------------------------------------------------
       Compare hashes
    ------------------------------------------------------- */

    if (
        !safeCompare(
            calculatedHash,
            receivedHash
        )
    ) {

        const error =
            new Error(
                "Invalid Telegram initData signature."
            );

        error.statusCode = 401;

        throw error;
    }


    /* -------------------------------------------------------
       Parse auth_date
    ------------------------------------------------------- */

    const authDate =
        Number(
            data.auth_date
        );


    if (
        !Number.isFinite(authDate) ||
        authDate <= 0
    ) {

        const error =
            new Error(
                "Telegram auth_date is missing or invalid."
            );

        error.statusCode = 401;

        throw error;
    }


    /* -------------------------------------------------------
       Prevent very old initData
       
       24 hours is intentionally generous for Telegram
       Mini App authentication.
    ------------------------------------------------------- */

    const now =
        Math.floor(
            Date.now() / 1000
        );


    const MAX_AUTH_AGE =
        24 * 60 * 60;


    if (
        now - authDate >
        MAX_AUTH_AGE
    ) {

        const error =
            new Error(
                "Telegram initData has expired."
            );

        error.statusCode = 401;

        throw error;
    }


    /* -------------------------------------------------------
       Reject timestamps from the future
    ------------------------------------------------------- */

    if (
        authDate - now >
        60 * 60
    ) {

        const error =
            new Error(
                "Telegram initData timestamp is invalid."
            );

        error.statusCode = 401;

        throw error;
    }


    /* =======================================================
       PARSE TELEGRAM USER
    ======================================================= */

    let user = null;


    if (
        typeof data.user === "string" &&
        data.user.trim()
    ) {

        try {

            user =
                JSON.parse(
                    data.user
                );

        } catch (error) {

            console.error(
                "Failed to parse Telegram user:",
                error
            );

            const parseError =
                new Error(
                    "Telegram user information is invalid."
                );

            parseError.statusCode = 401;

            throw parseError;
        }

    }


    /* -------------------------------------------------------
       Telegram user must contain numeric ID
    ------------------------------------------------------- */

    if (
        !user ||
        user.id === undefined ||
        user.id === null
    ) {

        const error =
            new Error(
                "Telegram user information is missing."
            );

        error.statusCode = 401;

        throw error;
    }


    /* -------------------------------------------------------
       Normalize Telegram user
    ------------------------------------------------------- */

    user = {

        id:
            String(
                user.id
            ),

        username:
            user.username ||
            null,

        first_name:
            user.first_name ||
            null,

        last_name:
            user.last_name ||
            null,

        language_code:
            user.language_code ||
            null,

        photo_url:
            user.photo_url ||
            null,

        is_premium:
            Boolean(
                user.is_premium
            ),

        allows_write_to_pm:
            Boolean(
                user.allows_write_to_pm
            )

    };


    /* =======================================================
       RETURN VERIFIED TELEGRAM DATA
    ======================================================= */

    return {

        ...data,

        auth_date:
            authDate,

        hash:
            receivedHash,

        user

    };

}


/* =========================================================
   DEFAULT EXPORT
========================================================= */

export default validateTelegramInitData;
