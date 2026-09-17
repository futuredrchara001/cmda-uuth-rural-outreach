const wakeScreen =
  document.getElementById("wakeScreen");

const beginButton =
  document.getElementById("beginRegistration");

const continueButton =
  document.getElementById("continueRegistration");

const registrationButtons = [
  beginButton,
  continueButton,
  document.getElementById("paymentButton"),
  document.getElementById("closingRegistration")
].filter(Boolean);

const STORAGE_KEY =
  "cmda_outreach_registration_reference";

let openingRegistration = false;

function saveReference(reference) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      String(reference || "")
        .trim()
        .toUpperCase()
    );
  } catch (error) {
    console.error(
      "Unable to save registration reference:",
      error
    );
  }
}

function getSavedReference() {
  try {
    return (
      localStorage.getItem(STORAGE_KEY) || ""
    )
      .trim()
      .toUpperCase();
  } catch (error) {
    return "";
  }
}

function lockButtons(locked) {
  registrationButtons.forEach((button) => {
    button.disabled = locked;
    button.style.opacity =
      locked ? "0.7" : "";
  });
}

async function beginRegistration() {
  if (openingRegistration) return;

  openingRegistration = true;
  lockButtons(true);

  try {
    const response =
      await fetch("/api/registration-status", {
        cache: "no-store"
      });

    const result =
      await response.json();

    if (
      !response.ok ||
      !result.open
    ) {
      throw new Error(
        result.message ||
        "Registration is currently closed."
      );
    }

    window.location.href =
      "/registration/?start=1#registration";

  } catch (error) {
    openingRegistration = false;
    lockButtons(false);

    alert(
      error.message ||
      "Unable to open registration. Please try again."
    );
  }
}

async function continueRegistration() {
  if (openingRegistration) return;

  const reference = getSavedReference();

  if (!reference) {
    alert(
      "No saved registration was found on this device. Please open the registration on the same device and browser you originally used."
    );
    return;
  }

  openingRegistration = true;
  lockButtons(true);

  window.location.href =
    "/registration/?reference=" +
    encodeURIComponent(reference) +
    "#registration";
}

if (beginButton) {
  beginButton.addEventListener(
    "click",
    beginRegistration
  );
}

if (continueButton) {
  continueButton.addEventListener(
    "click",
    continueRegistration
  );
}

[
  document.getElementById("paymentButton"),
  document.getElementById("closingRegistration")
]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener(
      "click",
      beginRegistration
    );
  });
