/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RenamePopup } from "./RenamePopup";

describe("RenamePopup", () => {
  it("renders input with oldName", () => {
    const { container } = render(<RenamePopup oldName="Old" kind="sigil" x={0} y={0} onRename={vi.fn()} onClose={vi.fn()} />);
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("Old");
  });

  it("Enter with changed name calls onRename and onClose", () => {
    const onRename = vi.fn(), onClose = vi.fn();
    const { container } = render(<RenamePopup oldName="Old" kind="affordance" x={0} y={0} onRename={onRename} onClose={onClose} />);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("affordance", "Old", "New");
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter with same name only calls onClose", () => {
    const onRename = vi.fn(), onClose = vi.fn();
    const { container } = render(<RenamePopup oldName="Same" kind="sigil" x={0} y={0} onRename={onRename} onClose={onClose} />);
    fireEvent.keyDown(container.querySelector("input")!, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter with empty only calls onClose", () => {
    const onRename = vi.fn(), onClose = vi.fn();
    const { container } = render(<RenamePopup oldName="Old" kind="invariant" x={0} y={0} onRename={onRename} onClose={onClose} />);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<RenamePopup oldName="Old" kind="sigil" x={0} y={0} onRename={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(container.querySelector("input")!, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("blur calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<RenamePopup oldName="Old" kind="sigil" x={0} y={0} onRename={vi.fn()} onClose={onClose} />);
    fireEvent.blur(container.querySelector("input")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("passes kind=invariant to onRename", () => {
    const onRename = vi.fn();
    const { container } = render(<RenamePopup oldName="Old" kind="invariant" x={0} y={0} onRename={onRename} onClose={vi.fn()} />);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("invariant", "Old", "New");
  });
});
