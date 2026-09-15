require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env."
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const UNIT_LIMITS = {
  Organizing: Number(process.env.UNIT_LIMIT_ORGANIZING || 20),
  Registration: Number(process.env.UNIT_LIMIT_REGISTRATION || 15),
  "Protocol/Security": Number(
    process.env.UNIT_LIMIT_PROTOCOL_SECURITY || 10
  ),
  Welfare: Number(process.env.UNIT_LIMIT_WELFARE || 40),
  "Vital Signs": Number(
    process.env.UNIT_LIMIT_VITAL_SIGNS || 25
  ),
  Laboratory: Number(
    process.env.UNIT_LIMIT_LABORATORY || 20
  ),
  Pharmacy: Number(
    process.env.UNIT_LIMIT_PHARMACY || 20
  ),
  "Media/Publicity": Number(
    process.env.UNIT_LIMIT_MEDIA_PUBLICITY || 15
  ),
  "Accommodation/Sanitation": Number(
    process.env.UNIT_LIMIT_ACCOMMODATION_SANITATION || 20
  ),
  Technical: Number(
    process.env.UNIT_LIMIT_TECHNICAL || 10
  ),
  Transportation: Number(
    process.env.UNIT_LIMIT_TRANSPORTATION || 7
  )
};

const MAX_REGISTRATIONS = Object.values(UNIT_LIMITS).reduce(
  (total, limit) => total + limit,
  0
);

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}

function fromDatabase(row) {
  if (!row) return null;

  return {
    id: row.id,
    reference: row.reference,
    accountName: row.account_name || null,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    institution: row.institution,
    level: row.current_level,
    faculty: row.faculty,
    department: row.department,
    cmda: row.cmda,
    previousOutreach: row.previous_outreach,
    unit: row.unit,
    amount: row.payment_amount
      ? row.payment_amount / 100
      : 3800,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    paymentAmount: row.payment_amount,
    paymentCurrency: row.payment_currency,
    paymentChannel: row.payment_channel,
    paystackTransactionId: row.paystack_transaction_id,
    paymentTransactionAt: row.payment_transaction_at || null,
    createdAt: row.created_at,
    paidAt: row.paid_at
  };
}

function toDatabase(registration) {
  return {
    id: registration.id,
    reference: registration.reference,
    account_name: registration.accountName || null,
    full_name: registration.fullName,
    phone: registration.phone,
    email: registration.email,
    gender: registration.gender,
    institution: registration.institution,
    current_level: registration.level,
    faculty: registration.faculty,
    department: registration.department,
    cmda: registration.cmda,
    previous_outreach: registration.previousOutreach,
    unit: registration.unit,
    payment_status: registration.paymentStatus || "pending",
    payment_reference: registration.paymentReference || null,
    payment_amount: registration.paymentAmount || null,
    payment_currency: registration.paymentCurrency || null,
    payment_channel: registration.paymentChannel || null,
    paystack_transaction_id:
      registration.paystackTransactionId || null,
    receipt_path: registration.receiptPath || null,
    receipt_uploaded_at: registration.receiptUploadedAt || null,
    payment_transaction_at: registration.paymentTransactionAt || null,
    rejection_reason: registration.rejectionReason || null,
    verified_at: registration.verifiedAt || null,
    verified_by: registration.verifiedBy || null,
    created_at: registration.createdAt || new Date().toISOString(),
    paid_at: registration.paidAt || null
  };
}

async function getRegistrations() {
  const client = requireSupabase();

  const { data, error } = await client
    .from("registrations")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  successfulRegistrationsCache = (data || []).map(fromDatabase);
  successfulRegistrationsCacheAt = Date.now();

  return successfulRegistrationsCache;
}

let successfulRegistrationsCache = null;
let successfulRegistrationsCacheAt = 0;

async function getSuccessfulRegistrations() {
  const now = Date.now();

  if (
    successfulRegistrationsCache &&
    now - successfulRegistrationsCacheAt < 30000
  ) {
    return successfulRegistrationsCache;
  }

  const client = requireSupabase();

  const { data, error } = await client
    .from("registrations")
    .select("reference,full_name,unit,department,current_level,email,phone")
    .eq("payment_status", "success");

  if (error) {
    throw error;
  }

  successfulRegistrationsCache = (data || []).map(fromDatabase);
  successfulRegistrationsCacheAt = Date.now();

  return successfulRegistrationsCache;
}

function invalidateSuccessfulRegistrationsCache() {
  successfulRegistrationsCache = null;
  successfulRegistrationsCacheAt = 0;
}


async function getRegistrationSettings() {
  const defaults = {
    closeAt: process.env.REGISTRATION_CLOSE_AT
      ? new Date(process.env.REGISTRATION_CLOSE_AT).toISOString()
      : null,
    overallLimit: MAX_REGISTRATIONS,
    unitLimits: { ...UNIT_LIMITS }
  };

  try {
    const db = requireSupabase();

    const { data, error } = await db
      .from("registration_settings")
      .select("close_at, overall_limit, unit_limits")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;

    if (!data) return defaults;

    const unitLimits = {
      ...UNIT_LIMITS,
      ...(data.unit_limits && typeof data.unit_limits === "object"
        ? data.unit_limits
        : {})
    };

    return {
      closeAt: data.close_at
        ? new Date(data.close_at).toISOString()
        : null,
      overallLimit: Number(data.overall_limit) || MAX_REGISTRATIONS,
      unitLimits
    };
  } catch (error) {
    console.warn(
      "Unable to load registration settings; using defaults:",
      error.message
    );

    return defaults;
  }
}

async function updateRegistrationSettings(updates = {}) {
  const db = requireSupabase();

  const current = await getRegistrationSettings();

  const next = {
    closeAt:
      updates.closeAt !== undefined
        ? updates.closeAt
        : current.closeAt,

    overallLimit:
      updates.overallLimit !== undefined
        ? Number(updates.overallLimit)
        : current.overallLimit,

    unitLimits: {
      ...current.unitLimits,
      ...(updates.unitLimits || {})
    }
  };

  if (
    next.closeAt !== null &&
    Number.isNaN(new Date(next.closeAt).getTime())
  ) {
    throw new Error("Invalid registration closing date/time.");
  }

  if (
    !Number.isInteger(next.overallLimit) ||
    next.overallLimit < 1
  ) {
    throw new Error("Overall registration limit must be a positive whole number.");
  }

  for (const [unit, limit] of Object.entries(next.unitLimits)) {
    if (!Number.isInteger(Number(limit)) || Number(limit) < 1) {
      throw new Error(
        `Invalid registration limit for ${unit}.`
      );
    }

    next.unitLimits[unit] = Number(limit);
  }

  const { data, error } = await db
    .from("registration_settings")
    .upsert(
      {
        id: 1,
        close_at: next.closeAt,
        overall_limit: next.overallLimit,
        unit_limits: next.unitLimits,
        updated_at: new Date().toISOString()
      },
      { onConflict: "id" }
    )
    .select("close_at, overall_limit, unit_limits")
    .single();

  if (error) throw error;

  return {
    closeAt: data.close_at
      ? new Date(data.close_at).toISOString()
      : null,
    overallLimit: Number(data.overall_limit),
    unitLimits: data.unit_limits || {}
  };
}

async function hasReachedUnitLimit(unit) {
  const client = requireSupabase();
  const settings = await getRegistrationSettings();
  const limit = Number(settings.unitLimits[unit]);

  if (!limit) {
    return {
      reached: false,
      count: 0,
      limit: null,
      remaining: null
    };
  }

  const { count, error } = await client
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "success")
    .eq("unit", unit);

  if (error) throw error;

  return {
    reached: (count || 0) >= limit,
    count: count || 0,
    limit,
    remaining: Math.max(limit - (count || 0), 0)
  };
}

async function hasReachedLimit() {
  const client = requireSupabase();
  const settings = await getRegistrationSettings();
  const limit = Number(settings.overallLimit);

  const { count, error } = await client
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "success");

  if (error) throw error;

  return {
    reached: (count || 0) >= limit,
    count: count || 0,
    limit,
    remaining: Math.max(limit - (count || 0), 0)
  };
}

function getRegistrationCloseAt() {
  const raw = String(
    process.env.REGISTRATION_CLOSE_AT || ""
  ).trim();

  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

async function getRegistrationClosureStatus() {
  const settings = await getRegistrationSettings();
  const overallLimit = await hasReachedLimit();

  const closeAt = settings.closeAt
    ? new Date(settings.closeAt)
    : null;

  const dateReached =
    !!closeAt && new Date() >= closeAt;

  return {
    open:
      !overallLimit.reached &&
      !dateReached,
    dateReached,
    closeAt: closeAt
      ? closeAt.toISOString()
      : null,
    overallLimit,
    unitLimits: settings.unitLimits
  };
}

async function addRegistration(registration) {
  const client = requireSupabase();

  const { data, error } = await client
    .from("registrations")
    .insert(toDatabase(registration))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return fromDatabase(data);
}

async function findByReference(reference) {
  const client = requireSupabase();

  const { data, error } = await client
    .from("registrations")
    .select("*")
    .eq("reference", reference)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return fromDatabase(data);
}

async function updateRegistration(id, updates) {
  const client = requireSupabase();

  const databaseUpdates = {};

  if ("reference" in updates) {
    databaseUpdates.reference = updates.reference;
  }

  if ("paymentStatus" in updates) {
    databaseUpdates.payment_status = updates.paymentStatus;
  }

  if ("paidAt" in updates) {
    databaseUpdates.paid_at = updates.paidAt;
  }

  if ("paymentChannel" in updates) {
    databaseUpdates.payment_channel = updates.paymentChannel;
  }

  if ("paystackTransactionId" in updates) {
    databaseUpdates.paystack_transaction_id =
      updates.paystackTransactionId;
  }

  if ("paymentReference" in updates) {
    databaseUpdates.payment_reference =
      updates.paymentReference;
  }

  if ("paymentAmount" in updates) {
    databaseUpdates.payment_amount =
      updates.paymentAmount;
  }

  if ("paymentCurrency" in updates) {
    databaseUpdates.payment_currency =
      updates.paymentCurrency;
  }

  if ("receiptPath" in updates) {
    databaseUpdates.receipt_path = updates.receiptPath;
  }

  if ("receiptUploadedAt" in updates) {
    databaseUpdates.receipt_uploaded_at = updates.receiptUploadedAt;
  }

  if ("paymentTransactionAt" in updates) {
    databaseUpdates.payment_transaction_at =
      updates.paymentTransactionAt;
  }

  if ("rejectionReason" in updates) {
    databaseUpdates.rejection_reason = updates.rejectionReason;
  }

  if ("verifiedAt" in updates) {
    databaseUpdates.verified_at = updates.verifiedAt;
  }

  if ("verifiedBy" in updates) {
    databaseUpdates.verified_by = updates.verifiedBy;
  }

  const { data, error } = await client
    .from("registrations")
    .update(databaseUpdates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return fromDatabase(data);
}

 
async function getPendingVerificationRegistrations() {
  const client = requireSupabase();

  const { data, error } = await client
    .from("registrations")
    .select("*")
    .eq("payment_status", "receipt_submitted")
    .order("receipt_uploaded_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []).map(fromDatabase);
}

async function clearAllRegistrations() {
  const client = requireSupabase();

  const { error } = await client
    .from("registrations")
    .delete()
    .not("id", "is", null);

  if (error) {
    throw error;
  }

  return true;
}


const UNIT_REFERENCE_CODES = {
  Organizing: "org",
  Registration: "reg",
  "Protocol/Security": "pro",
  Welfare: "wel",
  "Vital Signs": "vit",
  Laboratory: "lab",
  Pharmacy: "pha",
  "Media/Publicity": "med",
  "Accommodation/Sanitation": "acc",
  Technical: "tec",
  Transportation: "tra"
};

async function generateParticipantReference(unit) {
  const db = requireSupabase();

  const code = UNIT_REFERENCE_CODES[unit];

  if (!code) {
    throw new Error(`No CURO reference code configured for unit: ${unit}`);
  }

  const { data, error } = await db
    .from("registrations")
    .select("reference")
    .eq("unit", unit)
    .eq("payment_status", "success")
    .not("reference", "is", null)
    .ilike("reference", `CURO-${code}-%`);

  if (error) {
    throw error;
  }

  let highestNumber = 0;

  for (const row of data || []) {
    const match = String(row.reference).match(
      new RegExp(`^CURO-${code}-(\\d+)$`, "i")
    );

    if (match) {
      highestNumber = Math.max(
        highestNumber,
        Number(match[1])
      );
    }
  }

  return `CURO-${code}-${String(highestNumber + 1).padStart(3, "0")}`;
}

module.exports = {
  generateParticipantReference,
  MAX_REGISTRATIONS,
  UNIT_LIMITS,
  getRegistrations,
  getSuccessfulRegistrations,
  invalidateSuccessfulRegistrationsCache,
  getPendingVerificationRegistrations,
  hasReachedLimit,
  hasReachedUnitLimit,
  getRegistrationSettings,
  updateRegistrationSettings,
  getRegistrationClosureStatus,
  addRegistration,
  findByReference,
  updateRegistration,
  clearAllRegistrations
};
