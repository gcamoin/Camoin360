import { filterAndSortInventory } from "./SoftwareInventory";
import { filterAndSortClients } from "./PEClients";
import { filterAndSortQualifiedLeads } from "./PEQualifiedLeads";

const rows = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  status: index % 3 === 0 ? "🟩 Current" : "🟧 Renewal due",
  name: `Service ${String(5000 - index).padStart(5, "0")}`,
  description: `Data platform subscription ${index}`,
  vendor: `Vendor ${index % 71}`,
  service_type: `Analytics ${index % 9}`,
  current_service_term: "12 months",
  primary_vendor_contact: `Contact ${index % 33}`,
  access_details: `Access ${index % 15}`,
  primary_contact: `Manager ${index % 27}`,
  subscribed_since: `202${index % 7}-0${index % 9 + 1}-15`,
}));
const clients = rows.map((row) => ({ organization_name: row.name, city: row.vendor, state: "NY", user_count: row.id % 30, contract_expiration: row.subscribed_since }));
const leads = rows.map((row) => ({ prospect_name: row.name, client_name: row.vendor, createdon: row.subscribed_since }));

function medianMilliseconds(run) {
  for (let index = 0; index < 3; index += 1) run();
  const durations = [];
  for (let index = 0; index < 9; index += 1) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return durations[4].toFixed(2);
}

const measure = process.env.MEASURE_TABLE_PERFORMANCE === "1" ? test : test.skip;

measure("measure table filter and sort paths", () => {
  console.log(JSON.stringify({
    inventorySearch: medianMilliseconds(() => filterAndSortInventory(rows, "", "service", { key: "name", direction: "asc" })),
    inventoryDateSort: medianMilliseconds(() => filterAndSortInventory(rows, "", "", { key: "subscribed_since", direction: "asc" })),
    clientsSearch: medianMilliseconds(() => filterAndSortClients(clients, "service", "name_asc")),
    leadsSearch: medianMilliseconds(() => filterAndSortQualifiedLeads(leads, "service", "", "newest")),
  }));
});
