/* =========================================================
   ADSGRAM CONFIG
========================================================= */

const ADSGRAM_BLOCK_ID =
    String(
        process.env.ADSGRAM_BLOCK_ID || "48045"
    );

const ADSGRAM_PENDING_MAX_SECONDS =
    15 * 60;


/* =========================================================
   ADSGRAM REWARD URL
=========================================================

   AdsGram calls:

   GET /api/adsgram/reward?userid=[userId]

   IMPORTANT:

   The public Reward URL does NOT accept adType.

   The backend determines the ad type from the
   pending intent stored in PostgreSQL.

========================================================= */

export async function confirmAdsgramReward({
    telegramId
}) {

    if (!telegramId) {

        const error = new Error(
            "Missing Telegram user ID."
        );

        error.code =
            "USER_NOT_FOUND";

        throw error;
    }


    const client =
        await pool.connect();

    try {

        await client.query(
            "BEGIN"
        );


        const user =
            await getUserByTelegramId(
                client,
                telegramId
            );


        /*
         * Find the newest valid pending AdsGram
         * intent created within the last 15 minutes.
         */

        const pending =
            await client.query(
                `
                SELECT *
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND status = 'pending'
                  AND created_at >=
                      NOW() -
                      ($2 * INTERVAL '1 second')
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
                `,
                [
                    user.id,
                    ADSGRAM_PENDING_MAX_SECONDS
                ]
            );


        if (!pending.rows[0]) {

            const error = new Error(
                "No pending ad reward."
            );

            error.code =
                "NO_PENDING_AD";

            throw error;
        }


        const reward =
            pending.rows[0];


        /*
         * IMPORTANT:
         *
         * ad_type comes from our PostgreSQL record,
         * not from the browser or AdsGram URL.
         */

        const adType =
            reward.ad_type;


        if (
            !AD_TYPES.includes(adType)
        ) {

            const error = new Error(
                "Invalid stored ad type."
            );

            error.code =
                "INVALID_AD_TYPE";

            throw error;
        }


        /*
         * Create unique AdsGram reward ID.
         */

        const externalRewardId =
            `adsgram:${ADSGRAM_BLOCK_ID}:${reward.id}`;


        /*
         * Confirm the reward exactly once.
         */

        const updated =
            await client.query(
                `
                UPDATE ad_rewards
                SET
                    status = 'confirmed',
                    external_reward_id = $2,
                    confirmed_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                RETURNING *
                `,
                [
                    reward.id,
                    externalRewardId
                ]
            );


        if (!updated.rows[0]) {

            const error = new Error(
                "Ad reward was already processed."
            );

            error.code =
                "AD_ALREADY_PROCESSED";

            throw error;
        }


        await client.query(
            "COMMIT"
        );


        return updated.rows[0];

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();

    }
}
