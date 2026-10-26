import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import DashboardDateFilters, { EMPTY_DATE_FILTERS } from "./DashboardDateFilters";

window.IS_REACT_ACT_ENVIRONMENT = true;

test("period picker reveals only the controls for the selected mode and clears the selection", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function FilterFixture() {
    const [value, setValue] = useState(EMPTY_DATE_FILTERS);
    return <><DashboardDateFilters onChange={setValue} value={value} /><pre data-period>{JSON.stringify(value)}</pre></>;
  }

  await act(async () => root.render(<FilterFixture />));
  expect(container.textContent).not.toContain("Start date");
  expect(container.textContent).not.toContain("All years");

  await act(async () => {
    container.querySelector('[role="combobox"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await act(async () => {
    Array.from(document.querySelectorAll('[role="option"]')).find((option) => option.textContent === "Custom date range").click();
  });
  expect(container.textContent).toContain("Start date");
  expect(container.textContent).not.toContain("All years");
  expect(JSON.parse(container.querySelector("[data-period]").textContent).mode).toBe("dates");

  await act(async () => {
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Clear period").click();
  });
  expect(JSON.parse(container.querySelector("[data-period]").textContent)).toEqual(EMPTY_DATE_FILTERS);
  expect(container.textContent).not.toContain("Start date");

  await act(async () => {
    container.querySelector('[role="combobox"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await act(async () => {
    Array.from(document.querySelectorAll('[role="option"]')).find((option) => option.textContent === "Year, quarter, or month").click();
  });
  expect(container.textContent).toContain("All years");
  expect(container.textContent).toContain("All quarters");
  expect(container.textContent).not.toContain("Start date");

  await act(async () => root.unmount());
  container.remove();
});
