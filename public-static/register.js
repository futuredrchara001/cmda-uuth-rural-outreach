const form = document.getElementById("registrationForm");
const errorMessage = document.getElementById("errorMessage");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  errorMessage.style.display = "none";
  errorMessage.textContent = "";

  const button = form.querySelector(
    'button[type="submit"]'
  );

  const originalText = button.innerHTML;

  button.disabled = true;
  button.innerHTML = "Preparing secure payment…";

  const formData = new FormData(form);

  const data = Object.fromEntries(
    formData.entries()
  );

  try {

    const response = await fetch("/api/register", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(
        result.message ||
        "Unable to start registration."
      );
    }

    if (!result.authorizationUrl) {
      throw new Error(
        "Payment page could not be created."
      );
    }

    window.location.href =
      result.authorizationUrl;

  } catch (error) {

    errorMessage.textContent =
      error.message ||
      "Something went wrong. Please try again.";

    errorMessage.style.display = "block";

    button.disabled = false;
    button.innerHTML = originalText;
  }
});
