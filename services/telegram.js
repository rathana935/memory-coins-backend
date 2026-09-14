import crypto from "crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const MAX_AUTH_AGE =
    Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || 86400);


/*
============================================================
Validate Telegram Mini App initData
============================================================
*/

export function validateTelegramInitData(initData) {

    if (!BOT_TOKEN) {
        throw new Error(
            "TELEGRAM_BOT_TOKEN is not configured"
        );
    }

    if (
        !initData ||
        typeof initData !== "string"
    ) {
        throw new Error(
            "Telegram initData is required"
        );
    }


    const params =
        new URLSearchParams(initData);


    const receivedHash =
        params.get("hash");


    if (!receivedHash) {

        throw new Error(
            "Telegram hash is missing"
        );

    }


    /*
    Remove hash before generating
    data-check-string.
    */

    params.delete("hash");


    const dataCheckString =
        [...params.entries()]
            .sort(([a], [b]) =>
                a.localeCompare(b)
            )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");


    /*
    Telegram:

    secret_key =
    HMAC_SHA256(
        bot_token,
        "WebAppData"
    )
    */

    const secretKey =
        crypto
            .createHmac(
                "sha256",
                "WebAppData"
            )
            .update(BOT_TOKEN)
            .digest();


    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(dataCheckString)
            .digest("hex");


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


    /*
    Check auth_date so old
    authentication data cannot
    be reused indefinitely.
    */

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


    const age =
        Math.floor(
            Date.now() / 1000
        ) - authDate;


    if (
        age < 0 ||
        age > MAX_AUTH_AGE
    ) {

        throw new Error(
            "Telegram authentication data expired"
        );

    }


    /*
    Telegram sends user as JSON.
    */

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
            JSON.parse(userRaw);

    } catch {

        throw new Error(
            "Invalid Telegram user JSON"
        );

    }


    if (!user.id) {

        throw new Error(
            "Telegram user ID missing"
        );

    }


    return {
        user,
        authDate,
        queryId:
            params.get("query_id")
    };

}
