I found the important issue.

Your auth.js returns the session token as token and accessToken, not authToken:

return res.json({
    success: true,
    token: sessionToken,
    accessToken: sessionToken,
    ...
});

But your frontend from the earlier code was expecting/storing authToken. That mismatch can cause the next /api/me request to have no Bearer token, producing “Authentication required.”

Fix the frontend

After /api/auth/telegram, use:

const data = await response.json();

if (!response.ok || !data.success || !data.token) {
    throw new Error(
        data.error || "Telegram authentication failed"
    );
}

authToken = data.token;

localStorage.setItem(
    "authToken",
    authToken
);

Then every protected request must send:

headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`
}

Or make the backend match your existing frontend

If your frontend currently does:

authToken = data.authToken;

then the simplest backend fix is to add:

authToken: sessionToken,

to your successful response:

return res.json({
    success: true,

    token: sessionToken,

    accessToken: sessionToken,

    authToken: sessionToken,

    tokenType: "Bearer",

    expiresIn:
        sessionDays * 24 * 60 * 60,

    referral: {
        created: referralCreated,
        rewardCoins: referralReward,
        reward_coins: referralReward
    },

    user: serializedUser
});

That makes all three names work:

token
accessToken
authToken

However, there is one more file we need to verify: middleware/auth.js.

Your auth.js creates the session correctly, but requireAuth is what actually reads the Bearer token and looks it up in auth_sessions.

If requireAuth doesn't match this session structure, you'll still get Authentication required even after fixing the frontend.

Send me your middleware/auth.js next. I can check it against this auth.js and your PostgreSQL session table.
