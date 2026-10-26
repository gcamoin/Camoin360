import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ManagementDashboard from "./managementDashboard";

window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("@mui/material", () => ({
  ...jest.requireActual("@mui/material"), Tooltip: ({ children }) => children,
}));
const mockPanel = ({ filters }) => <pre data-period>{JSON.stringify(filters)}</pre>;
jest.mock("./components/AiChatBox", () => () => null);
jest.mock("./components/DashboardDateFilters", () => ({
  __esModule: true,
  EMPTY_DATE_FILTERS: { year: "all", quarter: "all", month: "all", startDate: "", endDate: "" },
  default: ({ value, onChange }) => <button onClick={() => onChange({ ...value, year: "2024" })}>Select 2024</button>,
}));
jest.mock("./components/EconomicIndicators", () => (props) => mockPanel(props));
jest.mock("./components/CompanyFinancials", () => (props) => mockPanel(props));
jest.mock("./components/MarketingSource", () => () => <div>Marketing source report</div>);
jest.mock("./components/SurveyComponent", () => () => <div>Client surveys</div>);
jest.mock("./components/SalesOutlook", () => (props) => mockPanel(props));
jest.mock("./components/SalesOutlookRfp", () => (props) => mockPanel(props));
jest.mock("./components/ContractBacklogSelected", () => (props) => mockPanel(props));
jest.mock("./components/ServiceLineFinancials", () => (props) => mockPanel(props));
jest.mock("./components/PEQualifiedLeads", () => (props) => mockPanel(props));
jest.mock("./components/ProductivityProjects", () => (props) => mockPanel(props));
jest.mock("./components/EmployeeProductivity", () => (props) => mockPanel(props));
jest.mock("./components/RfpOverallSuccessRate", () => (props) => mockPanel(props));
jest.mock("./components/SoftwareInventory", () => () => <div>Inventory table</div>);
jest.mock("./components/MarketingMetrics", () => ({
  __esModule: true, default: (props) => mockPanel(props), MarketingOverview: (props) => mockPanel(props),
}));
let root, container;
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function click(label) {
  await act(async () => Array.from(container.querySelectorAll("button, a")).find((item) => item.textContent === label).click());
}
test("every reporting tab receives its selection and keeps it when switching tabs", async () => {
  await act(async () => root.render(<ManagementDashboard />));
  const groups = [
    ["Financials & Economy", "Economic Indicators", "Company Financials", "Service Line Financials"],
    ["Sales & Prospects", "Sales Outlook", "Sales Outlook - RFP", "Contract Backlog", "RFP Overall Success Rate", "ProspectEngage Leads"],
    ["Marketing", "Marketing Overview", "Service Line Marketing"],
    ["Operations", "Service Lines & Projects", "Employee Productivity"],
  ];
  for (const [group, ...tabs] of groups) {
    await click(group);
    for (const tab of tabs) {
      await click(tab);
      expect(JSON.parse(container.querySelector("[data-period]").textContent).year).toBe("all");
      await click("Select 2024");
      expect(JSON.parse(container.querySelector("[data-period]").textContent).year).toBe("2024");
    }
  }
  await click("Financials & Economy");
  await click("Economic Indicators");
  expect(JSON.parse(container.querySelector("[data-period]").textContent).year).toBe("2024");
});

test("navigation groups reveal their pages and show the selected page", async () => {
  await act(async () => root.render(<ManagementDashboard />));
  expect(container.querySelector('nav button[aria-expanded="true"]')).toBeNull();
  await click("Marketing");
  expect(container.querySelector('nav button[aria-expanded="true"]').textContent).toBe("Marketing");
  await click("Marketing Source");
  expect(container.querySelector('nav a[aria-current="page"]').textContent).toBe("Marketing Source");
  await click("Operations");
  expect(Array.from(container.querySelectorAll("nav a")).some((item) => item.textContent === "Marketing Source")).toBe(false);
});

test("Overview shortcuts open Marketing and Software Inventory", async () => {
  await act(async () => root.render(<ManagementDashboard />));

  await click("Open Marketing");
  expect(container.querySelector("h2").textContent).toBe("Marketing");

  await click("Overview");
  await click("Open Software Inventory");
  expect(container.querySelector("h2").textContent).toBe("Software Inventory");
  expect(container.textContent).toContain("Inventory table");
});

test("management report URLs restore the selected page and follow browser history", async () => {
  window.history.replaceState({}, "", "/management/marketing-source");
  await act(async () => root.render(<ManagementDashboard />));
  expect(container.querySelector("h2").textContent).toBe("Marketing Source");
  expect(container.querySelector('nav button[aria-expanded="true"]').textContent).toBe("Marketing");

  await click("Operations");
  await click("Software Inventory");
  expect(window.location.pathname).toBe("/management/software-inventory");

  await act(async () => {
    window.history.replaceState({}, "", "/management/marketing-source");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(container.querySelector("h2").textContent).toBe("Marketing Source");
});

test("mobile navigation can be opened and closes after choosing a page", async () => {
  await act(async () => root.render(<ManagementDashboard />));
  await act(async () => container.querySelector('[aria-label="Open navigation"]').click());
  expect(container.querySelector('[aria-label="Close navigation"]').getAttribute("aria-expanded")).toBe("true");
  await click("Marketing");
  await click("Marketing Source");
  expect(container.querySelector('[aria-label="Open navigation"]').getAttribute("aria-expanded")).toBe("false");
});
