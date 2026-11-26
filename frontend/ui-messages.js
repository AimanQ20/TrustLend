// Shared by escrow.js and workflow.js: turns raw contract errors into plain-English messages and shows
// them in a pop-up at the top of the page (so the user always sees the result of a click).
(function (root) {
  "use strict";
  const ROLE_NAMES = { 1: "ADMIN", 2: "PAUSER", 4: "VERIFIER", 8: "LENDER", 16: "BORROWER", 32: "ARBITER" };
  const n = (v) => Number(v);
  const rolesOf = (mask) => {
    const names = Object.keys(ROLE_NAMES).filter((b) => n(mask) & Number(b)).map((b) => ROLE_NAMES[b].toLowerCase());
    return names.length ? names.join(" or ") : "authorized user";
  };

  // Short, generic messages on purpose: they tell the user WHAT failed, not how the contract works inside.
  const MESSAGES = {
    Unauthorized: (a) => `Not allowed. This wallet is not an active ${rolesOf(a[1])}.`,
    EnforcedPause: () => "Action unavailable. The system is paused.",
    ExpectedPause: () => "Action not available.",
    ZeroAddress: () => "Invalid address.",
    InvalidLoan: () => "Loan not found.",
    InvalidState: () => "Action not allowed for this loan.",
    InvalidAmount: () => "Invalid amount.",
    NotBorrower: () => "Not allowed.",
    EscrowOnly: () => "Not allowed.",
    EscrowAlreadySet: () => "Action not allowed.",
    InvalidLender: () => "Not allowed.",
    InvalidStatus: () => "Action not allowed at this step.",
    AlreadyFunded: () => "Loan is not available for funding.",
    LoanNotApproved: () => "Loan is not available for funding.",
    SelfFunding: () => "Not allowed.",
    WrongAmount: () => "Incorrect amount.",
    AmountTooLarge: () => "Amount not supported.",
    NotParty: () => "Not allowed.",
    ConflictOfInterest: () => "Not allowed.",
    NothingToWithdraw: () => "Nothing to withdraw.",
    TransferFailed: () => "Transfer failed. Please try again.",
    ReentrantCall: () => "Request blocked.",
    SelfAction: () => "Action not allowed.",
  };

  /** Returns a short, generic message for any error thrown by ethers, a wallet or our own code. */
  function explain(e, interfaces) {
    if (!e) return "Action failed.";
    if (e.code === "ACTION_REJECTED" || e.code === 4001 || e?.info?.error?.code === 4001) return "Transaction cancelled.";
    if (e.code === "INSUFFICIENT_FUNDS") return "Insufficient funds.";
    if (e.revert && e.revert.name) return MESSAGES[e.revert.name] ? MESSAGES[e.revert.name](Array.from(e.revert.args || [])) : "Action not allowed.";
    const data = [e.data, e?.error?.data, e?.info?.error?.data, e?.info?.error?.data?.data].find((d) => typeof d === "string" && d.startsWith("0x") && d.length >= 10);
    if (data) {
      for (const iface of interfaces || []) {
        try {
          const p = iface.parseError(data);
          if (p) return MESSAGES[p.name] ? MESSAGES[p.name](Array.from(p.args)) : "Action not allowed.";
        } catch (_) { /* try the next ABI */ }
      }
    }
    const msg = String(e.shortMessage || e.message || "");
    if (/failed to fetch|econnrefused|could not coalesce|network error|timeout/i.test(msg)) return "Cannot connect to the network.";
    // Errors thrown by our own page code (no ethers/wallet error code) are short input messages: show them.
    if (!e.code && !e.shortMessage && e.message) return e.message;
    return "Action failed. Please try again.";
  }

  // ---- pop-up ----
  let timer;
  function toast(kind, message) {
    if (typeof document === "undefined") return;
    let el = document.getElementById("tl-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "tl-toast";
      el.setAttribute("role", "alert");
      el.setAttribute("aria-live", "assertive");
      document.body.appendChild(el);
    }
    el.className = `tl-toast ${kind}`;
    el.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close message");
    close.onclick = () => { el.hidden = true; };
    el.append(text, close);
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { el.hidden = true; }, kind === "ok" ? 6000 : 15000);
  }

  const api = { explain, toast, MESSAGES };
  root.TLMessages = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
