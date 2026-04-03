export const CONTACT_EMAIL = "vlad@sigilengineering.com";
export const CONTACT_POST_URL = `https://formsubmit.co/${CONTACT_EMAIL}`;
export const CONTACT_AJAX_URL = `https://formsubmit.co/ajax/${CONTACT_EMAIL}`;
export const CONTACT_SUBJECT = "Sigil Engineering inquiry";

export function buildContactRequest(formData: FormData) {
  const payload = new FormData();

  for (const [key, value] of formData.entries()) {
    payload.append(key, value);
  }

  payload.set("_subject", CONTACT_SUBJECT);
  payload.set("_template", "table");

  const replyTo = payload.get("email")?.toString().trim();
  if (replyTo) {
    payload.set("_replyto", replyTo);
  }

  return payload;
}
