import crypto from "crypto";
import { pool } from "../db/pool.js";


/* =========================================================
   CONFIG
========================================================= */

const DEFAULT_DAILY_BONUS = 100;
const DEFAULT_REFERRAL_REWARD = 250;

const AD_TYPES = [
    "life",
    "double_reward",
    "lucky_roll"
];

const LIFE_AD_REWARD = 1;

const LUCKY_ROLL_COOLDOWN_SECONDS = 300;


/* =========================================================
   HELPERS
========================================================= */

function isUUID(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || "")
    );
}


function getCambodiaDate() {

    return new Intl.DateTimeFormat(
        "en-CA",
        {
            timeZone: "Asia/Phnom_Penh",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).format(new Date());

}


function calculateLuckyReward(number) {

    if (number >= 99999) {
        return 10000;
    }

    if (number >= 99997) {
        return 82;
    }

    if (number >= 99500) {
        return 18;
    }

    if (number >= 95000) {
        return 12;
    }

    if (number >= 90000) {
        return 8;
    }

    return 5;
}


function generateLuckyNumber() {

    return crypto.randomInt(
        1,
        100000
    );

}


/* =========================================================
   USER
========================================================= */

async function getUserByTelegramId(
    client,
    telegramId
) {

    const result = await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        LIMIT 1
        `,
        [String(telegramId)]
    );

    if (!result.rows[0]) {

        const error = new Error(
            "Telegram user not found."
        );

        error.code = "USER_NOT_FOUND";

        throw error;
    }

    return result.rows[0];
}


/* =========================================================
   SERVER SETTINGS
========================================================= */

async function getSetting(
    client,
    key,
    fallback
) {

    const result = await client.query(
        `
        SELECT value
        FROM app_settings
        WHERE key = $1
        LIMIT 1
        `,
        [key]
    );

    if (!result.rows[0]) {
        return fallback;
    }

    return result.rows[0].value;
}


async
