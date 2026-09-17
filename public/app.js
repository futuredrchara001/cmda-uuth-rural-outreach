/*
========================================================
CMDA-UUTH RURAL OUTREACH
Participant Registration Application
Manual Payment + Receipt Verification
========================================================
*/

(() => {
  "use strict";

  const STORAGE_KEY =
    "cmda_outreach_registration_reference";

  const POLL_INTERVAL = 5000;

  let statusPollTimer = null;
  let currentReference = null;
let currentStatusData = null;
let currentStage = "payment";

  const $ = (selector) =>
    document.querySelector(selector);

  const registrationForm =
    $("#registrationForm");

  /*
  ======================================================
  HELPERS
  ======================================================
  */

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatAmount(amount) {
    const number = Number(amount || 0);

    return `₦${number.toLocaleString("en-NG")}`;
  }

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function saveReference(reference) {
    if (!reference) return;

    localStorage.setItem(
      STORAGE_KEY,
      reference
    );

    currentReference = reference;
  }

  function getSavedReference() {
    return (
      localStorage.getItem(STORAGE_KEY) ||
      ""
    );
  }

  function clearSavedReference() {
    localStorage.removeItem(STORAGE_KEY);
    currentReference = null;
  }

  function stopStatusPolling() {
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  }

  function startStatusPolling() {
    stopStatusPolling();

    statusPollTimer = setInterval(() => {
      if (currentReference) {
        loadRegistrationStatus(
          currentReference,
          false
        );
      }
    }, POLL_INTERVAL);
  }

  /*
  ======================================================
  FORM MESSAGE
  ======================================================
  */

  function showFormMessage(
    message,
    type = "error"
  ) {
    let box = $("#formMessage");

    if (!box) {
      box = document.createElement("div");
      box.id = "formMessage";

      if (registrationForm) {
        registrationForm.prepend(box);
      }
    }

    box.className =
      `form-message form-message-${type}`;

    box.textContent = message;

    box.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  /*
  ======================================================
  MAIN VIEW HELPERS
  ======================================================
  */

  function getMainContainer() {
    return (
      $("#registrationView") ||
      $(".registration") ||
      document.querySelector(
        "main"
      ) ||
      document.body
    );
  }

  function hideRegistrationForm() {
    if (registrationForm) {
      registrationForm.style.display =
        "none";
    }

    const paymentPreview =
      $(".payment-preview");

    if (paymentPreview) {
      paymentPreview.style.display =
        "none";
    }

    const intro =
      $(".intro");

    if (intro) {
      intro.style.display = "none";
    }
  }

  function showRegistrationForm() {
    if (registrationForm) {
      registrationForm.style.display =
        "";
    }

    const paymentPreview =
      $(".payment-preview");

    if (paymentPreview) {
      paymentPreview.style.display =
        "";
    }

    const intro =
      $(".intro");

    if (intro) {
      intro.style.display = "";
    }

    const statusView =
      $("#registrationStatusView");

    if (statusView) {
      statusView.innerHTML = "";
      statusView.style.display = "";
    }
  }

  /*
  ======================================================
  STATUS VIEW
  ======================================================
  */

  function renderStatusView(data, scroll=true) {
    const main =
      getMainContainer();

    let view =
      $("#registrationStatusView");

    if (!view) {
      view =
        document.createElement("section");

      view.id =
        "registrationStatusView";

      view.className =
        "registration-status-view";

      main.appendChild(view);
    }

    const registration =
      data.registration || {};

    const payment =
      data.payment || {};

    const status =
      registration.paymentStatus ||
      "pending";

    const reference =
      registration.reference || "";

    currentReference = reference;

    let content = "";

    if (status === "success") {
      content =
        renderSuccessStatus(
          registration,
          payment,
          data
        );
    } else if (status === "rejected") {
      content =
        renderRejectedStatus(
          registration,
          payment
        );
    } else if (
      status === "receipt_submitted"
    ) {
      content =
        renderReceiptSubmittedStatus(
          registration,
          payment
        );
    } else {
      content =
        renderPendingStatus(
          registration,
          payment
        );
    }

    view.innerHTML = content;

    attachStatusEvents();

    if (scroll) {
      view.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }

  function renderHeader(
    title,
    subtitle,
    statusClass
  ) {
    return `
      <div class="status-card ${statusClass}">
        <div class="status-card-header">
          <div class="status-indicator">
            <span class="status-indicator-dot"></span>
          </div>

          <div>
            <h2>${escapeHtml(title)}</h2>
            <p>${escapeHtml(subtitle)}</p>
          </div>
        </div>
    `;
  }

  function renderReferenceCard(
    registration
  ) {
    const isSuccessful =
      registration.paymentStatus === "success";

    const reference =
      isSuccessful
        ? (registration.reference || "")
        : (
            registration.pendingReference ||
            registration.reference ||
            ""
          );

    return `
      <div class="reference-card">
        <div>
          <span class="reference-label">
            ${registration.paymentStatus === "success" ? "Registration Reference" : "Pending CMDA Reference"}
          </span>

          <strong>
            ${escapeHtml(reference)}
          </strong>
        </div>

        <button
          type="button"
          class="copy-button"
          data-copy="${escapeHtml(reference)}"
        >
          Copy
        </button>
      </div>
    `;
  }

  function renderProgress(status) {
    const receiptDone =
      status === "receipt_submitted" ||
      status === "success";

    const verified =
      status === "success";

    return `
      <div class="status-progress">

        <div class="progress-step completed">
          <span class="progress-number">1</span>
          <div>
            <strong>Registration saved</strong>
            <small>Your details have been received.</small>
          </div>
        </div>

        <div class="progress-line ${
          receiptDone ? "completed" : ""
        }"></div>

        <div class="progress-step ${
          receiptDone
            ? "completed"
            : "current"
        }">
          <span class="progress-number">2</span>
          <div>
            <strong>Payment receipt</strong>
            <small>
              ${
                receiptDone
                  ? "Receipt submitted."
                  : "Payment and receipt required."
              }
            </small>
          </div>
        </div>

        <div class="progress-line ${
          verified ? "completed" : ""
        }"></div>

        <div class="progress-step ${
          verified
            ? "completed"
            : "current"
        }">
          <span class="progress-number">3</span>
          <div>
            <strong>Finance verification</strong>
            <small>
              ${
                verified
                  ? "Payment verified."
                  : "Awaiting Finance."
              }
            </small>
          </div>
        </div>

      </div>
    `;
  }

  function renderPaymentDetails(payment) {
    return `
      <div class="payment-instruction-card">
        <div class="payment-amount">
          <span>Registration Fee</span>
          <strong>${formatAmount(payment.amount)}</strong>
        </div>

        <div class="payment-details">
          <div class="payment-row">
            <span>Payment Method</span>
            <strong>${escapeHtml(payment.method)}</strong>
          </div>

          <div class="payment-row">
            <span>Account Name</span>
            <strong>${escapeHtml(payment.accountName || "—")}</strong>
          </div>

          <div class="payment-row">
            <span>Account Number</span>
            <div class="payment-account">
              <strong>${escapeHtml(payment.accountNumber || "—")}</strong>
              ${
                payment.accountNumber
                  ? `
                    <button
                      type="button"
                      class="copy-button small"
                      data-copy="${escapeHtml(payment.accountNumber)}"
                    >
                      Copy
                    </button>
                  `
                  : ""
              }
            </div>
          </div>
        </div>

        <div class="payment-instructions">
          <span>How to complete your payment</span>
          <p>${escapeHtml(payment.instructions || "")}</p>
        </div>
      </div>
    `;
  }

  function renderPendingStatus(
    registration,
    payment
  ) {
    return `
      ${renderHeader(
        "Make Your Registration Payment",
        "Your registration is saved. Make your payment using the details below, then upload your receipt.",
        "status-pending"
      )}

      ${renderProgress("pending")}

      <div class="status-section">
        <h3>Payment Instructions</h3>
        <p class="status-intro">
          Please make the registration payment using the account details below.
          After payment, tap <strong>I Have Paid</strong> to continue.
        </p>

        ${renderPaymentDetails(payment)}
      </div>

      <div class="status-action-card">
        <button
          type="button"
          class="primary-button"
          id="iHavePaidButton"
        >
          I've Made the Payment
        </button>
      </div>

      <div class="status-meta">
        <span>
          Registration created:
          ${formatDate(registration.createdAt)}
        </span>
      </div>
    `;
  }

  function renderReceiptUploadStatus(
    registration,
    payment
  ) {
    return `
      ${renderHeader(
        "Upload Payment Receipt",
        "Submit your payment receipt for Finance verification.",
        "status-receipt-upload"
      )}

      ${renderReferenceCard(registration)}

      ${renderProgress("receipt_upload")}

      <div class="receipt-upload-card">
        <div class="receipt-heading">
          <div>
            <h3>Payment Receipt</h3>
            <p>
              Upload the receipt for the payment you have just made.
            </p>
            <p class="receipt-limit-note">
              Accepted: JPG, PNG, WEBP or PDF · Maximum size: 5 MB
            </p>
          </div>
        </div>

        <div class="receipt-transaction-fields">
          <label
            for="paymentTransactionDate"
            class="receipt-field-label"
          >
            Payment transaction date <span aria-hidden="true">*</span>
          </label>

          <input
            type="date"
            id="paymentTransactionDate"
            class="receipt-date-input"
            required
          />

          <label
            for="paymentTransactionTime"
            class="receipt-field-label"
          >
            Payment transaction time
            <span class="required-label">*</span>
          </label>

          <input
            type="time"
            id="paymentTransactionTime" required
            class="receipt-time-input"
          />
        </div>

        <label
          class="receipt-file-label"
          for="receiptFile"
        >
          <span id="receiptFileName">
            Choose payment receipt
          </span>

          <input
            type="file"
            id="receiptFile"
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          />
        </label>

        <button
          type="button"
          class="receipt-submit-button"
          id="submitReceiptButton"
        >
          Submit Receipt for Verification
        </button>

        <p
          class="upload-message"
          id="receiptUploadMessage"
        ></p>
      </div>

      <div class="patience-box">
        <strong>Important</strong>
        <p>
          Your receipt will be reviewed by our Finance team.
          Please submit only the receipt for this registration.
        </p>
      </div>
    `;
  }

  function renderReceiptSubmittedStatus(
    registration,
    payment
  ) {
    return `
      ${renderHeader(
        "Payment Under Verification",
        "Your payment receipt has been received and is being reviewed by our Finance team. Please don't submit the form again. Your registration is safely recorded. We'll update this page automatically once your payment has been verified.",
        "status-receipt-submitted"
      )}

        ${renderReferenceCard(
          registration
        )}

        ${renderProgress(
          "receipt_submitted"
        )}

        <div class="verification-message">
          <div class="verification-icon">
            <span></span>
          </div>

          <div>
            <h3>Receipt Submitted Successfully</h3>

            <p>
              Your payment receipt has been sent
              to the Finance Administrator.
              Your registration remains pending
              until the payment is verified.
            </p>
          </div>
        </div>

        ${renderPaymentDetails(
          payment
        )}

        <div class="patience-box">
          <strong>
            Please be patient
          </strong>

          <p>
            You do not need to upload another receipt
            while this verification is pending.
            This page will update when your status changes.
          </p>
        </div>

        <div class="status-meta">
          <span>
            Receipt submitted:
            ${formatDate(
              registration.receiptUploadedAt
            )}
          </span>
        </div>

      </div>
    `;
  }

  function renderRejectedStatus(
    registration,
    payment
  ) {
    return `
      ${renderHeader(
        "Payment Needs Attention",
        "Finance could not approve the submitted payment receipt.",
        "status-rejected"
      )}

        ${renderReferenceCard(
          registration
        )}

        <div class="rejection-box">
          <h3>Reason for Rejection</h3>

          <p>
            ${escapeHtml(
              registration.rejectionReason ||
              "Please review your payment and submit a valid receipt."
            )}
          </p>
        </div>

        ${renderPaymentDetails(
          payment
        )}

        <div class="receipt-upload-card">

          <div class="receipt-heading">
            <div>
              <h3>Submit a New Receipt</h3>

              <p>
                If you have corrected the issue,
                upload the appropriate payment receipt.
              </p>
            </div>
          </div>

          <div class="receipt-transaction-fields">
            <label
              for="paymentTransactionDate"
              class="receipt-field-label"
            >
              Payment transaction date <span aria-hidden="true">*</span>
            </label>

            <input
              type="date"
              id="paymentTransactionDate"
              class="receipt-date-input"
              required
            />

            <label
              for="paymentTransactionTime"
              class="receipt-field-label"
            >
              Payment transaction time
              <span class="required-label">*</span>
            </label>

            <input
              type="time"
              id="paymentTransactionTime" required
              class="receipt-time-input"
            />
          </div>

          <label
            class="receipt-file-label"
            for="receiptFile"
          >
            <span id="receiptFileName">
              Choose payment receipt
            </span>

            <input
              type="file"
              id="receiptFile"
              accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
            />
          </label>

          <button
            type="button"
            class="receipt-submit-button"
            id="submitReceiptButton"
          >
            Submit New Receipt
          </button>

          <p
            class="upload-message"
            id="receiptUploadMessage"
          ></p>

        </div>

        <div class="patience-box">
          <strong>
            Registration is not yet confirmed
          </strong>

          <p>
            Your registration will only become
            successful after Finance verifies the
            payment.
          </p>
        </div>

      </div>
    `;
  }

  function renderSuccessStatus(
    registration,
    payment,
    data
  ) {
    const whatsappAvailable =
      Boolean(data.whatsappAvailable);

    return `
      ${renderHeader(
        "Registration Confirmed",
        "Your payment has been verified by Finance.",
        "status-confirmed"
      )}

        ${renderReferenceCard(
          registration
        )}

        ${renderProgress(
          "success"
        )}

        <div class="success-confirmation">

          <div class="success-mark">
            <span></span>
          </div>

          <h3>
            You are officially registered.
          </h3>

          <p>
            Your payment has been verified and
            your place for the outreach has been
            confirmed.
          </p>

          <div class="confirmed-details">
            <div>
              <span>Name</span>
              <strong>
                ${escapeHtml(
                  registration.fullName
                )}
              </strong>
            </div>

            <div>
              <span>Unit</span>
              <strong>
                ${escapeHtml(
                  registration.unit
                )}
              </strong>
            </div>

            <div>
              <span>Registration Reference</span>
              <strong>
                ${escapeHtml(
                  registration.reference
                )}
              </strong>
            </div>
          </div>

        </div>

        <div class="email-confirmation">

          <h3>
            Confirmation Email Sent
          </h3>

          <p>
            A confirmation email containing your
            registration details and reference has
            been sent to the email address you provided.
            Please check your inbox or spam/junk folder.
          </p>

        </div>

        ${
          whatsappAvailable
            ? `
              <div class="whatsapp-confirmation">

                <h3>
                  Join the Outreach WhatsApp Group
                </h3>

                <p>
                  Your registration has been approved.
                  You can now join the official
                  outreach WhatsApp group.
                </p>

                <button
                  type="button"
                  class="whatsapp-button"
                  id="joinWhatsappButton"
                >
                  Join WhatsApp Group
                </button>

              </div>
            `
            : ""
        }

        <div class="status-meta">
          <span>
            Verified:
            ${formatDate(
              registration.verifiedAt
            )}
          </span>
        </div>

      </div>
    `;
  }

  /*
  ======================================================
  STATUS EVENTS
  ======================================================
  */

  function attachStatusEvents() {
    document
      .querySelectorAll(
        "[data-copy]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          async () => {
            const value =
              button.getAttribute(
                "data-copy"
              );

            try {
              await navigator.clipboard.writeText(
                value
              );

              const original =
                button.textContent;

              button.textContent =
                "Copied";

              setTimeout(() => {
                button.textContent =
                  original;
              }, 1500);

            } catch {
              window.prompt(
                "Copy this value:",
                value
              );
            }
          }
        );
      });

    const fileInput =
      $("#receiptFile");

    const fileName =
      $("#receiptFileName");

    if (fileInput && fileName) {
      fileInput.addEventListener(
        "change",
        () => {
          const file =
            fileInput.files &&
            fileInput.files[0];

          fileName.textContent =
            file
              ? file.name
              : "Choose payment receipt";
        }
      );
    }

    const iHavePaidButton =
      $("#iHavePaidButton");

    if (iHavePaidButton) {
      iHavePaidButton.addEventListener(
        "click",
        () => {
          const registration =
            currentStatusData &&
            currentStatusData.registration;

          const payment =
            currentStatusData &&
            currentStatusData.payment;

          if (!registration || !payment) return;

          currentStage = "receipt_upload";

          const view =
            $("#registrationStatusView");

          if (view) {
            view.innerHTML =
              renderReceiptUploadStatus(
                registration,
                payment
              );

            attachStatusEvents();

            window.scrollTo({
              top: 0,
              behavior: "smooth"
            });
          }
        }
      );
    }

    const submitButton =
      $("#submitReceiptButton");

    if (submitButton) {
      submitButton.addEventListener(
        "click",
        submitReceipt
      );
    }

    const joinWhatsappButton =
      $("#joinWhatsappButton");

    if (joinWhatsappButton) {
      joinWhatsappButton.addEventListener(
        "click",
        openApprovedWhatsapp
      );
    }
  }

  /*
  ======================================================
  LOAD STATUS
  ======================================================
  */

  async function loadRegistrationStatus(
    reference,
    scroll = true
  ) {
    if (!reference) return;

    try {
      const response =
      await fetch(
          `/api/registration-status?reference=${encodeURIComponent(
            reference
          )}`,
          {
            method: "GET",
            headers: {
              Accept:
                "application/json"
            }
          }
        );

      const data =
        await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          "Unable to load registration status."
        );
      }

      saveReference(reference);

      hideRegistrationForm();

      currentStatusData = data;

      if (currentStage !== "receipt_upload" || scroll) {
        renderStatusView(data, scroll);
      }

      if (scroll) {
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      }

      if (
        data.registration.paymentStatus ===
        "success"
      ) {
        stopStatusPolling();
      } else {
        startStatusPolling();
      }

    } catch (error) {
      console.error(
        "Status loading error:",
        error
      );

      if (scroll) {
        showStatusError(
          error.message ||
          "Unable to load your registration."
        );
      }
    }
  }

  function showStatusError(
    message
  ) {
    hideRegistrationForm();

    const main =
      getMainContainer();

    let view =
      $("#registrationStatusView");

    if (!view) {
      view =
        document.createElement("section");

      view.id =
        "registrationStatusView";

      view.className =
        "registration-status-view";

      main.appendChild(view);
    }

    view.innerHTML = `
      <div class="status-card status-error">

        <div class="status-card-header">
          <div class="status-indicator">
            <span class="status-indicator-dot"></span>
          </div>

          <div>
            <h2>Registration Not Found</h2>
            <p>
              We could not load the saved registration.
            </p>
          </div>
        </div>

        <div class="error-message">
          ${escapeHtml(message)}
        </div>

        <button
          type="button"
          class="secondary-action-button"
          id="returnToRegistration"
        >
          Return to Registration
        </button>

      </div>
    `;

    const button =
      $("#returnToRegistration");

    if (button) {
      button.addEventListener(
        "click",
        () => {
          clearSavedReference();
          stopStatusPolling();
          showRegistrationForm();
        }
      );
    }
  }

  /*
 ======================================================
  RECEIPT UPLOAD
  ======================================================
  */

  async function submitReceipt() {
    const transactionDateInput =
      $("#paymentTransactionDate");
    const transactionTimeInput =
      $("#paymentTransactionTime");

    const transactionDate =
      transactionDateInput
        ? transactionDateInput.value.trim()
        : "";

    const transactionTime =
      transactionTimeInput
        ? transactionTimeInput.value.trim()
        : "";

    if (!transactionDate) {
      const messageBox =
        $("#receiptUploadMessage");

      if (messageBox) {
        messageBox.className =
          "upload-message error";
        messageBox.textContent =
          "Please enter the payment transaction date.";
      }

      if (transactionDateInput) {
        transactionDateInput.focus();
      }

      return;
    }



      if (!transactionTime) {
        const messageBox =
          $("#receiptUploadMessage");

        if (messageBox) {
          messageBox.className =
            "upload-message error";
          messageBox.textContent =
            "Please enter the payment transaction time.";
        }

        if (transactionTimeInput) {
          transactionTimeInput.focus();
        }

        return;
      }

    const fileInput =
      $("#receiptFile");

    const messageBox =
      $("#receiptUploadMessage");

    const button =
      $("#submitReceiptButton");

    if (
      !fileInput ||
      !fileInput.files ||
      !fileInput.files[0]
    ) {
      if (messageBox) {
        messageBox.className =
          "upload-message error";

        messageBox.textContent =
          "Please select your payment receipt first.";
      }

      return;
    }

    const file =
      fileInput.files[0];

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf"
    ];

    if (!allowedTypes.includes(file.type)) {
      if (messageBox) {
        messageBox.className =
          "upload-message error";

        messageBox.textContent =
          "Please upload a JPG, PNG, WEBP or PDF file.";
      }

      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      if (messageBox) {
        messageBox.className =
          "upload-message error";

        messageBox.textContent =
          "The receipt must not be larger than 5 MB.";
      }

      return;
    }

    const reference =
      currentReference ||
      getSavedReference();

    if (!reference) {
      showStatusError(
        "Your registration reference could not be found on this device."
      );

      return;
    }

    const formData =
      new FormData();

    formData.append(
      "reference",
      reference
    );

    formData.append(
      "paymentTransactionDate",
      transactionDate
    );

    if (transactionTime) {
      formData.append(
        "paymentTransactionTime",
        transactionTime
      );
    }

    formData.append(
      "receipt",
      file
    );

    if (button) {
      button.disabled = true;
      button.textContent =
        "Uploading Receipt...";
    }

    if (messageBox) {
      messageBox.className =
        "upload-message";

      messageBox.textContent =
        "Uploading your receipt. Please wait...";
    }

    try {
      const response =
        await fetch(
          "/api/upload-receipt",
          {
            method: "POST",
            body: formData
          }
        );

      const data =
        await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          "Receipt upload failed."
        );
      }

      await loadRegistrationStatus(
        reference,
        true
      );

    } catch (error) {
      console.error(
        "Receipt upload error:",
        error
      );

      if (messageBox) {
        messageBox.className =
          "upload-message error";

        messageBox.textContent =
          error.message ||
          "Receipt upload failed. Please try again.";
      }

      if (button) {
        button.disabled = false;
        button.textContent =
          "Submit Receipt for Verification";
      }
    }
  }

  /*
======================================================
  APPROVED WHATSAPP
  ======================================================
  */

  async function openApprovedWhatsapp() {
    const reference =
      currentReference ||
      getSavedReference();

    if (!reference) return;

    try {
      const response =
        await fetch(
          `/api/registration-status?reference=${encodeURIComponent(
            reference
          )}`
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success ||
        data.registration.paymentStatus !==
          "success"
      ) {
        alert(
          "Your registration has not been approved yet."
        );

        return;
      }

      /*
       * The status endpoint intentionally does not
       * expose the actual WhatsApp URL.
       *
       * The secure approved-link endpoint will be
       * added on the server side before launch.
       */

      const linkResponse =
        await fetch(
          `/api/approved-whatsapp?reference=${encodeURIComponent(
            reference
          )}`
        );

      const linkData =
        await linkResponse.json();

      if (
        !linkResponse.ok ||
        !linkData.success ||
        !linkData.whatsappLink
      ) {
        throw new Error(
          "The WhatsApp group link is not currently available."
        );
      }

      window.open(
        linkData.whatsappLink,
        "_blank",
        "noopener,noreferrer"
      );

    } catch (error) {
      console.error(
        "WhatsApp link error:",
        error
      );

      alert(
        error.message ||
        "Unable to open the WhatsApp group."
      );
    }
  }

  /*
  ======================================================
  FORM SUBMISSION
  ======================================================
  */

  async function handleRegistrationSubmit(
    event
  ) {
    event.preventDefault();

    if (!registrationForm) return;

    const submitButton =
      registrationForm.querySelector(
        '[type="submit"]'
      );

    const formData =
      new FormData(
        registrationForm
      );

    const payload =
      Object.fromEntries(
        formData.entries()
      );

    if (submitButton) {
      submitButton.disabled = true;

      submitButton.dataset.originalText =
        submitButton.textContent;

      submitButton.textContent =
        "Saving Registration...";
    }

    try {
      const isEditing =
        !!currentReference &&
        !!currentStatusData;

      const response =
        await fetch(
          isEditing
            ? `/api/registration/${encodeURIComponent(
                currentReference
              )}`
            : "/api/register",
          {
            method:
              isEditing
                ? "PUT"
                : "POST",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json"
            },
            body:
              JSON.stringify(payload)
          }
        );

      const data =
        await response.json();

      if (!response.ok || !data.success) {
        if (data.duplicate) {
          const existingReference =
            data.reference || "";

          throw new Error(
            existingReference
              ? `An existing registration was found with this phone number and email. Your reference is ${existingReference}. Please use Continue Existing Registration to continue.`
              : "An existing registration was found with these contact details. Please use Continue Existing Registration to continue."
          );
        }

        throw new Error(
          data.message ||
          "Registration could not be completed."
        );
      }

      const reference =
        data.registration &&
        data.registration.reference;

      if (!reference) {
        throw new Error(
          "Registration was saved but no reference was returned."
        );
      }

      saveReference(reference);

      hideRegistrationForm();

      await loadRegistrationStatus(
        reference,
        true
      );

    } catch (error) {
      console.error(
        "Registration error:",
        error
      );

      showFormMessage(
        error.message ||
        "Unable to complete registration. Please try again.",
        "error"
      );

    } finally {
      if (submitButton) {
        submitButton.disabled = false;

        submitButton.textContent =
          submitButton.dataset.originalText ||
          "Submit Registration";
      }
    }
  }

  /*
  ======================================================
  EXISTING REGISTRATION DETECTION
  ======================================================
  */

  async function checkSavedRegistration() {
    const savedReference =
      getSavedReference();

    if (!savedReference) {
      return;
    }

    currentReference =
      savedReference;

    /*
    A saved registration is remembered for convenience,
    but the landing-page Begin Registration button must
    always open the participant details form.

    We load the saved data silently so the participant can
    continue editing the SAME registration.
    */
    try {
      const response =
        await fetch(
          `/api/registration-status?reference=${encodeURIComponent(
            savedReference
          )}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json"
            }
          }
        );

      const data =
        await response.json();

      if (!response.ok || !data.success) {
        return;
      }

      currentStatusData = data;

      populateRegistrationForm(
        data.registration || {}
      );
    } catch (error) {
      console.error(
        "Saved registration preload error:",
        error
      );
    }
  }

  /*
  ======================================================
  POPULATE SAVED REGISTRATION FORM
  ======================================================
  */

  function populateRegistrationForm(
    registration
  ) {
    if (!registrationForm) return;

    const fields = [
      "fullName",
      "phone",
      "email",
      "gender",
      "institution",
      "level",
      "faculty",
      "department",
      "cmda",
      "previousOutreach",
      "unit"
    ];

    fields.forEach((name) => {
      const field =
        registrationForm.elements[name];

      if (!field) return;

      const value =
        registration[name];

      if (value !== undefined && value !== null) {
        field.value = value;
      }
    });
  }

  /*
  ======================================================
  LANDING PAGE NAVIGATION
  ======================================================
  */

  function showLandingPage() {
    const landing = document.querySelector("#landingPage");
    const registration = document.querySelector("#registration");
    const statusView = document.querySelector("#registrationStatusView");

    if (landing) landing.style.display = "";
    if (registration) registration.style.display = "none";

    if (statusView) {
      statusView.innerHTML = "";
      statusView.style.display = "none";
    }

    stopStatusPolling();
    currentReference = null;
    currentStatusData = null;
    currentStage = "payment";
  }

  function showFreshRegistration() {
    clearSavedReference();
    stopStatusPolling();

    currentStatusData = null;
    currentStage = "payment";

    if (registrationForm) {
      registrationForm.reset();
      registrationForm.style.display = "";
    }

    const landing = document.querySelector("#landingPage");
    if (landing) landing.style.display = "none";

    const statusView = document.querySelector("#registrationStatusView");
    if (statusView) {
      statusView.innerHTML = "";
      statusView.style.display = "none";
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    if (registrationForm) {
      registrationForm.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }

  async function showContinueRegistration() {
    const savedReference =
      getSavedReference();

    if (savedReference) {
      currentReference =
        savedReference.trim().toUpperCase();

      try {
        await loadRegistrationStatus(
          currentReference,
          true
        );
        return;
      } catch (error) {
        console.error(
          "Saved registration could not be restored:",
          error
        );
      }
    }

    const email = window.prompt(
      "Enter the email address you used for your registration:"
    );

    if (!email || !email.trim()) {
      return;
    }

    try {
      const response = await fetch(
        "/api/registration-recovery?email=" +
          encodeURIComponent(
            email.trim().toLowerCase()
          ),
        {
          headers: {
            Accept: "application/json"
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

      saveReference(data.reference);

      await loadRegistrationStatus(
        data.reference,
        true
      );

    } catch (error) {
      console.error(
        "Registration recovery error:",
        error
      );

      alert(
        error.message ||
        "Unable to recover your registration."
      );
    }
  }

  function attachLandingButtons() {
    const beginButton =
      document.querySelector("#beginRegistration");

    const continueButton =
      document.querySelector("#continueRegistration");

    if (beginButton) {
      beginButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          showFreshRegistration();
        }
      );
    }

    if (continueButton) {
      continueButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          showContinueRegistration();
        }
      );
    }
  }

  /*
  ======================================================
  INITIALISE
  ======================================================
  */

  async function init() {
    if (registrationForm) {
      registrationForm.addEventListener(
        "submit",
        handleRegistrationSubmit
      );
    }

    attachLandingButtons();

    const landing =
      document.querySelector("#landingPage");

    if (landing) {
      showLandingPage();
    }

    const params =
      new URLSearchParams(
        window.location.search
      );

    const reference =
      String(
        params.get("reference") || ""
      )
        .trim()
        .toUpperCase();

    if (reference) {
      saveReference(reference);

      try {
        await loadRegistrationStatus(
          reference,
          true
        );
      } catch (error) {
        console.error(
          "Unable to restore registration from reference:",
          error
        );
      }

      window.history.replaceState(
        {},
        document.title,
        "/registration/#registration"
      );
    }
  }
if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();
