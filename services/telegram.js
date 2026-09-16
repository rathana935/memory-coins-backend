import crypto from "crypto";


/* =========================================================
   CONFIGURATION
========================================================= */

const BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;


const MAX_AUTH_AGE =
    Number(
        process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ||
        86400
    );


/* =========================================================
   VALIDATE CONFIGURATION
========================================================= */

if (
    !Number.isFinite(MAX_AUTH_AGE) ||
    MAX_AUTH_AGE <= 0
) {
    throw new Error(
        "TELEGRAM_AUTH_MAX_AGE_SECONDS must be a positive number"
    );
}


/* =========================================================
   VALIDATE TELEGRAM MINI APP INIT DATA
========================================================= */

export function validateTelegramInitData(
    initData
) {

    /* =====================================================
       BOT TOKEN
    ===================================================== */

    if (!BOT_TOKEN) {

        throw new Error(
            "TELEGRAM_BOT_TOKEN is not configured"
        );

    }


    /* =====================================================
       INIT DATA
    ===================================================== */

    if (
        typeof initData !== "string" ||
        initData.trim().length === 0
    ) {

        throw new Error(
            "Telegram initData is required"
        );

    }


    /*
       Prevent unnecessarily large input.
       Telegram Mini App initData should be relatively small.
    */

    if (initData.length > 10000) {

        throw new Error(
            "Telegram initData is too large"
        );

    }


    /* =====================================================
       PARSE INIT DATA
    ===================================================== */

    const params =
        new URLSearchParams(
            initData
        );


    /* =====================================================
       TELEGRAM HASH
    ===================================================== */

    const receivedHash =
        params.get("hash");


    if (
        !receivedHash ||
        !/^[a-f0-9]{64}$/i.test(receivedHash)
    ) {

        throw new Error(
            "Invalid Telegram hash"
        );

    }


    /* =====================================================
       REMOVE HASH
    ===================================================== */

    params.delete("hash");


    /* =====================================================
       DATA CHECK STRING
    ===================================================== */

    const dataCheckString =
        [...params.entries()]
            .sort(
                ([keyA], [keyB]) =>
                    keyA.localeCompare(keyB)
            )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");


    if (!dataCheckString) {

        throw new Error(
            "Telegram authentication data is empty"
        );

    }


    /* =====================================================
       TELEGRAM SECRET KEY
    ===================================================== */

    const secretKey =
        crypto
            .createHmac(
                "sha256",
                "WebAppData"
            )
            .update(BOT_TOKEN)
            .digest();


    /* =====================================================
       CALCULATE TELEGRAM HASH
    ===================================================== */

    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(dataCheckString)
            .digest("hex");


    /* =====================================================
       SAFE HASH COMPARISON
    ===================================================== */

    const receivedBuffer =
        Buffer.from(
            receivedHash,
            "hex"
        );


    const calculatedBuffer =
        Buffer.from(
            calculatedHash,
            "hex"
        );


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


    /* =====================================================
       AUTH DATE
    ===================================================== */

    const authDate =
        Number(
            params.get("auth_date")
        );


    if (
        !Number.isSafeInteger(authDate) ||
        authDate <= 0
    ) {

        throw new Error(
            "Invalid Telegram auth_date"
        );

    }


    /* =====================================================
       AUTH AGE
    ===================================================== */

    const now =
        Math.floor(
            Date.now() / 1000
        );


    const age =
        now - authDate;


    /*
       Future timestamps are rejected.
    */

    if (age < 0) {

        throw new Error(
            "Invalid Telegram authentication date"
        );

    }


    if (age > MAX_AUTH_AGE) {

        throw new Error(
            "Telegram authentication data expired"
        );

    }


    /* =====================================================
       TELEGRAM USER
    ===================================================== */

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


    /* =====================================================
       VALIDATE USER
    ===================================================== */

    if (
        !user ||
        typeof user !== "object" ||
        !user.id
    ) {

        throw new Error(
            "Telegram user ID missing"
        );

    }


    const telegramUserId =
        Number(user.id);


    if (
        !Number.isSafeInteger(
            telegramUserId
        ) ||
        telegramUserId <= 0
    ) {

        throw new Error(
            "Invalid Telegram user ID"
        );

    }


    /* =====================================================
       START PARAM
       
       Used by the referral system.

       Example:

       start_param=ref_123456789
    ===================================================== */

    const startParam =
        params.get("start_param") ||
        null;


    /* =====================================================
       QUERY ID
    ===================================================== */

    const queryId =
        params.get("query_id") ||
        null;


    /* =====================================================
       RETURN VERIFIED DATA
    ===================================================== */

    return {

        user,

        authDate,

        queryId,

        start_param:
            startParam,

        startParam

    };

}
