const form = document.getElementById("registrationForm");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = form.querySelector('button[type="submit"]');
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Preparing payment...";

  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

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
      throw new Error(result.message || "Unable to start registration.");
    }

    window.location.href = result.authorizationUrl;

  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = originalText;
  }
});
