import crypto from "crypto";
import pool from "../db/pool.js";


function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}


/*
============================================================
REQUIRE AUTHENTICATED SESSION
============================================================
*/

export async function requireAuth(
    req,
    res,
    next
) {

    try {

        const header =
            req.headers.authorization;


        /*
        --------------------------------------------------------
        Check Authorization header
        --------------------------------------------------------
        */

        if (
            !header ||
            !header.startsWith("Bearer ")
        ) {

            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });

        }


        const token =
            header.substring(7).trim();


        if (!token) {

            return res.status(401).json({
                success: false,
                error: "Invalid session"
            });

        }


        /*
        --------------------------------------------------------
        Hash session token
        --------------------------------------------------------
        */

        const tokenHash =
            hashToken(token);


        /*
        --------------------------------------------------------
        Find session + user
        --------------------------------------------------------
        */

        const result =
            await pool.query(
                `
                SELECT
                    s.id AS session_id,
                    s.user_id,

                    u.id AS id,

                    u.telegram_id,
                    u.username,
                    u.first_name,
                    u.last_name,
                    u.photo_url,

                    u.coins,
                    u.today_coins,

                    u.games_played,
                    u.easy_games,
                    u.medium_games,
                    u.hard_games,

                    u.easy_level,
                    u.medium_level,
                    u.hard_level,

                    u.lives,
                    u.daily_streak,
                    u.last_daily_claim,

                    u.is_blocked

                FROM auth_sessions s

                JOIN users u
                    ON u.id = s.user_id

                WHERE s.token_hash = $1
                  AND s.expires_at > NOW()

                LIMIT 1
                `,
                [tokenHash]
            );


        /*
        --------------------------------------------------------
        Session not found
        --------------------------------------------------------
        */

        if (
            result.rowCount === 0
        ) {

            return res.status(401).json({
                success: false,
                error: "Session expired or invalid"
            });

        }


        const user =
            result.rows[0];


        /*
        --------------------------------------------------------
        Check blocked account
        --------------------------------------------------------
        */

        if (user.is_blocked) {

            return res.status(403).json({
                success: false,
                error: "Account blocked"
            });

        }


        /*
        --------------------------------------------------------
        Update session usage
        --------------------------------------------------------
        */

        await pool.query(
            `
            UPDATE auth_sessions

            SET last_used_at = NOW()

            WHERE id = $1
            `,
            [
                user.session_id
            ]
        );


        /*
        --------------------------------------------------------
        Update user's last seen time
        --------------------------------------------------------
        */

        await pool.query(
            `
            UPDATE users

            SET last_seen_at = NOW()

            WHERE id = $1
            `,
            [
                user.user_id
            ]
        );


        /*
        --------------------------------------------------------
        IMPORTANT FIX
        --------------------------------------------------------

        The backend previously provided:

            req.user.user_id

        while some routes use:

            req.user.id

        We now provide BOTH.

        --------------------------------------------------------
        */

        req.user = {

            ...user,

            id:
                user.user_id,

            user_id:
                user.user_id

        };


        /*
        --------------------------------------------------------
        Continue to protected route
        --------------------------------------------------------
        */

        next();


    } catch (error) {

        console.error(
            "Auth middleware error:",
            error
        );


        return res.status(500).json({
            success: false,
            error: "Authentication error"
        });

    }

}
