import express from "express";

import {
  createWithdrawal,
  getUserWithdrawals,
  getWithdrawal,
  WITHDRAWAL_CONFIG
} from "../services/withdrawals.js";

const router = express.Router();

/* =========================================================
   HELPERS
========================================================= */

function isValidPositiveInteger(value) {
  if (
    typeof value === "number"
  ) {
    return (
      Number.isSafeInteger(value) &&
      value > 0
    );
  }

  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value.trim())
  ) {
    return false;
  }

  const number = Number(value);

  return (
    Number.isSafeInteger(number) &&
    number > 0
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


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
    /* -----------------------------------------------------
       Authentication
    ----------------------------------------------------- */

    if (
      !req.user ||
      !req.user.user_id
    ) {
      return res.status(401).json({
        success: false,
        error: "Authentication required."
      });
    }

    const {
      amountCoins,
      provider,
      faucetpayEmail,
      abaAccountNumber,
      abaAccountName
    } = req.body || {};


    /* -----------------------------------------------------
       Amount validation
    ----------------------------------------------------- */

    if (
      amountCoins === undefined ||
      amountCoins === null ||
      amountCoins === ""
    ) {
      return res.status(400).json({
        success: false,
        error: "Withdrawal amount is required."
      });
    }

    if (!isValidPositiveInteger(amountCoins)) {
      return res.status(400).json({
        success: false,
        error: "Withdrawal amount must be a positive whole number."
      });
    }

    const normalizedAmountCoins =
      Number(amountCoins);

    if (
      !Number.isSafeInteger(
        normalizedAmountCoins
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid withdrawal amount."
      });
    }


    /* -----------------------------------------------------
       Provider validation
    ----------------------------------------------------- */

    const normalizedProvider =
      typeof provider === "string"
        ? provider.trim().toLowerCase()
        : "";

    if (
      normalizedProvider !== "faucetpay" &&
      normalizedProvider !== "aba"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid withdrawal method. Choose FaucetPay or ABA Bank."
      });
    }


    /* -----------------------------------------------------
       FaucetPay validation
    ----------------------------------------------------- */

    let normalizedFaucetPayEmail;

    if (
      normalizedProvider === "faucetpay"
    ) {
      if (
        typeof faucetpayEmail !== "string" ||
        !faucetpayEmail.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "FaucetPay email is required."
        });
      }

      normalizedFaucetPayEmail =
        faucetpayEmail
          .trim()
          .toLowerCase();

      if (
        !isValidEmail(
          normalizedFaucetPayEmail
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid FaucetPay email."
        });
      }
    }


    /* -----------------------------------------------------
       ABA validation
    ----------------------------------------------------- */

    let normalizedAbaAccountNumber;
    let normalizedAbaAccountName;

    if (
      normalizedProvider === "aba"
    ) {
      if (
        typeof abaAccountNumber !== "string" ||
        !abaAccountNumber.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "ABA account number is required."
        });
      }

      if (
        typeof abaAccountName !== "string" ||
        !abaAccountName.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            "ABA account holder name is required."
        });
      }

      normalizedAbaAccountNumber =
        abaAccountNumber.trim();

      normalizedAbaAccountName =
        abaAccountName
          .trim()
          .replace(/\s+/g, " ");

      /*
         Basic ABA account number protection.
         Keep this reasonably flexible because
         account number formats can vary.
      */

      if (
        !/^[0-9]{6,30}$/.test(
          normalizedAbaAccountNumber
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid ABA account number."
        });
      }

      if (
        normalizedAbaAccountName.length < 2 ||
        normalizedAbaAccountName.length > 100
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid ABA account holder name."
        });
      }
    }


    /* -----------------------------------------------------
       Create withdrawal
    ----------------------------------------------------- */

    const withdrawal =
      await createWithdrawal(
        req.user.user_id,
        normalizedAmountCoins,
        normalizedProvider,
        {
          faucetpayEmail:
            normalizedFaucetPayEmail,

          abaAccountNumber:
            normalizedAbaAccountNumber,

          abaAccountName:
            normalizedAbaAccountName
        }
      );


    /* -----------------------------------------------------
       Safe response
    ----------------------------------------------------- */

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

      /* ---------------------------------------------------
         AMOUNT
      --------------------------------------------------- */

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


      /* ---------------------------------------------------
         PROVIDER
      --------------------------------------------------- */

      case "INVALID_PROVIDER":
        return res.status(400).json({
          success: false,
          error:
            "Invalid withdrawal method. Choose FaucetPay or ABA Bank."
        });


      /* ---------------------------------------------------
         FAUCETPAY
      --------------------------------------------------- */

      case "INVALID_EMAIL":
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid FaucetPay email."
        });


      /* ---------------------------------------------------
         ABA
      --------------------------------------------------- */

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


      /* ---------------------------------------------------
         USER
      --------------------------------------------------- */

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


      /* ---------------------------------------------------
         BALANCE
      --------------------------------------------------- */

      case "INSUFFICIENT_BALANCE":
        return res.status(400).json({
          success: false,
          error:
            "Insufficient coin balance."
        });


      /* ---------------------------------------------------
         PENDING WITHDRAWAL
      --------------------------------------------------- */

      case "WITHDRAWAL_PENDING":
        return res.status(409).json({
          success: false,
          error:
            "You already have a pending withdrawal."
        });


      /* ---------------------------------------------------
         DEFAULT
      --------------------------------------------------- */

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

    if (
      !req.user ||
      !req.user.user_id
    ) {
      return res.status(401).json({
        success: false,
        error: "Authentication required."
      });
    }


    let limit =
      Number.parseInt(
        req.query.limit,
        10
      );

    let offset =
      Number.parseInt(
        req.query.offset,
        10
      );


    if (
      !Number.isInteger(limit)
    ) {
      limit = 20;
    }

    if (
      !Number.isInteger(offset)
    ) {
      offset = 0;
    }


    limit =
      Math.min(
        Math.max(limit, 1),
        100
      );

    offset =
      Math.max(offset, 0);


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

    if (
      !req.user ||
      !req.user.user_id
    ) {
      return res.status(401).json({
        success: false,
        error: "Authentication required."
      });
    }


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
