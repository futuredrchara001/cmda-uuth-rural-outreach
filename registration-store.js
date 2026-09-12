const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "registrations.json");

const MAX_REGISTRATIONS = 250;

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
  }
}

function getRegistrations() {
  ensureDataFile();

  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Could not read registrations:", error);
    return [];
  }
}

function saveRegistrations(registrations) {
  ensureDataFile();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(registrations, null, 2),
    "utf8"
  );
}

function getSuccessfulRegistrations() {
  return getRegistrations().filter(
    registration => registration.paymentStatus === "success"
  );
}

function hasReachedLimit() {
  return getSuccessfulRegistrations().length >= MAX_REGISTRATIONS;
}

function addRegistration(registration) {
  const registrations = getRegistrations();

  registrations.push(registration);

  saveRegistrations(registrations);

  return registration;
}

function findByReference(reference) {
  return getRegistrations().find(
    registration => registration.reference === reference
  );
}

function updateRegistration(id, updates) {
  const registrations = getRegistrations();
  const index = registrations.findIndex(
    registration => registration.id === id
  );

  if (index === -1) {
    return null;
  }

  registrations[index] = {
    ...registrations[index],
    ...updates
  };

  saveRegistrations(registrations);

  return registrations[index];
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
