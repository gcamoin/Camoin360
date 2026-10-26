import { filterAndSortInventory, getInventoryStatusAppearance } from "./SoftwareInventory";

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

test("inventory filtering and sorting keep the previous row order for every column", () => {
  const columns = ["status", "name", "description", "vendor", "service_type", "current_service_term", "primary_vendor_contact", "access_details", "primary_contact", "subscribed_since"];
  const rows = Array.from({ length: 120 }, (_, index) => ({
    id: index,
    status: index % 2 ? "🟧 Renewal due" : "🟩 Current",
    name: `Service ${index % 17}`,
    description: `Description ${index % 4}`,
    vendor: `Vendor ${index % 11}`,
    service_type: `Type ${index % 3}`,
    current_service_term: `${index % 5 + 1} months`,
    primary_vendor_contact: `Contact ${index % 7}`,
    access_details: `Access ${index % 13}`,
    primary_contact: `Manager ${index % 9}`,
    subscribed_since: `202${index % 5}-0${index % 9 + 1}-15`,
  }));
  const display = (row, key) => key === "status"
    ? getInventoryStatusAppearance(row[key]).label
    : key === "subscribed_since" && /^\d{4}-\d{2}-\d{2}/.test(row[key])
      ? new Date(`${row[key].slice(0, 10)}T00:00:00`).toLocaleDateString()
      : String(row[key] || "");
  const previous = (status, query, sort) => rows.filter(row =>
    (!status || row.status === status) && columns.some(column =>
      display(row, column).toLowerCase().includes(query.toLowerCase())
    )
  ).sort((a, b) => display(a, sort.key).localeCompare(display(b, sort.key), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1));

  for (const key of columns) {
    for (const direction of ["asc", "desc"]) {
      for (const [status, query] of [["", ""], ["🟩 Current", "service"], ["", "vendor 2"], ["🟧 Renewal due", "missing"]]) {
        const sort = { key, direction };
        expect(filterAndSortInventory(rows, status, query, sort).map(row => row.id))
          .toEqual(previous(status, query, sort).map(row => row.id));
      }
    }
  }
});
