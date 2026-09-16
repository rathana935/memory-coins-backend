import crypto from "crypto";

import pool from "../db/pool.js";


/* =========================================================
   HASH SESSION TOKEN
========================================================= */

function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}


/* =========================================================
   EXTRACT BEARER TOKEN
========================================================= */

function getBearerToken(req) {

    const authorization =
        req.headers.authorization;

    if (
        typeof authorization !== "string"
    ) {
        return null;
    }

    if (
        !authorization.startsWith("Bearer ")
    ) {
        return null;
    }

    const token =
        authorization
            .substring(7)
            .trim();

    if (!token) {
        return null;
    }

    return token;
}


/* =========================================================
   REQUIRE AUTHENTICATION
========================================================= */

export async function requireAuth(
    req,
    res,
    next
) {

    try {

        /* =================================================
           GET TOKEN
        ================================================= */

        const token =
            getBearerToken(req);


        if (!token) {

            return res.status(401).json({

                success: false,

                error:
                    "Authentication required"
            });
        }


        /* =================================================
           HASH TOKEN
        ================================================= */

        const tokenHash =
            hashToken(token);


        /* =================================================
           FIND ACTIVE SESSION
           
           IMPORTANT:
           auth.js stores the SHA-256 hash in
           auth_sessions.token_hash.
        ================================================= */

        const sessionResult =
            await pool.query(
                `
                SELECT
                    s.id AS session_id,
                    s.user_id,
                    s.expires_at,

                    u.id,
                    u.telegram_id,
                    u.username,
                    u.first_name,
                    u.last_name,
                    u.photo_url,
                    u.language_code,
                    u.is_premium

                FROM auth_sessions s

                INNER JOIN users u
                    ON u.id = s.user_id

                WHERE s.token_hash = $1

                  AND s.expires_at > NOW()

                LIMIT 1
                `,
                [tokenHash]
            );


        /* =================================================
           INVALID / EXPIRED SESSION
        ================================================= */

        if (
            sessionResult.rows.length === 0
        ) {

            return res.status(401).json({

                success: false,

                error:
                    "Invalid or expired authentication token"
            });
        }


        /* =================================================
           SESSION FOUND
        ================================================= */

        const session =
            sessionResult.rows[0];


        /* =================================================
           ATTACH AUTHENTICATED USER
           
           auth.js /me supports both user_id and id.
        ================================================= */

        req.user = {

            id:
                session.user_id,

            user_id:
                session.user_id,

            session_id:
                session.session_id,

            telegram_id:
                session.telegram_id,

            username:
                session.username,

            first_name:
                session.first_name,

            last_name:
                session.last_name,

            photo_url:
                session.photo_url,

            language_code:
                session.language_code,

            is_premium:
                session.is_premium,

            expires_at:
                session.expires_at
        };


        /* =================================================
           OPTIONAL LAST-SEEN UPDATE
           
           This failure must never block authentication.
        ================================================= */

        try {

            await pool.query(
                `
                UPDATE users

                SET
                    last_seen_at = NOW(),
                    updated_at = NOW()

                WHERE id = $1
                `,
                [session.user_id]
            );

        } catch (error) {

            console.error(
                "Unable to update user last_seen_at:",
                error
            );
        }


        /* =================================================
           CONTINUE
        ================================================= */

        return next();


    } catch (error) {

        console.error(
            "Authentication middleware error:",
            error
        );


        return res.status(500).json({

            success: false,

            error:
                "Authentication service unavailable"
        });
    }
}


/* =========================================================
   OPTIONAL AUTHENTICATION
========================================================= */

export async function optionalAuth(
    req,
    res,
    next
) {

    try {

        const token =
            getBearerToken(req);


        if (!token) {

            req.user = null;

            return next();
        }


        const tokenHash =
            hashToken(token);


        const result =
            await pool.query(
                `
                SELECT
                    s.id AS session_id,
                    s.user_id,
                    s.expires_at,

                    u.id,
                    u.telegram_id,
                    u.username,
                    u.first_name,
                    u.last_name,
                    u.photo_url,
                    u.language_code,
                    u.is_premium

                FROM auth_sessions s

                INNER JOIN users u
                    ON u.id = s.user_id

                WHERE s.token_hash = $1

                  AND s.expires_at > NOW()

                LIMIT 1
                `,
                [tokenHash]
            );


        if (
            result.rows.length === 0
        ) {

            req.user = null;

            return next();
        }


        const session =
            result.rows[0];


        req.user = {

            id:
                session.user_id,

            user_id:
                session.user_id,

            session_id:
                session.session_id,

            telegram_id:
                session.telegram_id,

            username:
                session.username,

            first_name:
                session.first_name,

            last_name:
                session.last_name,

            photo_url:
                session.photo_url,

            language_code:
                session.language_code,

            is_premium:
                session.is_premium,

            expires_at:
                session.expires_at
        };


        return next();


    } catch (error) {

        console.error(
            "Optional authentication error:",
            error
        );

        req.user = null;

        return next();
    }
}


/* =========================================================
   EXPORT DEFAULT
========================================================= */

export default requireAuth;

Your authentication flow is now

Telegram Mini App
       ↓
tg.initData
       ↓
POST /api/auth/telegram
       ↓
validateTelegramInitData()
       ↓
Create/find users row
       ↓
Generate random session token
       ↓
SHA-256 token
       ↓
Store hash in auth_sessions
       ↓
Return token + authToken
       ↓
Frontend stores authToken
       ↓
GET /api/auth/me
       ↓
Authorization: Bearer <token>
       ↓
requireAuth()
       ↓
SHA-256 <token>
       ↓
Find matching auth_sessions.token_hash
       ↓
Check expires_at > NOW()
       ↓
req.user.user_id
       ↓
/api/auth/me succeeds

One important frontend check

Your protected requests must actually send the token:

const token = localStorage.getItem("authToken");

const response = await fetch(
    `${API_URL}/api/auth/me`,
    {
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        }
    }
);

And your Telegram login should save the response token:

const data = await response.json();

if (!response.ok || !data.success) {
    throw new Error(
        data.error || "Authentication failed"
    );
}

localStorage.setItem(
    "authToken",
    data.authToken
);

Do not put "BOT_TOKEN" in the frontend. It belongs only in the Render backend environment variables.

If these two files are deployed together, the next file to check if you still receive “Authentication required” is the frontend authentication/API code, because at that point the backend middleware and route are using the same token/hash/session format.
