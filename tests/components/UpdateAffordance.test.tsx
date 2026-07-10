/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateAffordance } from "../../src/components/UpdateAffordance/UpdateAffordance";

afterEach(cleanup);

describe("UpdateAffordance", () => {
  it("offers a non-blocking update action and a dismissal", () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();

    render(
      <UpdateAffordance
        version="0.48.0"
        onInstall={onInstall}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Sigil 0.48.0 is available.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss update" }));

    expect(onInstall).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

});
