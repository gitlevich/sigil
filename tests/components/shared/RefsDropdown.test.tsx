/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RefsDropdown } from "../../../src/../src/components/shared/RefsDropdown";
import type { RefHit } from "../../../src/../src/components/shared/RefsDropdown";

const hits: RefHit[] = [
  { contextName: "Alpha", contextPath: ["Parent", "Alpha"], line: "uses @Alpha" },
  { contextName: "Beta", contextPath: ["Parent", "Beta"], line: "uses @Beta" },
  { contextName: "Root", contextPath: [], line: "uses @Root at top" },
];

describe("RefsDropdown", () => {
  it("renders all hits", () => {
    const { container } = render(
      <RefsDropdown hits={hits} x={100} y={200} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );
    const items = container.querySelectorAll("[class*='item']");
    expect(items.length).toBe(3);
  });

  it("displays contextPath joined for non-empty paths", () => {
    const { container } = render(
      <RefsDropdown hits={hits} x={0} y={0} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );
    const contexts = container.querySelectorAll("[class*='context']");
    const texts = Array.from(contexts).map(el => el.textContent);
    expect(texts).toContain("Parent > Alpha");
    expect(texts).toContain("Parent > Beta");
  });

  it("displays contextName for empty path", () => {
    const { container } = render(
      <RefsDropdown hits={hits} x={0} y={0} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );
    const contexts = container.querySelectorAll("[class*='context']");
    expect(Array.from(contexts).map(el => el.textContent)).toContain("Root");
  });

  it("Enter navigates to active hit", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={onNavigate} onClose={onClose} />);
    fireEvent.keyDown(container.firstElementChild!, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(["Parent", "Alpha"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown then Enter selects second item", () => {
    const onNavigate = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={onNavigate} onClose={vi.fn()} />);
    const dd = container.firstElementChild!;
    fireEvent.keyDown(dd, { key: "ArrowDown" });
    fireEvent.keyDown(dd, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(["Parent", "Beta"]);
  });

  it("ArrowUp at first stays at first", () => {
    const onNavigate = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={onNavigate} onClose={vi.fn()} />);
    const dd = container.firstElementChild!;
    fireEvent.keyDown(dd, { key: "ArrowUp" });
    fireEvent.keyDown(dd, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(["Parent", "Alpha"]);
  });

  it("ArrowDown clamps at last item", () => {
    const onNavigate = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={onNavigate} onClose={vi.fn()} />);
    const dd = container.firstElementChild!;
    for (let i = 0; i < 10; i++) fireEvent.keyDown(dd, { key: "ArrowDown" });
    fireEvent.keyDown(dd, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith([]); // last item
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(container.firstElementChild!, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("mouseDown on item navigates and closes", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={onNavigate} onClose={onClose} />);
    const items = container.querySelectorAll("[class*='item']");
    fireEvent.mouseDown(items[1]);
    expect(onNavigate).toHaveBeenCalledWith(["Parent", "Beta"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("mouseEnter changes active index", () => {
    const onNavigate = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={onNavigate} onClose={vi.fn()} />);
    const items = container.querySelectorAll("[class*='item']");
    fireEvent.mouseEnter(items[2]);
    fireEvent.keyDown(container.firstElementChild!, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith([]);
  });

  it("onBlur calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<RefsDropdown hits={hits} x={0} y={0} onNavigate={vi.fn()} onClose={onClose} />);
    fireEvent.blur(container.firstElementChild!);
    expect(onClose).toHaveBeenCalled();
  });
});
