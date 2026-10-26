import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Container,
  Divider,
  IconButton,
  Paper,
  SvgIcon,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import EconomicIndicators from "./components/EconomicIndicators";
import { EmptyState, ManagementSectionHeading, managementButtonSx, managementCardSx } from "./components/UiPrimitives";
import CompanyFinancials from "./components/CompanyFinancials";
import EmployeeProductivity from "./components/EmployeeProductivity";
import MarketingMetrics, { MarketingOverview } from "./components/MarketingMetrics";
import MarketingSource from "./components/MarketingSource";
import PEQualifiedLeads from "./components/PEQualifiedLeads";
import ProductivityProjects from "./components/ProductivityProjects";
import ServiceLineFinancials from "./components/ServiceLineFinancials";
import SoftwareInventory from "./components/SoftwareInventory";
import SurveyComponent from "./components/SurveyComponent";
import AiChatBox from "./components/AiChatBox";
import DashboardDateFilters, { EMPTY_DATE_FILTERS } from "./components/DashboardDateFilters";
import RfpOverallSuccessRate from "./components/RfpOverallSuccessRate";
import SalesOutlook from "./components/SalesOutlook";
import SalesOutlookRfp from "./components/SalesOutlookRfp";
import ContractBacklogSelected from "./components/ContractBacklogSelected";
import { SidebarResizeHandle, useResizableSidebar } from "./useResizableSidebar";

const graphViews = new Set([
  "economicIndicators",
  "companyFinancials",
  "serviceLineFinancials",
  "marketing",
  "marketingMetrics",
  "productivityProjects",
  "employeeProductivity",
  "pe",
  "rfpOverallSuccessRate",
  "salesOutlook",
  "salesOutlookRfp",
  "contractBacklogSelected",
]);

const visualRefreshViews = new Set(["overview", "marketing", "softwareInventory"]);

const views = {
  overview: {
    label: "Overview",
    title: "Overview",
    description:
      "High-level summary of enrichment operations and team activity.",
  },
  economicIndicators: {
    label: "Economic Indicators",
    title: "Economic Indicators",
    description: "Key economic metrics and indicators across tracked accounts.",
  },
  companyFinancials: {
    label: "Company Financials",
    title: "Company Financials",
    description:
      "Financial performance data and trends across portfolio companies.",
  },
  serviceLineFinancials: {
    label: "Service Line Financials",
    title: "Service Line Financials",
    description:
      "Dummy monthly and quarterly financial trends by consulting service line.",
  },
  salesOutlook: {
    label: "Sales Outlook",
    title: "Sales Outlook",
    description: "Long-term contract value and monthly project trends from Dynamics.",
  },
  salesOutlookRfp: {
    label: "Sales Outlook - RFP",
    title: "Sales Outlook - RFP",
    description: "Proposal and won-contract trends from live Dynamics opportunities.",
  },
  contractBacklogSelected: {
    label: "Contract Backlog",
    title: "Sales Outlook - Contract Backlog Selected",
    description: "Annual total contract backlog and total monthly revenue from Dynamics.",
  },
  rfpOverallSuccessRate: {
    label: "RFP Overall Success Rate",
    title: "RFP Overall Success Rate",
    description: "Quarterly success rates based on the value and number of RFPs won.",
  },
  marketing: {
    label: "Marketing Overview",
    title: "Marketing",
    description: "Website visitor trends and target industry engagement.",
  },
  marketingMetrics: {
    label: "Service Line Marketing",
    title: "Marketing Metrics",
    description: "Marketing performance and campaign metrics across accounts.",
  },
  marketingSource: {
    label: "Marketing Source",
    title: "Marketing Source",
    description: "Website traffic sources by service line and month from Google Analytics.",
  },
  productivityProjects: {
    label: "Service Lines & Projects",
    title: "Productivity & Projects",
    description:
      "Project status, team productivity, and operational throughput.",
  },
  softwareInventory: {
    label: "Software Inventory",
    title: "Software Inventory",
    description:
      "Current software and data subscriptions, ownership, access, renewal timing, vendor contacts, and cost history.",
  },
  surveys: {
    label: "Client Surveys",
    title: "Survey Component",
    description: "Completed client surveys from Dynamics projects.",
  },
  employeeProductivity: {
    label: "Employee Productivity",
    title: "Employee Productivity",
    description: "Employee-level productivity metrics and workload trends.",
  },
  pe: {
    label: "ProspectEngage Leads",
    title: "PE",
    description: "ProspectEngage qualified leads sent to clients.",
  },
};

const navGroups = [
  {
    key: "financials",
    label: "Financials & Economy",
    icon: "finance",
    views: ["economicIndicators", "companyFinancials", "serviceLineFinancials"],
  },
  {
    key: "sales",
    label: "Sales & Prospects",
    icon: "trending",
    views: ["salesOutlook", "salesOutlookRfp", "contractBacklogSelected", "rfpOverallSuccessRate", "pe"],
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "campaign",
    views: ["marketing", "marketingMetrics", "marketingSource"],
  },
  {
    key: "operations",
    label: "Operations",
    icon: "projects",
    views: ["productivityProjects", "employeeProductivity", "surveys", "softwareInventory"],
  },
];

const viewPaths = Object.fromEntries(
  Object.keys(views).map((key) => [key, `/management/${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`])
);

function viewFromPath(pathname) {
  return Object.keys(viewPaths).find((key) => viewPaths[key] === pathname.replace(/\/$/, "")) || "overview";
}

function groupForView(viewKey) {
  return navGroups.find((group) => group.views.includes(viewKey))?.key || null;
}

const iconPaths = {
  campaign:
    "M4 10v4h3l5 4V6l-5 4H4Zm10.5 4.8 1.4 1.4A6 6 0 0 0 18 12a6 6 0 0 0-2.1-4.2l-1.4 1.4A4 4 0 0 1 16 12a4 4 0 0 1-1.5 2.8Z",
  collapse:
    "M15.5 5 8.5 12l7 7-1.4 1.4L5.7 12l8.4-8.4L15.5 5Zm4 0-7 7 7 7-1.4 1.4L9.7 12l8.4-8.4L19.5 5Z",
  expand:
    "m8.5 5 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L8.5 5Zm-4 0 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L4.5 5Z",
  finance: "M5 19V9h3v10H5Zm5 0V5h3v14h-3Zm5 0v-7h3v7h-3Z",
  chevronDown: "m7 10 5 5 5-5-1.4-1.4L12 12.2 8.4 8.6 7 10Z",
  chevronRight: "m10 7 5 5-5 5-1.4-1.4 3.6-3.6-3.6-3.6L10 7Z",
  overview: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
  menu: "M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z",
  close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z",
  projects: "M5 5h14v4H5V5Zm0 6h9v4H5v-4Zm0 6h14v2H5v-2Zm11-6h3v4h-3v-4Z",
  signout: "M10 17v-2h4V9h-4V7h6v10h-6Zm-1-1-5-4 5-4v3h6v2H9v3Z",
  trending:
    "M4 17h16v2H4v-2Zm1-3 5-5 4 4 5-7 1.6 1.2-6.4 8.9-4.1-4.1-3.7 3.7L5 14Z",
};

function NavIcon({ name }) {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24">
      <path d={iconPaths[name]} />
    </SvgIcon>
  );
}

export default function ManagementDashboard({ onLogout }) {
  const [activeView, setActiveView] = useState(() => viewFromPath(window.location.pathname));
  const [openGroup, setOpenGroup] = useState(() => groupForView(viewFromPath(window.location.pathname)));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarResize = useResizableSidebar("management");
  const [dateFiltersByView, setDateFiltersByView] = useState({});
  const theme = useTheme();
  const currentView = views[activeView];
  const isVisualRefreshView = visualRefreshViews.has(activeView);
  const activeDateFilters = dateFiltersByView[activeView] || EMPTY_DATE_FILTERS;
  const analystContext = useMemo(
    () => ({
      active_view: activeView,
      date_filters: graphViews.has(activeView) ? activeDateFilters : null,
      description: currentView.description,
      title: currentView.title,
    }),
    [activeDateFilters, activeView, currentView]
  );

  useEffect(() => {
    const canonicalPath = viewPaths[viewFromPath(window.location.pathname)];
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState({}, "", canonicalPath);
    }
    function handlePopState() {
      const nextView = viewFromPath(window.location.pathname);
      setActiveView(nextView);
      setOpenGroup(groupForView(nextView));
      setMobileNavOpen(false);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigateToView(viewKey) {
    setActiveView(viewKey);
    setOpenGroup(groupForView(viewKey));
    setMobileNavOpen(false);
    if (window.location.pathname !== viewPaths[viewKey]) {
      window.history.pushState({}, "", viewPaths[viewKey]);
    }
  }

  function handleViewLink(event, viewKey) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateToView(viewKey);
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: `radial-gradient(circle at top left, ${theme.palette.secondary.main}12, transparent 30%), ${theme.palette.background.default}`,
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: sidebarCollapsed ? "88px minmax(0, 1fr)" : `${sidebarResize.width}px minmax(0, 1fr)`,
          },
          minHeight: "100vh",
          transition: sidebarResize.isResizing ? "none" : "grid-template-columns 180ms ease",
        }}
      >
        <Box
          component="aside"
          sx={{
            alignSelf: { md: "start" },
            backgroundColor: "primary.main",
            color: "common.white",
            height: { md: "100vh" },
            overflow: { md: "hidden" },
            p: { xs: 1.5, md: 3 },
            position: { xs: "relative", md: "sticky" },
            top: { md: 0 },
            transition: "padding 180ms ease",
          }}
        >
          {!sidebarCollapsed && (
            <SidebarResizeHandle
              isResizing={sidebarResize.isResizing}
              onReset={sidebarResize.resetWidth}
              onResizeStart={sidebarResize.startResize}
            />
          )}
          <Stack
            spacing={{ xs: 1.5, md: 3 }}
            sx={{
              height: { md: "100%" },
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                alignItems: "flex-start",
                display: "flex",
                gap: 2,
                justifyContent: sidebarCollapsed ? "center" : "space-between",
              }}
            >
              {!sidebarCollapsed && (
                <Box>
                  <Typography
                    component="h1"
                    sx={{
                      fontSize: "1.55rem",
                      fontWeight: 800,
                      lineHeight: 1.1,
                    }}
                  >
                    Camoin 360
                  </Typography>
                  <Typography
                    sx={{ color: "rgba(255,255,255,0.72)", mt: 0.75 }}
                    variant="body2"
                  >
                    <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>Management</Box>
                    <Box component="span" sx={{ display: { xs: "inline", md: "none" } }}>{currentView.label}</Box>
                  </Typography>
                </Box>
              )}

              <IconButton
                aria-label={
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                size="small"
                sx={{
                  borderColor: "rgba(255,255,255,0.32)",
                  borderStyle: "solid",
                  borderWidth: 1,
                  color: "common.white",
                  height: 36,
                  width: 36,
                  display: { xs: "none", md: "inline-flex" },
                  "&:hover": {
                    borderColor: "common.white",
                    backgroundColor: "rgba(255,255,255,0.10)",
                  },
                }}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <NavIcon name={sidebarCollapsed ? "expand" : "collapse"} />
              </IconButton>
              <IconButton
                aria-controls="management-navigation"
                aria-expanded={mobileNavOpen}
                aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
                onClick={() => setMobileNavOpen((open) => !open)}
                sx={{ color: "common.white", display: { xs: "inline-flex", md: "none" }, height: 44, width: 44 }}
              >
                <NavIcon name={mobileNavOpen ? "close" : "menu"} />
              </IconButton>
            </Box>

            <Divider sx={{ borderColor: "rgba(255,255,255,0.18)" }} />

            <Stack
              component="nav"
              id="management-navigation"
              aria-label="Management navigation"
              spacing={1}
              sx={{
                display: { xs: mobileNavOpen ? "flex" : "none", md: "flex" },
                flex: { md: 1 },
                minHeight: 0,
                overflowX: "hidden",
                overflowY: "auto",
                maxHeight: { xs: "min(60vh, 440px)", md: "none" },
                pb: { xs: 0.5, md: 0 },
              }}
            >
              <Tooltip arrow disableHoverListener={!sidebarCollapsed} placement="right" title="Overview">
                <Button
                  component="a"
                  fullWidth
                  aria-current={activeView === "overview" ? "page" : undefined}
                  href={viewPaths.overview}
                  onClick={(event) => handleViewLink(event, "overview")}
                  startIcon={<NavIcon name="overview" />}
                  sx={{
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    borderRadius: 1,
                    color: activeView === "overview" ? "primary.main" : "common.white",
                    backgroundColor: activeView === "overview" ? "common.white" : "transparent",
                    fontWeight: 800,
                    minWidth: 0,
                    px: sidebarCollapsed ? 1 : 2,
                    "& .MuiButton-startIcon": { m: sidebarCollapsed ? 0 : undefined },
                    "&:hover": { backgroundColor: activeView === "overview" ? "common.white" : "rgba(255,255,255,0.12)" },
                  }}
                >
                  {!sidebarCollapsed && "Overview"}
                </Button>
              </Tooltip>
              {navGroups.map((group) => {
                const isOpen = openGroup === group.key;
                const hasActiveView = group.views.includes(activeView);
                return (
                  <Box key={group.key}>
                    <Tooltip arrow disableHoverListener={!sidebarCollapsed} placement="right" title={group.label}>
                      <Button
                        fullWidth
                        aria-controls={isOpen && !sidebarCollapsed ? `management-nav-${group.key}` : undefined}
                        aria-expanded={isOpen && !sidebarCollapsed}
                        onClick={() => {
                          if (sidebarCollapsed) setSidebarCollapsed(false);
                          setOpenGroup(isOpen && !sidebarCollapsed ? null : group.key);
                        }}
                        startIcon={<NavIcon name={group.icon} />}
                        endIcon={!sidebarCollapsed && <NavIcon name={isOpen ? "chevronDown" : "chevronRight"} />}
                        sx={{
                          justifyContent: sidebarCollapsed ? "center" : "flex-start",
                          borderRadius: 1,
                          color: "common.white",
                          backgroundColor: hasActiveView ? "rgba(255,255,255,0.16)" : "transparent",
                          fontWeight: 800,
                          minWidth: 0,
                          px: sidebarCollapsed ? 1 : 2,
                          textAlign: "left",
                          "& .MuiButton-startIcon": { m: sidebarCollapsed ? 0 : undefined, flexShrink: 0 },
                          "& .MuiButton-endIcon": { ml: "auto" },
                          "&:hover": { backgroundColor: "rgba(255,255,255,0.22)" },
                        }}
                      >
                        {!sidebarCollapsed && group.label}
                      </Button>
                    </Tooltip>
                    {isOpen && !sidebarCollapsed && (
                      <Stack id={`management-nav-${group.key}`} spacing={0.25} sx={{ borderLeft: "1px solid rgba(255,255,255,0.3)", ml: 3, mt: 0.5, pl: 1 }}>
                        {group.views.map((viewKey) => {
                          const view = views[viewKey];
                          const isActive = activeView === viewKey;
                          return (
                            <Button
                              component="a"
                              key={viewKey}
                              fullWidth
                              aria-current={isActive ? "page" : undefined}
                              href={viewPaths[viewKey]}
                              onClick={(event) => handleViewLink(event, viewKey)}
                              sx={{
                                justifyContent: "flex-start",
                                borderRadius: 1,
                                color: isActive ? "primary.main" : "common.white",
                                backgroundColor: isActive ? "common.white" : "transparent",
                                fontSize: "0.8rem",
                                fontWeight: isActive ? 800 : 600,
                                lineHeight: 1.2,
                                minWidth: 0,
                                px: 1.5,
                                py: 1,
                                textAlign: "left",
                                whiteSpace: "normal",
                                "&:hover": { backgroundColor: isActive ? "common.white" : "rgba(255,255,255,0.12)" },
                              }}
                            >
                              {view.label}
                            </Button>
                          );
                        })}
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Stack>

            <Button
              fullWidth
              onClick={onLogout}
              startIcon={<NavIcon name="signout" />}
              sx={{
                borderColor: "rgba(255,255,255,0.42)",
                color: "common.white",
                borderRadius: 1,
                fontWeight: 800,
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                minWidth: 0,
                px: sidebarCollapsed ? 1 : 2,
                alignSelf: { xs: "flex-start", md: "stretch" },
                fontSize: { xs: 0, md: "0.875rem" },
                position: { xs: "static", md: "static" },
                width: { xs: mobileNavOpen ? "100%" : 44, md: "100%" },
                display: { xs: mobileNavOpen ? "inline-flex" : "none", md: "inline-flex" },
                "& .MuiButton-startIcon": {
                  m: { xs: 0, md: sidebarCollapsed ? 0 : undefined },
                },
                "&:hover": {
                  borderColor: "common.white",
                  backgroundColor: "rgba(255,255,255,0.10)",
                },
              }}
              title="Sign out"
              variant="outlined"
            >
              {!sidebarCollapsed && "Sign out"}
            </Button>
          </Stack>
        </Box>

        <Box component="main" sx={{ minWidth: 0, py: { xs: 2, md: 5 } }}>
          <Container maxWidth={false} sx={{ maxWidth: 1600, minWidth: 0, px: { xs: 2, sm: 3 }, width: "100%" }}>
            <Stack spacing={3} sx={{ minWidth: 0, width: "100%" }}>
              <Box
                sx={isVisualRefreshView ? {
                  ...managementCardSx,
                  background: "linear-gradient(120deg, #ffffff 55%, #f1f8f6 100%)",
                  borderLeft: "4px solid",
                  borderLeftColor: "secondary.main",
                  p: { xs: 2.5, md: 3.5 },
                } : undefined}
              >
                {isVisualRefreshView ? (
                  <Typography color="secondary.main" fontWeight={800} sx={{ letterSpacing: "0.1em", mb: 0.75 }} variant="overline">
                    Management / {currentView.label}
                  </Typography>
                ) : null}
                <Typography
                  component="h2"
                  sx={{
                    color: "primary.main",
                    fontSize: { xs: "2rem", md: "2.35rem" },
                    fontWeight: 750,
                    lineHeight: 1.1,
                    mb: 1,
                  }}
                >
                  {currentView.title}
                </Typography>
                <Typography
                  sx={{
                    color: "text.secondary",
                    fontSize: { xs: "1rem", md: "1.08rem" },
                    maxWidth: 760,
                  }}
                >
                  {currentView.description}
                </Typography>
              </Box>

              {!isVisualRefreshView ? <AiChatBox
                context={analystContext}
                placeholder={`Ask the AI Analyst about ${currentView.title.toLowerCase()}...`}
                section={currentView.title}
              /> : null}

              {graphViews.has(activeView) ? (
                <DashboardDateFilters
                  onChange={(nextFilters) =>
                    setDateFiltersByView((current) => ({
                      ...current,
                      [activeView]: nextFilters,
                    }))
                  }
                  value={activeDateFilters}
                />
              ) : null}

              {activeView === "economicIndicators" && <EconomicIndicators filters={activeDateFilters} />}
              {activeView === "companyFinancials" && <CompanyFinancials filters={activeDateFilters} />}
              {activeView === "salesOutlook" && <SalesOutlook filters={activeDateFilters} />}
              {activeView === "salesOutlookRfp" && <SalesOutlookRfp filters={activeDateFilters} />}
              {activeView === "contractBacklogSelected" && <ContractBacklogSelected filters={activeDateFilters} />}
              {activeView === "serviceLineFinancials" && <ServiceLineFinancials filters={activeDateFilters} />}
              {activeView === "rfpOverallSuccessRate" && (
                <RfpOverallSuccessRate filters={activeDateFilters} />
              )}
              {activeView === "marketing" && <MarketingOverview filters={activeDateFilters} />}
              {activeView === "marketingMetrics" && <MarketingMetrics filters={activeDateFilters} />}
              {activeView === "marketingSource" && <MarketingSource />}
              {activeView === "pe" && <PEQualifiedLeads filters={activeDateFilters} />}
              {activeView === "productivityProjects" && (
                <ProductivityProjects filters={activeDateFilters} />
              )}
              {activeView === "softwareInventory" && <SoftwareInventory />}
              {activeView === "surveys" && <SurveyComponent />}
              {activeView === "employeeProductivity" && (
                <EmployeeProductivity filters={activeDateFilters} />
              )}
              {activeView === "overview" && (
                <Stack spacing={3}>
                  <ManagementSectionHeading
                    description="Open a report or manage your services from one place."
                    eyebrow="Quick access"
                    title="Explore Management"
                  />
                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
                    {[
                      { label: "Marketing", detail: "Website, search, and target-industry trends", view: "marketing" },
                      { label: "Software Inventory", detail: "Find and maintain your software services", view: "softwareInventory" },
                    ].map((item) => (
                      <Paper elevation={0} key={item.view} sx={{ ...managementCardSx, p: { xs: 2.5, md: 3 } }}>
                        <Stack alignItems="flex-start" spacing={1.5}>
                          <Typography color="text.primary" component="h3" sx={{ fontSize: "1.125rem", fontWeight: 800 }}>
                            {item.label}
                          </Typography>
                          <Typography color="text.secondary" variant="body2">{item.detail}</Typography>
                          <Button onClick={() => navigateToView(item.view)} sx={managementButtonSx} variant="outlined">
                            Open {item.label}
                          </Button>
                        </Stack>
                      </Paper>
                    ))}
                  </Box>
                  <Paper elevation={0} sx={{ ...managementCardSx, overflow: "hidden" }}>
                    <EmptyState
                      actionLabel="Refresh"
                      description={`${currentView.title} data will appear here after its reporting source is connected.`}
                      icon="database"
                      onAction={() => window.location.reload()}
                      title={`${currentView.title} is not available yet`}
                    />
                  </Paper>
                </Stack>
              )}

              {isVisualRefreshView ? <AiChatBox
                context={analystContext}
                placeholder={`Ask the AI Analyst about ${currentView.title.toLowerCase()}...`}
                section={currentView.title}
              /> : null}

            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
