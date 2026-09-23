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
jest.mock("./components/SalesOutlook", () => (props) => mockPanel(props));
jest.mock("./components/SalesOutlookRfp", () => (props) => mockPanel(props));
jest.mock("./components/ContractBacklogSelected", () => (props) => mockPanel(props));
jest.mock("./components/ServiceLineFinancials", () => (props) => mockPanel(props));
jest.mock("./components/PEQualifiedLeads", () => (props) => mockPanel(props));
jest.mock("./components/ProductivityProjects", () => (props) => mockPanel(props));
jest.mock("./components/EmployeeProductivity", () => (props) => mockPanel(props));
jest.mock("./components/RfpOverallSuccessRate", () => (props) => mockPanel(props));
jest.mock("./components/MarketingMetrics", () => ({
  __esModule: true, default: (props) => mockPanel(props), MarketingOverview: (props) => mockPanel(props),
}));
let root, container;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function click(label) {
  await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label).click());
}
test("every reporting tab receives its selection and keeps it when switching tabs", async () => {
  await act(async () => root.render(<ManagementDashboard />));
  const tabs = ["Economic Indicators", "Company Financials", "Service Line Financials", "Sales Outlook", "Sales Outlook - RFP", "Sales Outlook - Contract Backlog Selected", "RFP Overall Success Rate", "Marketing", "Marketing - Service Lines", "Service Lines & Projects", "Employee Productivity", "PE"];
  for (const tab of tabs) {
    await click(tab);
    expect(JSON.parse(container.querySelector("[data-period]").textContent).year).toBe("all");
    await click("Select 2024");
    expect(JSON.parse(container.querySelector("[data-period]").textContent).year).toBe("2024");
  }
  await click(tabs[0]);
  expect(JSON.parse(container.querySelector("[data-period]").textContent).year).toBe("2024");
});
