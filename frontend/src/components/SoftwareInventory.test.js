import { getInventoryStatusAppearance } from "./SoftwareInventory";

test("replaces Dynamics square markers with readable status labels and restrained colors", () => {
  expect(getInventoryStatusAppearance("🟩 Current")).toEqual(expect.objectContaining({
    label: "Current", dot: "#278052",
  }));
  expect(getInventoryStatusAppearance("🟧 Renewal due")).toEqual(expect.objectContaining({
    label: "Renewal due", dot: "#bb7419",
  }));
  expect(getInventoryStatusAppearance("🟥 Expired")).toEqual(expect.objectContaining({
    label: "Expired", dot: "#bd4b4b",
  }));
});

test("keeps status text when Dynamics does not include a color marker", () => {
  expect(getInventoryStatusAppearance("Inactive").label).toBe("Inactive");
  expect(getInventoryStatusAppearance("Custom status")).toEqual(expect.objectContaining({
    label: "Custom status", dot: "#718096",
  }));
  expect(getInventoryStatusAppearance("").label).toBe("Not set");
});
