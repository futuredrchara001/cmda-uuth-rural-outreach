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

    if (wakeScreen) {
      wakeScreen.classList.add("active");
    }

    document.body.style.overflow =
      "hidden";

    setTimeout(() => {
      window.location.href =
        "/registration/#registration";
    }, 700);

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

  openingRegistration = true;
  lockButtons(true);

  try {
    let reference =
      getSavedReference();

    if (!reference) {
      const email =
        window.prompt(
          "Enter the email address you used for your registration:"
        );

      if (
        !email ||
        !email.trim()
      ) {
        openingRegistration = false;
        lockButtons(false);
        return;
      }

      const response =
        await fetch(
          "/api/registration-recovery?email=" +
          encodeURIComponent(
            email.trim().toLowerCase()
          ),
          {
            headers: {
              Accept:
                "application/json"
            },
            cache: "no-store"
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success ||
        !data.reference
      ) {
        throw new Error(
          data.message ||
          "No registration was found with that email address."
        );
      }

      reference =
        String(data.reference)
          .trim()
          .toUpperCase();

      saveReference(reference);
    }

    window.location.href =
      "/registration/?reference=" +
      encodeURIComponent(reference) +
      "#registration";

  } catch (error) {
    console.error(
      "Registration recovery error:",
      error
    );

    openingRegistration = false;
    lockButtons(false);

    alert(
      error.message ||
      "Unable to recover your registration."
    );
  }
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
