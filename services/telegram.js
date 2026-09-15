import crypto from "crypto";

const BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;

const MAX_AUTH_AGE =
    Number(
        process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ||
        86400
    );


/*
============================================================
Validate Telegram Mini App initData
============================================================
*/

export function validateTelegramInitData(
    initData
) {

    /* ======================================================
       CHECK BOT TOKEN
    ====================================================== */

    if (!BOT_TOKEN) {

        throw new Error(
            "TELEGRAM_BOT_TOKEN is not configured"
        );

    }


    /* ======================================================
       CHECK INIT DATA
    ====================================================== */

    if (
        !initData ||
        typeof initData !== "string"
    ) {

        throw new Error(
            "Telegram initData is required"
        );

    }


    /* ======================================================
       PARSE INIT DATA
    ====================================================== */

    const params =
        new URLSearchParams(
            initData
        );


    const receivedHash =
        params.get("hash");


    if (!receivedHash) {

        throw new Error(
            "Telegram hash is missing"
        );

    }


    /* ======================================================
       REMOVE HASH
    ====================================================== */

    params.delete("hash");


    /* ======================================================
       CREATE DATA CHECK STRING
    ====================================================== */

    const dataCheckString =
        [...params.entries()]
            .sort(
                ([a], [b]) =>
                    a.localeCompare(b)
            )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");


    /* ======================================================
       CREATE TELEGRAM SECRET KEY
    ====================================================== */

    const secretKey =
        crypto
            .createHmac(
                "sha256",
                "WebAppData"
            )
            .update(BOT_TOKEN)
            .digest();


    /* ======================================================
       CALCULATE TELEGRAM HASH
    ====================================================== */

    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(dataCheckString)
            .digest("hex");


    /* ======================================================
       SAFE HASH COMPARISON
    ====================================================== */

    let receivedBuffer;

    let calculatedBuffer;


    try {

        receivedBuffer =
            Buffer.from(
                receivedHash,
                "hex"
            );

        calculatedBuffer =
            Buffer.from(
                calculatedHash,
                "hex"
            );

    } catch {

        throw new Error(
            "Invalid Telegram signature"
        );

    }


    if (
        receivedBuffer.length !==
        calculatedBuffer.length
    ) {

        throw new Error(
            "Invalid Telegram signature"
        );

    }


    if (
        !crypto.timingSafeEqual(
            receivedBuffer,
            calculatedBuffer
        )
    ) {

        throw new Error(
            "Invalid Telegram signature"
        );

    }


    /* ======================================================
       CHECK AUTH DATE
    ====================================================== */

    const authDate =
        Number(
            params.get("auth_date")
        );


    if (
        !authDate ||
        !Number.isFinite(authDate)
    ) {

        throw new Error(
            "Invalid Telegram auth_date"
        );

    }


    const now =
        Math.floor(
            Date.now() / 1000
        );


    const age =
        now - authDate;


    if (
        age < 0 ||
        age > MAX_AUTH_AGE
    ) {

        throw new Error(
            "Telegram authentication data expired"
        );

    }


    /* ======================================================
       GET TELEGRAM USER
    ====================================================== */

    const userRaw =
        params.get("user");


    if (!userRaw) {

        throw new Error(
            "Telegram user data missing"
        );

    }


    let user;


    try {

        user =
            JSON.parse(
                userRaw
            );

    } catch {

        throw new Error(
            "Invalid Telegram user JSON"
        );

    }


    if (
        !user ||
        !user.id
    ) {

        throw new Error(
            "Telegram user ID missing"
        );

    }


    /* ======================================================
       GET START PARAM
       
       This is important for referrals.

       Example:

       https://t.me/YourBot?startapp=ref_123456789

       Telegram Mini App initData can contain:

       start_param=ref_123456789
    ====================================================== */

    const startParam =
        params.get("start_param") ||
        null;


    /* ======================================================
       GET QUERY ID
    ====================================================== */

    const queryId =
        params.get("query_id") ||
        null;


    /* ======================================================
       RETURN VERIFIED TELEGRAM DATA
    ====================================================== */

    return {

        user,

        authDate,

        queryId,

        start_param:
            startParam,

        /*
        Also expose camelCase version
        for compatibility.
        */

        startParam

    };

}
