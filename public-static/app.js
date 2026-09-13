const wakeScreen = document.getElementById("wakeScreen");

const registrationButtons = [
  document.getElementById("beginRegistration"),
  document.getElementById("paymentButton"),
  document.getElementById("closingRegistration")
].filter(Boolean);

let openingRegistration = false;

async function beginRegistration() {
  if (openingRegistration) return;

  openingRegistration = true;

  const buttons = registrationButtons;

  buttons.forEach((button) => {
    button.disabled = true;
    button.style.opacity = "0.7";
  });

  try {
    const response = await fetch("/api/registration-status", {
      cache: "no-store"
    });

    const result = await response.json();

    if (!response.ok || !result.open) {
      throw new Error(
        result.message ||
        "Registration is currently closed."
      );
    }

    wakeScreen.classList.add("active");

    document.body.style.overflow = "hidden";

    setTimeout(() => {
      window.location.href = "/registration/";
    }, 1300);

  } catch (error) {
    openingRegistration = false;

    buttons.forEach((button) => {
      button.disabled = false;
      button.style.opacity = "";
    });

    alert(
      error.message ||
      "Unable to open registration. Please try again."
    );
  }
}

registrationButtons.forEach((button) => {
  button.addEventListener("click", beginRegistration);
});
