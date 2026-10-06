import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import EnrichmentWorkspace from "./EnrichmentWorkspace";
import { handleUnauthorized } from "../auth";
import { getCached, invalidateApiCache } from "../apiClient";
window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("axios");
jest.mock("../apiClient", () => ({ getCached: jest.fn(), invalidateApiCache: jest.fn() }));
jest.mock("../auth", () => ({ API_BASE_URL: "http://localhost", getAuthHeaders: () => ({ Authorization: "Bearer test" }), handleUnauthorized: jest.fn(() => false) }));
const account = (id = "a", options = {}) => ({ accountid: id, name: `Account ${id}`, address1_city: "Boston", address1_stateorprovince: "MA", address1_country: "United States", websiteurl: "https://acme.example", telephone1: "555", description: "Description", numberofemployees: 0, cr73c_naicscode: null, address1_postalcode: null, data_quality_score: 100, ...options });
let root, container;
beforeEach(() => {
  jest.clearAllMocks();
  handleUnauthorized.mockReturnValue(false);
  getCached.mockReset().mockResolvedValue({ data: { data: [account()], has_more: false } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (props = {}) => act(async () => root.render(<EnrichmentWorkspace {...props} />));
const button = (text) => Array.from(document.querySelectorAll('button')).find((node) => node.textContent === text);
const click = async (text) => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()); };
const check = async (label) => { const node = container.querySelector(`input[aria-label="${label}"]`); expect(node).toBeTruthy(); await act(async () => node.click()); };
const input = async (label, value) => {
  const node = Array.from(container.querySelectorAll('input')).find((el) => el.id && container.querySelector(`label[for="${el.id}"]`)?.textContent === label);
  expect(node).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
};
const chooseCountry = async (value) => {
  const select = container.querySelector('select');
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const chooseState = async (value) => {
  const select = container.querySelectorAll('select')[1];
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const chooseField = async (label) => {
  await act(async () => container.querySelector('[aria-labelledby="manual-fields-label"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  const node = Array.from(document.querySelectorAll('[role="option"]')).find((el) => el.textContent === label);
  expect(node).toBeTruthy(); await act(async () => node.click());
  await act(async () => document.querySelector('.MuiBackdrop-root').click());
};
it('shows the Account workspace without credit cards or automatic data fetching', async () => {
  await render();
  expect(container.querySelectorAll('section[aria-label="Seamless Credits"]')).toHaveLength(0);
  expect(container.textContent).not.toContain('Weekly allowance');
  expect(container.querySelector('section[aria-label="Automatic enrichment"]')).toBeNull();
  expect(container.textContent).not.toContain('New Dynamics Accounts are automatically checked for missing key information.');
  expect(container.textContent).not.toContain('View recent outcomes');
  expect(container.textContent).toContain('Search Dynamics to find Accounts that need enrichment.');
  expect(getCached).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Selected Account actions"]')).toBeNull();
  for (const text of ['Active', 'Accounts Updated', 'Data Quality', 'Alert Center', 'Trend Tracking', 'CSV', 'Preview Enrichment', 'Run Enrichment']) expect(container.textContent).not.toContain(text);
});
it('uses explicit bounded search, canonical missing fields, combined location and details', async () => {
  await render(); await input('Search Accounts', 'Acme'); await chooseCountry('United States'); await click('Search Dynamics');
  expect(getCached.mock.calls[0][1]).toEqual(expect.objectContaining({ headers: { Authorization: 'Bearer test' }, params: expect.objectContaining({ enrichment_fields: true, search: 'Acme', country: 'United States', page: 0, page_size: 25, needs_attention: true }) }));
  expect(Array.from(container.querySelectorAll('thead th')).map((node) => node.textContent)).toEqual(['', 'Account', 'Location', 'Missing Information', 'Completeness', 'Details']);
  expect(container.textContent).toContain('Boston, MA, United States'); expect(container.textContent).toContain('Postal Code, NAICS'); expect(container.textContent).toContain('100%');
  expect(container.textContent).not.toContain('new_employees'); await click('Details');
  expect(document.body.textContent).toContain('Employees'); expect(document.body.textContent).toContain('Postal Code'); expect(document.body.textContent).toContain('NAICS');
});
it('does not use legacy employee/NAICS values to hide missing canonical information', async () => {
  getCached.mockResolvedValue({ data: { data: [account('a', { numberofemployees: null, new_employees: 50, new_naicstext: '541511' })] } });
  await render(); await click('Search Dynamics'); expect(container.textContent).toContain('Employees, Postal Code, NAICS');
});
it('requires fields after row selection and presents canonical options without Data Source', async () => {
  await render(); await click('Search Dynamics'); await check('Select Account a');
  expect(button('Enrich Selected').disabled).toBe(true); expect(container.textContent).toContain('Choose at least one field');
  await act(async () => container.querySelector('[aria-labelledby="manual-fields-label"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(Array.from(document.querySelectorAll('[role="option"][data-value]')).map((el) => el.getAttribute('data-value'))).toEqual(['websiteurl', 'telephone1', 'description', 'numberofemployees', 'address1_city', 'address1_stateorprovince', 'address1_country', 'address1_postalcode', 'cr73c_naicscode']);
  expect(document.querySelector('[role="listbox"]').textContent).not.toContain('Data Source');
});
it('confirms selection, sends canonical fields and reports partial failures individually', async () => {
  axios.post.mockResolvedValue({ data: { processed: 3, updated: 1, results: [
    { account_id: 'a', account_name: 'Updated Account', status: 'updated', fields_updated: ['cr73c_naicscode'] },
    { account_id: 'b', account_name: 'Failed Account', status: 'failed', fields_updated: [], completion_uncertain: true, reason: 'Update unconfirmed' },
    { account_id: 'c', account_name: 'Unmatched Account', status: 'no_match', fields_updated: [], reason: 'No usable match' },
  ] } });
  await render(); await click('Search Dynamics'); await check('Select Account a'); await chooseField('NAICS'); await click('Enrich Selected');
  expect(document.body.textContent).toContain('Confirm enrichment'); expect(document.body.textContent).toContain('Only blank Dynamics values will be filled. Existing values will not be overwritten.');
  await click('Run Enrichment'); expect(axios.post).toHaveBeenCalledWith('http://localhost/accounts/enrichment-run', { account_ids: ['a'], fields_to_update: ['cr73c_naicscode'] }, expect.objectContaining({ headers: { Authorization: 'Bearer test' } }));
  expect(container.textContent).toContain('3 Accounts processed · 1 updated · 1 no usable match · 1 failed');
  expect(container.textContent).toContain('Failed — update unconfirmed'); expect(container.textContent).toContain('Updated Account');
  expect(invalidateApiCache).toHaveBeenCalledWith('http://localhost/accounts/data-quality/search');
  expect(container.querySelector('[aria-label="Selected Account actions"]')).toBeNull();
});
it('resets selection across bounded pagination and resets the page on a new search', async () => {
  getCached.mockImplementation((url, options) => Promise.resolve({ data: { data: [account(options.params.page ? 'b' : 'a')], has_more: options.params.page === 0 } }));
  await render(); await click('Search Dynamics'); await check('Select Accounts on this page'); await click('Next');
  expect(container.textContent).toContain('Account b'); expect(container.querySelector('[aria-label="Selected Account actions"]')).toBeNull();
  expect(getCached.mock.calls[1][1].params).toEqual(expect.objectContaining({ page: 1, page_size: 25 }));
  await input('Search Accounts', 'New search'); await click('Search Dynamics'); expect(getCached.mock.calls[2][1].params.page).toBe(0);
});
it('shows loading, sanitized retryable search errors and empty results', async () => {
  let reject; getCached.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await render(); await click('Search Dynamics'); expect(container.querySelector('[aria-label="Loading Account"]')).toBeTruthy();
  await act(async () => reject(new Error('SECRET provider payload'))); expect(container.textContent).toContain('Unable to search Accounts.'); expect(container.textContent).not.toContain('SECRET');
  getCached.mockResolvedValue({ data: { data: [] } }); await click('Retry'); expect(container.textContent).toContain('No Accounts matched your search.'); expect(getCached.mock.calls[1][1].force).toBe(true);
});
it('handles manual API failure without treating it as successful enrichment', async () => {
  axios.post.mockRejectedValue(new Error('SECRET')); await render(); await click('Search Dynamics'); await check('Select Account a'); await chooseField('Phone'); await click('Enrich Selected'); await click('Run Enrichment');
  expect(document.body.textContent).toContain('Unable to complete enrichment.'); expect(document.body.textContent).not.toContain('SECRET'); expect(container.textContent).not.toContain('Enrichment complete');
});
it('supports compact location/sector filters', async () => {
  await render(); await chooseCountry('United States');
  await chooseState('MA'); await input('City', 'Boston'); await input('Sector', 'Technology'); await click('Search Dynamics');
  expect(getCached.mock.calls[0][1].params).toEqual(expect.objectContaining({ states: 'MA', cities: 'Boston', sector: 'Technology' }));
});

it('sends the chosen canonical Missing Information filter without a broad eligibility query', async () => {
  await render();
  await act(async () => container.querySelector('[role="combobox"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((node) => node.textContent === 'NAICS');
  await act(async () => option.click());
  await act(async () => document.querySelector('.MuiBackdrop-root').click()); await click('Search Dynamics');
  expect(getCached.mock.calls[0][1].params).toEqual(expect.objectContaining({ missing_fields: 'cr73c_naicscode', needs_attention: false, enrichment_fields: true }));
  expect(axios.post).not.toHaveBeenCalled();
});

it('enables State / Province only for United States or Canada and clears it on country changes', async () => {
  await render();
  const stateInput = () => container.querySelectorAll('select')[1];
  expect(stateInput().disabled).toBe(true);
  expect(container.querySelector('select').textContent).toContain('All countries');
  expect(getCached).not.toHaveBeenCalled();
  await chooseCountry('United States'); expect(stateInput().disabled).toBe(false);
  expect(stateInput().textContent).toContain('Massachusetts'); expect(stateInput().textContent).not.toContain('Ontario');
  expect(stateInput().options).toHaveLength(52);
  await chooseState('MA'); await click('Search Dynamics');
  expect(getCached.mock.calls[0][1].params).toEqual(expect.objectContaining({ country: 'United States', states: 'MA' }));
  await chooseCountry('Canada'); expect(stateInput().disabled).toBe(false); expect(stateInput().value).toBe('');
  expect(stateInput().textContent).toContain('Ontario'); expect(stateInput().textContent).not.toContain('Massachusetts');
  expect(stateInput().options).toHaveLength(14);
  await chooseState('ON'); await click('Search Dynamics');
  expect(getCached.mock.calls[1][1].params).toEqual(expect.objectContaining({ country: 'Canada', states: 'ON' }));
  await chooseCountry('France'); expect(stateInput().disabled).toBe(true); expect(stateInput().value).toBe('');
  await click('Search Dynamics'); expect(getCached.mock.calls[2][1].params).toEqual(expect.objectContaining({ country: 'France', states: '' }));
  await chooseCountry(''); expect(stateInput().disabled).toBe(true);
});

it('delegates a rejected session to authentication without showing a search failure', async () => {
  const unauthorized = { response: { status: 401, data: { detail: 'Invalid token' } } };
  handleUnauthorized.mockReturnValue(true);
  getCached.mockRejectedValue(unauthorized);
  await render(); await click('Search Dynamics');
  expect(handleUnauthorized).toHaveBeenCalledWith(unauthorized);
  expect(container.textContent).not.toContain('Unable to search Accounts.');
});

it('searches for all selected missing fields and resets pagination', async () => {
  await render(); await click('Search Dynamics');
  await act(async () => container.querySelector('[role="combobox"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  for (const label of ['Website', 'Phone']) {
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((node) => node.textContent === label);
    await act(async () => option.click());
  }
  await act(async () => document.querySelector('.MuiBackdrop-root').click());
  await click('Search Dynamics');
  expect(getCached.mock.calls[1][1].params).toEqual(expect.objectContaining({ missing_fields: 'websiteurl|telephone1', needs_attention: false, page: 0 }));
  expect(container.textContent).toContain('Missing all selected fields');
});
