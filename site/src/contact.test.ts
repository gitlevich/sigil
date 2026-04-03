import { describe, expect, it } from "vitest";
import {
  CONTACT_AJAX_URL,
  CONTACT_EMAIL,
  CONTACT_POST_URL,
  CONTACT_SUBJECT,
  buildContactRequest,
} from "./contact";

describe("contact", () => {
  it("prepares a FormSubmit payload for the static site", () => {
    const formData = new FormData();
    formData.set("name", "Vlad");
    formData.set("email", "vlad@example.com");
    formData.set("message", "Hello");

    const payload = buildContactRequest(formData);

    expect(CONTACT_EMAIL).toBe("info@sigilengineering.com");
    expect(CONTACT_POST_URL).toBe("https://formsubmit.co/info@sigilengineering.com");
    expect(CONTACT_AJAX_URL).toBe("https://formsubmit.co/ajax/info@sigilengineering.com");
    expect(payload.get("_subject")).toBe(CONTACT_SUBJECT);
    expect(payload.get("_template")).toBe("table");
    expect(payload.get("_replyto")).toBe("vlad@example.com");
  });
});
