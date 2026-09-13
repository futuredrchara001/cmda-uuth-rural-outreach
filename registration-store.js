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

const MAX_REGISTRATIONS = 250;

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
    createdAt: row.created_at,
    paidAt: row.paid_at
  };
}

function toDatabase(registration) {
  return {
    id: registration.id,
    reference: registration.reference,
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

  return (data || []).map(fromDatabase);
}

async function getSuccessfulRegistrations() {
  const client = requireSupabase();

  const { data, error } = await client
    .from("registrations")
    .select("*")
    .eq("payment_status", "success");

  if (error) {
    throw error;
  }

  return (data || []).map(fromDatabase);
}

async function hasReachedLimit() {
  const client = requireSupabase();

  const { count, error } = await client
    .from("registrations")
    .select("id", {
      count: "exact",
      head: true
    })
    .eq("payment_status", "success");

  if (error) {
    throw error;
  }

  return (count || 0) >= MAX_REGISTRATIONS;
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

module.exports = {
  MAX_REGISTRATIONS,
  getRegistrations,
  getSuccessfulRegistrations,
  hasReachedLimit,
  addRegistration,
  findByReference,
  updateRegistration
};
