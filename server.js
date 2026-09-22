require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const {
  hasReachedLimit,
  getRegistrationClosureStatus,
  hasReachedUnitLimit,
  addRegistration,
  findExistingRegistrationByContact,
  findByReference,
  updateRegistration,
  getPendingVerificationRegistrations,
  getRegistrationSettings,
  updateRegistrationSettings,
  clearAllRegistrations,
  generateParticipantReference,
  invalidateSuccessfulRegistrationsCache
} = require("./registration-store");


const multer = require("multer");

/*
==================================================
RECEIPT UPLOAD CONFIGURATION
==================================================
Receipts are kept in the private Supabase Storage
bucket named "receipts".
*/

const RECEIPT_BUCKET = "receipts";

const ALLOWED_RECEIPT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

const receiptUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: (req, file, callback) => {
    if (!ALLOWED_RECEIPT_TYPES.has(file.mimetype)) {
      return callback(
        new Error(
          "Receipt must be JPG, PNG, WEBP, or PDF."
        )
      );
    }

    callback(null, true);
  }
});

/*
==================================================
SUPABASE SERVER CLIENT
==================================================
The service-role key stays server-side.
It is NEVER sent to participants.
*/

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const { createClient } =
    require("@supabase/supabase-js");

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Supabase server configuration is missing."
    );
  }

  supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  return supabaseClient;
}

const app = express();
const PORT = process.env.PORT || 3000;

/*
==================================================
CONFIGURATION
==================================================
All changeable registration/payment details come
from .env. Do not hard-code them here.
*/

const REGISTRATION_AMOUNT = Number(
  process.env.PAYMENT_AMOUNT || 3800
);

const PAYMENT_CONFIG = {
  amount: REGISTRATION_AMOUNT,
  method: process.env.PAYMENT_METHOD || "Bank Transfer",
  accountName: process.env.PAYMENT_ACCOUNT_NAME || "",
  accountNumber: process.env.PAYMENT_ACCOUNT_NUMBER || "",
  instructions:
    process.env.PAYMENT_INSTRUCTIONS ||
    "Please pay the registration fee and upload your receipt for verification.",
  whatsappGroupLink:
    process.env.WHATSAPP_GROUP_LINK || ""
};

/*
==================================================
BREVO EMAIL
==================================================
Transactional email is sent through Brevo API.
The Brevo API key stays server-side in .env.
*/

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

const BREVO_SENDER_EMAIL =
  process.env.BREVO_SENDER_EMAIL ||
  "jubalstar001@gmail.com";

const BREVO_SENDER_NAME =
  process.env.BREVO_SENDER_NAME ||
  "CMDA-UUTH Rural Outreach";

const ADMIN_DASHBOARD_URL =
  `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/admin`;

const PUBLIC_WEBSITE_URL =
  `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/`;

async function sendBrevoEmail({
  to,
  subject,
  text
}) {
  const recipients = Array.isArray(to)
    ? to.filter(Boolean)
    : [to].filter(Boolean);

  if (!process.env.BREVO_API_KEY) {
    console.log(
      "Email skipped: BREVO_API_KEY is not configured."
    );
    return false;
  }

  if (recipients.length === 0) {
    console.log(
      "Email skipped: no recipients configured."
    );
    return false;
  }

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await axios.post(
        BREVO_API_URL,
        {
          sender: {
            name: BREVO_SENDER_NAME,
            email: BREVO_SENDER_EMAIL
          },
          to: recipients.map(email => ({
            email
          })),
          subject,
          textContent: text
        },
        {
          headers: {
            "accept": "application/json",
            "api-key": process.env.BREVO_API_KEY,
            "content-type": "application/json"
          }
        }
      );

      console.log(
        `Brevo email accepted on attempt ${attempt}: ${subject}`
      );

      return true;
    } catch (error) {
      console.error(
        `Brevo email attempt ${attempt}/${maxAttempts} failed:`,
        error.response?.data || error.message
      );

      if (attempt < maxAttempts) {
        await new Promise(resolve =>
          setTimeout(resolve, 1500 * attempt)
        );
      }
    }
  }

  console.error(
    `Brevo email permanently failed after ${maxAttempts} attempts: ${subject}`
  );

  return false;
}
/*
==================================================
ADMIN EMAIL CONFIGURATION
==================================================
These recipients are intentionally configurable.
Roles and permissions will be handled separately.
*/

function getEmailList(value) {
  return (value || "")
    .split(",")
    .map(email => email.trim())
    .filter(Boolean);
}

function getFinanceEmails() {
  return getEmailList(process.env.FINANCE_EMAILS);
}

function getAssistantRegistrationHeadEmails() {
  return getEmailList(
    process.env.ASSISTANT_REGISTRATION_HEAD_EMAIL
  );
}

function getRegistrationUnitHeadEmails() {
  return getEmailList(
    process.env.REGISTRATION_UNIT_HEAD_EMAIL
  );
}

/*
==================================================
EMAIL: RECEIPT SUBMITTED
==================================================
Only Finance receives this notification.
*/

async function sendReceiptSubmittedEmail(registration) {
  const recipients = getFinanceEmails();

  return sendBrevoEmail({
    to: recipients,
    subject:
      `Payment Receipt Submitted — ${registration.reference}`,
    text: `
A participant has submitted a payment receipt for Finance verification.

Registration Reference: ${registration.reference}

Name: ${registration.fullName}
Phone: ${registration.phone}
Email: ${registration.email}

Institution: ${registration.institution}
Level: ${registration.level}
Faculty: ${registration.faculty}
Department: ${registration.department}

CMDA Member: ${registration.cmda}
Previous Rural Outreach: ${registration.previousOutreach}
Unit: ${registration.unit}

Registration Fee: ₦${REGISTRATION_AMOUNT.toLocaleString()}
Payment Status: RECEIPT SUBMITTED

Please log in to the Finance/Admin dashboard to review the receipt and verify the actual payment.

Admin Dashboard:
${ADMIN_DASHBOARD_URL}
`
  });
}

/*
==================================================
EMAIL: SUCCESSFUL REGISTRATION
==================================================
Sent to:
- Participant
- Assistant Registration Unit Head
- Registration Unit Head
==================================================
*/

async function sendSuccessfulRegistrationEmails(registration) {
  const participantEmail = registration.email;
  const settings = await getRegistrationSettings();
  const whatsappLink =
    settings.payment?.whatsappGroupLink ||
    PAYMENT_CONFIG.whatsappGroupLink;

  const adminRecipients = [
    ...getAssistantRegistrationHeadEmails(),
    ...getRegistrationUnitHeadEmails()
  ];

  const participantText = `
Dear ${registration.fullName},

Your registration for the CMDA-UUTH Chapter Rural Outreach 2026 has been successfully confirmed.

Registration details:

Name: ${registration.fullName}
Registration Reference: ${registration.reference}
Unit: ${registration.unit}
Institution: ${registration.institution}
Level: ${registration.level}

Payment: ₦${REGISTRATION_AMOUNT.toLocaleString()}
Payment Status: VERIFIED

Your payment has been manually verified by the Finance Administrator, and your registration is now confirmed.

WhatsApp Group:
${whatsappLink}

Public Website:
${PUBLIC_WEBSITE_URL}

Please keep this email for your records.

Thank you,
CMDA-UUTH Chapter
Rural Outreach 2026
`;

  const adminText = `
A registration has been successfully confirmed after Finance verification.

Registration Reference: ${registration.reference}

Name: ${registration.fullName}
Phone: ${registration.phone}
Email: ${registration.email}

Institution: ${registration.institution}
Level: ${registration.level}
Faculty: ${registration.faculty}
Department: ${registration.department}

CMDA Member: ${registration.cmda}
Previous Rural Outreach: ${registration.previousOutreach}
Unit: ${registration.unit}

Registration Fee: ₦${REGISTRATION_AMOUNT.toLocaleString()}
Payment Status: VERIFIED
Verified At: ${registration.verifiedAt || new Date().toISOString()}
Verified By: ${registration.verifiedBy || "Finance Administrator"}

Admin Dashboard:
${ADMIN_DASHBOARD_URL}
`;

  await Promise.all([
    sendBrevoEmail({
      to: participantEmail,
      subject:
        "CMDA-UUTH Rural Outreach 2026 — Registration Confirmed",
      text: participantText
    }),

    sendBrevoEmail({
      to: adminRecipients,
      subject:
        `Registration Confirmed — ${registration.reference}`,
      text: adminText
    })
  ]);
}

/*
==================================================
EMAIL: PAYMENT REJECTED
==================================================
Only the participant is notified.
*/

async function sendPaymentRejectedEmail(
  registration
) {
  const reason =
    registration.rejectionReason ||
    "The submitted payment could not be verified.";

  return sendBrevoEmail({
    to: registration.email,
    subject:
      "CMDA-UUTH Rural Outreach 2026 — Payment Verification Update",
    text: `
Dear ${registration.fullName},

Your submitted payment receipt for the CMDA-UUTH Chapter Rural Outreach 2026 could not be verified at this time.

Registration Reference: ${registration.reference}
Unit: ${registration.unit}

Reason:
${reason}

Please review the payment details and follow the instructions on the registration status page to take the required action.

Your registration is not confirmed at this stage.

Public Website:
${PUBLIC_WEBSITE_URL}

Thank you,
CMDA-UUTH Chapter
Rural Outreach 2026
`
  });
}

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

app.use(express.urlencoded({ extended: true }));

// Public landing page
app.use(express.static(path.join(__dirname, "public-static")));

// Registration form
app.use("/registration", express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "private-admin", "index.html"));
});


/*
==================================================
APPROVED WHATSAPP ACCESS
==================================================
The WhatsApp link is only returned after Finance
has actually approved the registration.
The link itself comes from WHATSAPP_GROUP_LINK
in .env and is never hard-coded here.
*/

app.get("/api/approved-whatsapp", async (req, res) => {
  try {
    const reference =
      String(req.query.reference || "").trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message:
          "Registration reference is required."
      });
    }

    const registration =
      await findByReference(reference);

    if (!registration) {
      return res.status(404).json({
        success: false,
        message:
          "Registration could not be found."
      });
    }

    if (
      registration.paymentStatus !== "success"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your registration has not been approved yet."
      });
    }

      const settings = await getRegistrationSettings();
      const whatsappLink =
        settings.payment?.whatsappGroupLink ||
        PAYMENT_CONFIG.whatsappGroupLink;

      if (!whatsappLink) {
        console.error(
          "WHATSAPP_GROUP_LINK is not configured."
        );

        return res.status(503).json({
          success: false,
          message:
            "The WhatsApp group link is currently unavailable."
        });
      }

      return res.json({
        success: true,
        whatsappLink
      });

  } catch (error) {
    console.error(
      "Approved WhatsApp error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve the WhatsApp group link."
    });
  }
});

app.get("/api/registration-recovery", async (req, res) => {
  try {
    const email =
      String(req.query.email || "")
        .trim()
        .toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email address is required."
      });
    }

    const { findExistingRegistrationByContact } =
      require("./registration-store");

    const registration =
      await findExistingRegistrationByContact(
        "",
        email
      );

    if (!registration) {
      return res.status(404).json({
        success: false,
        message:
          "No registration was found with that email address."
      });
    }

    const reference =
      registration.reference ||
      registration.pendingReference ||
      "";

    if (!reference) {
      return res.status(404).json({
        success: false,
        message:
          "Your registration was found, but its reference is not available yet."
      });
    }

    res.json({
      success: true,
      reference
    });
  } catch (error) {
    console.error(
      "Registration recovery error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to recover your registration right now."
    });
  }
});

app.get("/api/registration-status", async (req, res, next) => {
  if (String(req.query.reference || "").trim()) {
    return next();
  }

  try {
    res.json({
      open: (await getRegistrationClosureStatus()).open
    });
  } catch (error) {
    console.error("Registration status error:", error.message);

    res.status(500).json({
      open: false,
      message: "Registration status unavailable."
    });
  }
});



/*
==================================================
ROLE-BASED ADMIN AUTHENTICATION
==================================================
No browser Basic Auth popup.

Roles:
- finance
- assistant_registration_head
- registration_head

Credentials are controlled through .env.
==================================================
*/

const ADMIN_SESSION_TTL = Number(
  process.env.ADMIN_SESSION_TTL || 8 * 60 * 60 * 1000
);

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "";


const adminSessions = new Map();

function getAdminRole(username, password) {
  if (
    username === ADMIN_USERNAME &&
    password === ADMIN_PASSWORD
  ) {
    return "admin";
  }

  return null;
}

function createAdminSession(role, username) {
  const token =
    crypto.randomBytes(32).toString("hex");

  adminSessions.set(token, {
    role,
    username,
    createdAt: Date.now(),
    expiresAt:
      Date.now() + ADMIN_SESSION_TTL
  });

  return token;
}

function getAdminSession(req) {
  const cookies =
    String(req.headers.cookie || "");

  const match =
    cookies.match(
      /(?:^|;\s*)cmda_admin_session=([^;]+)/
    );

  if (!match) {
    return null;
  }

  const token = match[1];

  const session =
    adminSessions.get(token);

  if (!session) {
    return null;
  }

  if (
    Date.now() > session.expiresAt
  ) {
    adminSessions.delete(token);
    return null;
  }

  return {
    token,
    ...session
  };
}

function setAdminSessionCookie(res, token) {
  const secure =
    process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";

  res.setHeader(
    "Set-Cookie",
    [
      "cmda_admin_session=" + token,
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
      "Max-Age=" +
        Math.floor(
          ADMIN_SESSION_TTL / 1000
        ),
      secure
    ]
      .filter(Boolean)
      .join("; ")
  );
}

function clearAdminSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "cmda_admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );
}

function requireAdmin(req, res, next) {
  const session =
    getAdminSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Admin authentication required."
    });
  }

  req.admin = {
    role: session.role,
    username: session.username
  };

  next();
}

function requireAdminRole(...allowedRoles) {
  return (req, res, next) => {
    const session =
      getAdminSession(req);

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required."
      });
    }

    if (
      !allowedRoles.includes(
        session.role
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action."
      });
    }

    req.admin = {
      role: session.role,
      username: session.username
    };

    next();
  };
}

/*
==================================================
ADMIN LOGIN
==================================================
*/

app.post("/api/admin/login", (req, res) => {
  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message:
        "Username and password are required."
    });
  }

  const role =
    getAdminRole(
      username,
      password
    );

  if (!role) {
    return res.status(401).json({
      success: false,
      message:
        "Invalid username or password."
    });
  }

  const token =
    createAdminSession(
      role,
      username
    );

  setAdminSessionCookie(
    res,
    token
  );

  res.json({
    success: true,
    role,
    username
  });
});

/*
==================================================
ADMIN SESSION
==================================================
*/

app.get("/api/admin/me", (req, res) => {
  const session =
    getAdminSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      authenticated: false
    });
  }

  res.json({
    success: true,
    authenticated: true,
    role: session.role,
    username: session.username
  });
});

/*
==================================================
ADMIN LOGOUT
==================================================
*/

app.post("/api/admin/logout", (req, res) => {
  const session =
    getAdminSession(req);

  if (session) {
    adminSessions.delete(
      session.token
    );
  }

  clearAdminSessionCookie(res);

  res.json({
    success: true
  });
  });




app.get("/api/admin/pending-verifications", requireAdmin, async (req, res) => {
  try {

    const pending = await getPendingVerificationRegistrations();

    const grouped = {};

    for (const registration of pending) {
      const unit = registration.unit || "Unassigned";

      if (!grouped[unit]) grouped[unit] = [];

      grouped[unit].push({
        reference:
          registration.reference ||
          registration.pendingReference ||
          null,
        fullName: registration.fullName,
        whatsappProfileName:
          registration.whatsappProfileName || "",
        accountName: registration.accountName || null,
        email: registration.email,
        phone: registration.phone,
        whatsappProfileName: registration.whatsappProfileName || "",
        department: registration.department,
        level: registration.level,
        amount: registration.amount,
        paymentTransactionAt: registration.paymentTransactionAt || null,
        receiptUploadedAt: registration.receiptUploadedAt || null
      });
    }

    res.json({
      success: true,
      units: grouped,
      count: pending.length
    });
  } catch (error) {
    console.error("Pending verification error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load pending payments."
    });
  }
});

app.get("/api/admin/receipt/:reference", requireAdmin, async (req, res) => {
  try {

    const registration = await findByReference(
      String(req.params.reference || "").trim()
    );

    if (!registration || !registration.receiptPath) {
      return res.status(404).json({
        success: false,
        message: "Receipt not found."
      });
    }

    const { data, error } = await getSupabaseClient()
      .storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(registration.receiptPath, 300);

    if (error || !data?.signedUrl) {
      throw error || new Error("Unable to create receipt URL.");
    }

    res.json({
      success: true,
      url: data.signedUrl
    });
  } catch (error) {
    console.error("Receipt view error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to open receipt."
    });
  }
});

app.post("/api/admin/registrations/:reference/approve", requireAdmin, async (req, res) => {
  try {

    const registration = await findByReference(
      String(req.params.reference || "").trim()
    );

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: "Registration not found."
      });
    }

    if (registration.paymentStatus !== "receipt_submitted") {
      return res.status(400).json({
        success: false,
        message: "This registration is not awaiting Finance verification."
      });



      }
      const settings = await getRegistrationSettings();
      const paymentMethod =
        settings.payment?.method ||
        PAYMENT_CONFIG.method;

    let updated;
    let lastReferenceError;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const officialReference =
          await generateParticipantReference(registration.unit);

        updated = await updateRegistration(registration.id, {
          reference: officialReference,
          paymentStatus: "success",
          paymentReference: officialReference,
          paymentAmount: registration.amount,
          paymentCurrency: "NGN",
          paymentChannel: paymentMethod,
          verifiedAt: new Date().toISOString(),
          verifiedBy: "Finance",
          rejectionReason: null
        });

        break;
      } catch (error) {
        lastReferenceError = error;

        if (error?.code !== "23505" || attempt === 2) {
          throw error;
        }
      }
    }

    if (!updated) {
      throw lastReferenceError || new Error("Unable to assign CURO reference."); 
    }

    invalidateSuccessfulRegistrationsCache();

    await sendSuccessfulRegistrationEmails(updated);

    res.json({
      success: true,
      registration: {
        reference: updated.reference,
        paymentStatus: updated.paymentStatus
      }
    });
  } catch (error) {
    console.error("Payment approval error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to approve payment."
    });
  }
});

app.post("/api/admin/registrations/:reference/reject", requireAdmin, async (req, res) => {
  try {

    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "A rejection reason is required."
      });
    }

    const registration = await findByReference(
      String(req.params.reference || "").trim()
    );

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: "Registration not found."
      });
    }

    if (registration.paymentStatus !== "receipt_submitted") {
      return res.status(400).json({
        success: false,
        message: "This registration is not awaiting Finance verification."
      });
    }

    const oldReceiptPath =
      registration.receiptPath || null;

    if (oldReceiptPath) {
      const { error: deleteError } =
        await getSupabaseClient()
          .storage
          .from(RECEIPT_BUCKET)
          .remove([oldReceiptPath]);

      if (deleteError) {
        console.error(
          "Rejected receipt deletion error:",
          deleteError.message
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to delete the existing receipt. The payment was not rejected. Please try again."
        });
      }
    }

    const updated =
      await updateRegistration(registration.id, {
        paymentStatus: "rejected",
        rejectionReason: reason,
        verifiedAt: null,
        verifiedBy: null,
        receiptPath: null,
        receiptUploadedAt: null
      });

    await sendPaymentRejectedEmail(updated);

    res.json({
      success: true,
      registration: {
        reference: updated.reference,
        paymentStatus: updated.paymentStatus
      }
    });
  } catch (error) {
    console.error("Payment rejection error:", error.message);
    res.status(500).json({
      success: false,
      message: "Unable to reject payment."
    });
  }
});

app.post("/api/admin/reset", requireAdmin, async (req, res) => {
  const session = getAdminSession(req);
  const resetUsername = process.env.ADMIN_RESET_USERNAME;
  const resetPassword = process.env.ADMIN_RESET_PASSWORD;
  const suppliedPassword = String(req.body?.password || "");

  if (!session || !resetUsername || session.username !== resetUsername) {
    return res.status(403).json({
      success: false,
      message: "Only the authorized registration administrator can reset registrations."
    });
  }

  if (process.env.ADMIN_RESET_ENABLED !== "true") {
    return res.status(403).json({
      success: false,
      message: "Admin reset is disabled."
    });
  }

  if (!resetPassword || suppliedPassword !== resetPassword) {
    return res.status(403).json({
      success: false,
      message: "Invalid reset password."
    });
  }

  try {
    await clearAllRegistrations();
    res.json({
      success: true,
      message: "All registration records have been cleared."
    });
  } catch (error) {
    console.error("Admin reset error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to clear registration records."
    });
  }
});


/*
==================================================
ADMIN REGISTRATION SETTINGS
==================================================
*/

app.get("/api/admin/registration-settings", requireAdmin, async (req, res) => {
  try {
    const settings = await getRegistrationSettings();

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error("Registration settings load error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to load registration settings."
    });
  }
});

app.put("/api/admin/registration-settings", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};

    const settings = await updateRegistrationSettings({
      closeAt:
        body.closeAt === null || body.closeAt === ""
          ? null
          : String(body.closeAt || "").trim(),

      overallLimit: Number(body.overallLimit),

      unitLimits:
        body.unitLimits &&
        typeof body.unitLimits === "object"
          ? body.unitLimits
          : {},

      payment:
        body.payment &&
        typeof body.payment === "object"
          ? {
              method: String(body.payment.method || "").trim(),
              bankName: String(body.payment.bankName || "").trim(),
              accountName: String(body.payment.accountName || "").trim(),
              accountNumber: String(body.payment.accountNumber || "").trim(),
              instructions: String(body.payment.instructions || "").trim(),
              whatsappGroupLink: String(body.payment.whatsappGroupLink || "").trim()
            }
          : {}
    });

    res.json({
      success: true,
      message: "Registration settings saved successfully.",
      settings
    });
  } catch (error) {
    console.error("Registration settings update error:", error.message);

    res.status(400).json({
      success: false,
      message: error.message || "Unable to save registration settings."
    });
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const {
      getSuccessfulRegistrations
    } = require("./registration-store");

    const settings = await getRegistrationSettings();
    const registrations = await getSuccessfulRegistrations();

    const overallCount = registrations.length;
    const overallLimit = Number(settings.overallLimit);

    const overallRemaining = Math.max(
      overallLimit - overallCount,
      0
    );

    const overall = {
      count: overallCount,
      limit: overallLimit,
      remaining: overallRemaining,
      warning:
        overallRemaining > 0 &&
        overallRemaining <= 3,
      full: overallRemaining === 0
    };

    const units = {};

    for (const [unit, limitValue] of Object.entries(settings.unitLimits)) {
      const limit = Number(limitValue);

      const members = registrations.filter(
        registration => registration.unit === unit
      );

      const count = members.length;
      const remaining = Math.max(limit - count, 0);

      units[unit] = {
        count,
        limit,
        remaining,
        warning:
          remaining > 0 &&
          remaining <= 3,
        full: remaining === 0,
        members: members.map(registration => ({
          name: registration.fullName,
          fullName: registration.fullName,
          reference: registration.reference,
          department: registration.department,
          level: registration.level,
          email: registration.email,
          phone: registration.phone
        }))
      };
    }

    res.json({
      success: true,
      overall,
      units,
      registrationOpen:
        (await getRegistrationClosureStatus()).open
    });
  } catch (error) {
    console.error("Admin stats error:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to load dashboard statistics."
    });
  }
});

app.get("/api/registration-status", async (req, res) => {
  try {
    const reference =
      String(req.query.reference || "").trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message:
          "Registration reference is required."
      });
    }

    const registration =
      await findByReference(reference);

    if (!registration) {
      return res.status(404).json({
        success: false,
        message:
          "Registration could not be found."
      });
    }

    const status =
      registration.paymentStatus || "pending";

    const settings =
      await getRegistrationSettings();

    const payment =
      settings.payment || {};

    res.json({
      success: true,

      registration: {
        reference:
          registration.reference,

        pendingReference:
          registration.pendingReference || null,

        fullName:
          registration.fullName,

        unit:
          registration.unit,

        createdAt:
          registration.createdAt,

        paymentStatus:
          status,

        receiptUploadedAt:
          registration.receiptUploadedAt,

        rejectionReason:
          registration.rejectionReason || null,

        verifiedAt:
          registration.verifiedAt || null
      },

        payment: {
          amount:
            PAYMENT_CONFIG.amount,
          method:
            payment.method ||
            settings.payment?.method ||
            PAYMENT_CONFIG.method,
          bankName:
            payment.bankName ||
            settings.payment?.bankName ||
            "OPay",
          accountName:
            payment.accountName ||
            settings.payment?.accountName ||
            PAYMENT_CONFIG.accountName,
          accountNumber:
            payment.accountNumber ||
            settings.payment?.accountNumber ||
            PAYMENT_CONFIG.accountNumber,
          instructions:
            payment.instructions ||
            settings.payment?.instructions ||
            PAYMENT_CONFIG.instructions
        },
        whatsappAvailable:
          status === "success" &&
          Boolean(
            settings.payment?.whatsappGroupLink ||
            payment.whatsappGroupLink ||
            PAYMENT_CONFIG.whatsappGroupLink
          )
    });

  } catch (error) {
    console.error(
      "Registration status error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to load registration status."
    });
  }
});

app.post(
  "/api/upload-receipt",
  receiptUpload.single("receipt"),
  async (req, res) => {
    try {
      const reference =
        String(req.body.reference || "").trim();

      const accountName =
        String(req.body.accountName || "").trim();

      const paymentTransactionDate =
        String(
          req.body.paymentTransactionDate || ""
        ).trim();

      const paymentTransactionTime =
        String(
          req.body.paymentTransactionTime || ""
        ).trim();

      if (!accountName) {
        return res.status(400).json({
          success: false,
          message:
            "Account name used for payment is required."
        });
      }

      if (!paymentTransactionDate) {
        return res.status(400).json({
          success: false,
          message:
            "Payment transaction date is required."
        });
      }

      if (!paymentTransactionTime) {
        return res.status(400).json({
          success: false,
          message:
            "Payment transaction time is required."
        });
      }

      const paymentTransactionAt =
        `${paymentTransactionDate}T${paymentTransactionTime}:00`;

      if (!reference) {
        return res.status(400).json({
          success: false,
          message:
            "Registration reference is required."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message:
            "Please select your payment receipt."
        });
      }

      const registration =
        await findByReference(reference);

      if (!registration) {
        return res.status(404).json({
          success: false,
          message:
            "Registration could not be found."
        });
      }

      if (
        registration.paymentStatus === "success"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This registration has already been confirmed."
        });
      }

      if (
        registration.paymentStatus ===
        "receipt_submitted"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A receipt has already been submitted and is awaiting Finance verification."
        });
      }

      const supabase = getSupabaseClient();

      const extension =
        req.file.mimetype === "application/pdf"
          ? "pdf"
          : req.file.mimetype === "image/png"
            ? "png"
            : req.file.mimetype === "image/webp"
              ? "webp"
              : "jpg";

      const storagePath =
        `${registration.id}/receipt-${Date.now()}.${extension}`;

      const { error: uploadError } =
        await supabase.storage
          .from(RECEIPT_BUCKET)
          .upload(
            storagePath,
            req.file.buffer,
            {
              contentType: req.file.mimetype,
              upsert: false
            }
          );

      if (uploadError) {
        throw uploadError;
      }

      const updated =
        await updateRegistration(
          registration.id,
          {
            paymentStatus:
              "receipt_submitted",

            receiptPath:
              storagePath,

            receiptUploadedAt:
              new Date().toISOString(),

            accountName:
              accountName,

            paymentTransactionAt:
              paymentTransactionAt,

            rejectionReason: null
          }
        );

      /*
      Finance is notified immediately.
      The participant is NOT told that payment
      was successful.
      */

      try {
        await sendReceiptSubmittedEmail(
          updated
        );
      } catch (emailError) {
        console.error(
          "Receipt notification email failed:",
          emailError.message
        );
      }

      res.json({
        success: true,

        registration: {
          reference: updated.reference,
          fullName: updated.fullName,
          unit: updated.unit,
          paymentStatus:
            updated.paymentStatus,
          receiptUploadedAt:
            updated.receiptUploadedAt
        },

        message:
          "Your receipt has been submitted successfully and is now awaiting Finance verification."
      });

    } catch (error) {
      console.error(
        "Receipt upload error:",
        error.message
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to upload receipt. Please try again."
      });
    }
  }
);


/*
==================================================
EDIT EXISTING REGISTRATION
==================================================
Participants may update their saved registration
before payment verification.

This updates the existing Supabase row.
It NEVER creates another registration.
*/

app.put("/api/registration/:reference", async (req, res) => {
  try {
    const reference =
      String(req.params.reference || "").trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Registration reference is required."
      });
    }

    const registration =
      await findByReference(reference);

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: "Registration could not be found."
      });
    }

    if (
      registration.paymentStatus !== "pending" &&
      registration.paymentStatus !== "rejected"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This registration can no longer be edited."
      });
    }

    const {
      fullName,
      phone,
      whatsappProfileName,
      email,
      gender,
      institution,
      level,
      faculty,
      department,
      cmda,
      previousOutreach,
      unit
    } = req.body || {};

    if (
      !fullName ||
      !phone ||
      !whatsappProfileName ||
      !email ||
      !gender ||
      !institution ||
      !level ||
      !faculty ||
      !department ||
      !cmda ||
      !previousOutreach ||
      !unit
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields."
      });
    }

    const updated =
      await updateRegistration(registration.id, {
        fullName: String(fullName).trim(),
        phone: String(phone).trim(),
        whatsappProfileName: String(whatsappProfileName).trim(),
        email: String(email).trim().toLowerCase(),
        gender,
        institution: String(institution).trim(),
        level,
        faculty: String(faculty).trim(),
        department: String(department).trim(),
        cmda,
        previousOutreach,
        unit,
        paymentStatus: "pending",
        rejectionReason: null
      });

    res.json({
      success: true,
      registration: {
        id: updated.id,
        reference: updated.reference,
        fullName: updated.fullName,
        phone: updated.phone,
        email: updated.email,
        gender: updated.gender,
        institution: updated.institution,
        level: updated.level,
        faculty: updated.faculty,
        department: updated.department,
        cmda: updated.cmda,
        previousOutreach: updated.previousOutreach,
        unit: updated.unit,
        paymentStatus: updated.paymentStatus
      }
    });
  } catch (error) {
    console.error(
      "Registration update error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to update your registration. Please try again."
    });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    /*
    ================================================
    CAPACITY CHECK
    ================================================
    Only successful/verified registrations count
    toward the registration and unit limits.
    */

    const closureStatus =
      await getRegistrationClosureStatus();

    if (!closureStatus.open) {
      return res.status(403).json({
        success: false,
        message: "Registration is currently closed."
      });
    }

      const settings = await getRegistrationSettings();

    const {
      fullName,
      phone,
      whatsappProfileName,
      email,
      gender,
      institution,
      level,
      faculty,
      department,
      cmda,
      previousOutreach,
      unit
    } = req.body;

    /*
    ================================================
    REQUIRED FIELDS
    ================================================
    */

    if (
      !fullName ||
      !phone ||
      !whatsappProfileName ||
      !email ||
      !gender ||
      !institution ||
      !level ||
      !faculty ||
      !department ||
      !cmda ||
      !previousOutreach ||
      !unit
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields."
      });
    }

    /*
    ================================================
    EXISTING REGISTRATION CHECK
    ================================================
    A person must not accidentally create a second
    registration using the same phone + email.
    */

    const existingRegistration =
      await findExistingRegistrationByContact(
        phone.trim(),
        email.trim().toLowerCase()
      );

    if (existingRegistration) {
      const existingReference =
        existingRegistration.reference ||
        existingRegistration.pendingReference ||
        "";

      return res.status(409).json({
        success: false,
        duplicate: true,
        reference: existingReference,
        paymentStatus:
          existingRegistration.paymentStatus ||
          "pending",
        message:
          "An existing registration was found with these contact details. Please use Continue Existing Registration to continue that registration."
      });
    }

    /*
    ================================================
    UNIT CAPACITY CHECK
    ================================================
    */

    const unitLimit = await hasReachedUnitLimit(unit);

    if (unitLimit.reached) {
      return res.status(403).json({
        success: false,
        message:
          `${unit} is already full. Please select another unit.`
      });
    }

    /*
    ================================================
    CREATE REGISTRATION
    ================================================
    */

    const registrationId = crypto.randomUUID();

    /*
    The database trigger assigns the pending reference
    automatically as CMDA-PEND1, CMDA-PEND2, etc.
    The reference is never generated by the browser/server.
    */

    const registration = {
      id: registrationId,

      reference: null,

      fullName: fullName.trim(),
      phone: phone.trim(),
      whatsappProfileName: whatsappProfileName.trim(),
      email: email.trim().toLowerCase(),

      gender,

      institution: institution.trim(),
      level,
      faculty: faculty.trim(),
      department: department.trim(),

      cmda,
      previousOutreach,
      unit,

      amount: REGISTRATION_AMOUNT,

      paymentStatus: "pending",

      paymentReference: null,
      paymentAmount: null,
      paymentCurrency: null,
      paymentChannel: null,
      receiptPath: null,
      receiptUploadedAt: null,

      rejectionReason: null,

      verifiedAt: null,
      verifiedBy: null,

      createdAt: new Date().toISOString()
    };

    const savedRegistration =
      await addRegistration(registration);

    /*
    ================================================
    RETURN PAYMENT INSTRUCTIONS
    ================================================
    */
      const registrationPayment = settings.payment || {};

      res.json({
        success: true,

        registration: {
          id: savedRegistration.id,
          reference: savedRegistration.reference,
          fullName: savedRegistration.fullName,
          unit: savedRegistration.unit,
          email: savedRegistration.email,
          paymentStatus:
            savedRegistration.paymentStatus
        },

        payment: {
          amount: PAYMENT_CONFIG.amount,
          method:
            registrationPayment.method ||
            PAYMENT_CONFIG.method,
          bankName:
            registrationPayment.bankName ||
            "OPay",
          accountName:
            registrationPayment.accountName ||
            PAYMENT_CONFIG.accountName,
          accountNumber:
            registrationPayment.accountNumber ||
            PAYMENT_CONFIG.accountNumber,
          instructions:
            registrationPayment.instructions ||
            PAYMENT_CONFIG.instructions
        },

        message:
          "Registration saved. Please complete payment and upload your receipt for Finance verification."
      });

  } catch (error) {
    console.error(
      "Registration error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to complete registration. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `CMDA Outreach site running at http://localhost:${PORT}`
  );
});
