export const CONSENT_DISCLOSURE =
  "Share exactly one tab with Vera. While shared, the tab URL and observed page content needed for your housing research may be processed through your paired Vera Browser Gateway. Cookies, saved passwords, browser storage, and authenticated headers are excluded from listing output. Vera never clicks Contact, Apply, Tour, Reply, Message, Email, Phone, payment, upload, or download controls.";

export function shareButtonLabel(shared) {
  return shared ? "Stop sharing this tab" : "Share this tab with Vera";
}
