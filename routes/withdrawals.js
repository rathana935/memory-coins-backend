import express from "express";

import {
  createWithdrawal,
  getUserWithdrawals,
  getWithdrawal,
  WITHDRAWAL_CONFIG
} from "../services/withdrawals.js";

const router = express.Router();

/* =========================================================
   CREATE WITHDRAWAL

   POST /api/withdrawals

   FaucetPay:
   {
     "amountCoins": 2500,
     "provider": "faucetpay",
     "faucetpayEmail": "user@example.com"
   }

   ABA:
   {
     "amountCoins": 2500,
     "provider": "aba",
     "abaAccountNumber": "123456789",
     "abaAccountName": "YOUR FULL NAME"
   }
========================================================= */

router.post("/", async (req, res) => {
  try {
    const {
      amountCoins,
      provider,
      faucetpayEmail,
      abaAccountNumber,
      abaAccountName
    } = req.body;

    const withdrawal =
      await createWithdrawal(
        req.user.user_id,
        amountCoins,
        provider,
        {
          faucetpayEmail,
          abaAccountNumber,
          abaAccountName
        }
      );

    return res.status(201).json({
      success: true,
      message:
        "Withdrawal request created successfully.",
      withdrawal
    });

  } catch (error) {
    console.error(
      "Create withdrawal error:",
      error
    );

    switch (error.message) {

      case "INVALID_AMOUNT":
        return res.status(400).json({
          success: false,
          error:
            "Invalid withdrawal amount."
        });

      case "MINIMUM_WITHDRAWAL":
        return res.status(400).json({
          success: false,
          error:
            `Minimum withdrawal is ${WITHDRAWAL_CONFIG.minimumCoins} coins.`
        });

      case "INVALID_PROVIDER":
        return res.status(400).json({
          success: false,
          error:
            "Invalid withdrawal method. Choose FaucetPay or ABA Bank."
        });

      case "INVALID_EMAIL":
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid FaucetPay email."
        });

      case "INVALID_ABA_ACCOUNT":
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid ABA account number."
        });

      case "INVALID_ABA_NAME":
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid ABA account holder name."
        });

      case "USER_NOT_FOUND":
        return res.status(404).json({
          success: false,
          error:
            "User not found."
        });

      case "ACCOUNT_BLOCKED":
        return res.status(403).json({
          success: false,
          error:
            "Your account is blocked."
        });

      case "INSUFFICIENT_BALANCE":
        return res.status(400).json({
          success: false,
          error:
            "Insufficient coin balance."
        });

      case "WITHDRAWAL_PENDING":
        return res.status(409).json({
          success: false,
          error:
            "You already have a pending withdrawal."
        });

      default:
        return res.status(500).json({
          success: false,
          error:
            "Failed to create withdrawal."
        });
    }
  }
});

/* =========================================================
   GET USER WITHDRAWAL HISTORY

   GET /api/withdrawals?limit=20&offset=0
========================================================= */

router.get("/", async (req, res) => {
  try {
    let limit = Number.parseInt(
      req.query.limit,
      10
    );

    let offset = Number.parseInt(
      req.query.offset,
      10
    );

    if (!Number.isInteger(limit)) {
      limit = 20;
    }

    if (!Number.isInteger(offset)) {
      offset = 0;
    }

    const withdrawals =
      await getUserWithdrawals(
        req.user.user_id,
        limit,
        offset
      );

    return res.json({
      success: true,
      withdrawals
    });

  } catch (error) {
    console.error(
      "Get withdrawals error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Failed to load withdrawal history."
    });
  }
});

/* =========================================================
   GET SINGLE WITHDRAWAL

   GET /api/withdrawals/:id
========================================================= */

router.get("/:id", async (req, res) => {
  try {
    const withdrawal =
      await getWithdrawal(
        req.user.user_id,
        req.params.id
      );

    return res.json({
      success: true,
      withdrawal
    });

  } catch (error) {
    console.error(
      "Get withdrawal error:",
      error
    );

    if (
      error.message ===
      "WITHDRAWAL_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Withdrawal not found."
      });
    }

    return res.status(500).json({
      success: false,
      error:
        "Failed to load withdrawal."
    });
  }
});

export default router;
