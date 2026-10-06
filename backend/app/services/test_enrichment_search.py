import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import unquote

import httpx
from backend.app.services import dynamics

BASE = "https://crm.example/api/data/v9.2"


class EnrichmentSearchTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.client = AsyncMock()
        self.client.__aenter__.return_value = self.client
        for patcher in (patch.object(dynamics, "API_URL", BASE),
                        patch.object(dynamics, "get_access_token", new=AsyncMock(return_value="SECRET")),
                        patch.object(dynamics.httpx, "AsyncClient", return_value=self.client)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def tearDown(self):
        self.client.post.assert_not_awaited()
        self.client.patch.assert_not_awaited()
        self.client.delete.assert_not_awaited()

    @staticmethod
    def account(**kwargs):
        return {"accountid": "a", "name": "Acme", "websiteurl": "https://acme.example", "telephone1": "555",
                "description": "Description", "numberofemployees": 0, "address1_city": "Boston",
                "address1_stateorprovince": "MA", "address1_country": "United States",
                "address1_postalcode": "02141", "cr73c_naicscode": "051111", **kwargs}

    async def test_canonical_fields_text_and_zero_are_preserved_without_legacy_aliases(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [self.account(new_employees=150, new_naicstext="Legacy NAICS")]})
        result = await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, search="Acme")
        row = result["data"][0]
        self.assertEqual(row["numberofemployees"], 0)
        self.assertEqual(row["address1_postalcode"], "02141")
        self.assertEqual(row["cr73c_naicscode"], "051111")
        self.assertEqual(row["missing_field_keys"], [])
        self.assertEqual(row["data_quality_score"], 100)
        self.assertNotIn("new_employees", row)
        self.assertNotIn("new_naicstext", row)
        url = unquote(self.client.get.await_args.args[0])
        self.assertIn("contains(name,'Acme')", url)
        self.assertIn("numberofemployees", url)
        self.assertIn("address1_postalcode", url)
        self.assertIn("cr73c_naicscode", url)
        self.assertNotIn("new_employees", url)
        self.assertNotIn("new_naicstext", url)
        self.assertIn("$orderby=name asc,accountid asc", url)

    async def test_canonical_missing_filters_are_applied_server_side(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [self.account(numberofemployees=None)]})
        result = await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, missing_field="numberofemployees")
        self.assertEqual(result["data"][0]["missing_field_keys"], ["numberofemployees"])
        self.assertEqual(result["data"][0]["data_quality_score"], 80)
        url = unquote(self.client.get.await_args.args[0])
        self.assertIn("numberofemployees eq null", url)
        self.assertNotIn("numberofemployees eq ''", url)
        for field in ("address1_postalcode", "cr73c_naicscode"):
            self.client.get.return_value = httpx.Response(200, json={"value": [self.account(**{field: None})]})
            await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, missing_field=field)
            self.assertIn(f"{field} eq null", unquote(self.client.get.await_args.args[0]))

    async def test_all_missing_filter_excludes_legacy_fields(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [self.account(cr73c_naicscode=None)]})
        result = await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, needs_attention=True, country="United States", states=["MA"], cities=["Boston"], sector="Services")
        self.assertEqual(result["data"][0]["missing_field_keys"], ["cr73c_naicscode"])
        url = unquote(self.client.get.await_args.args[0])
        for field in dynamics.MANUAL_ENRICHMENT_FIELDS:
            self.assertIn(f"{field} eq null", url)
        self.assertNotIn("new_datasource eq null", url)
        self.assertIn("new_sector eq 'Services'", url)
        self.assertIn("address1_city eq 'Boston'", url)

    async def test_multiple_missing_fields_match_all_selected_fields_only(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [
            self.account(accountid="both", websiteurl=None, telephone1=""),
            self.account(accountid="website", websiteurl=None),
            self.account(accountid="phone", telephone1=""),
            self.account(accountid="other", cr73c_naicscode=None),
            self.account(accountid="complete"),
        ]})
        result = await dynamics.search_accounts_data_quality_from_dynamics(
            enrichment_fields=True, missing_fields=["websiteurl", "telephone1"], country="United States")
        self.assertEqual([row["accountid"] for row in result["data"]], ["both"])
        url = unquote(self.client.get.await_args.args[0])
        self.assertIn("((websiteurl eq null or websiteurl eq '') and (telephone1 eq null or telephone1 eq ''))", url)
        self.assertNotIn("cr73c_naicscode eq null", url)
        self.assertIn("address1_country eq 'United States'", url)

    async def test_missing_fields_keep_zero_employees_populated(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [
            self.account(accountid="zero", numberofemployees=0),
            self.account(accountid="missing", numberofemployees=None),
        ]})
        result = await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, missing_fields=["numberofemployees"])
        self.assertEqual([row["accountid"] for row in result["data"]], ["missing"])
        self.assertNotIn("numberofemployees eq ''", unquote(self.client.get.await_args.args[0]))

    async def test_unknown_missing_fields_rejected_before_dynamics_call(self):
        with self.assertRaisesRegex(ValueError, "Unsupported missing-information"):
            await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, missing_fields=["new_employees"])
        self.client.get.assert_not_awaited()

    async def test_pagination_reads_only_needed_pages(self):
        self.client.get.side_effect = [httpx.Response(200, json={"value": [self.account()], "@odata.nextLink": BASE + "/accounts?$skiptoken=opaque"}),
                                      httpx.Response(200, json={"value": [self.account(accountid="b")]})]
        result = await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, page=1, page_size=1)
        self.assertEqual(result["data"][0]["accountid"], "b")
        self.assertFalse(result["has_more"])
        self.assertEqual(self.client.get.await_count, 2)

    async def test_more_data_does_not_trigger_an_extra_page_read(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [self.account()], "@odata.nextLink": BASE + "/accounts?$skiptoken=opaque"})
        result = await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, page_size=1)
        self.assertTrue(result["has_more"])
        self.client.get.assert_awaited_once()

    async def test_request_budget_and_page_bound_prevent_population_download(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [], "@odata.nextLink": BASE + "/accounts?$skiptoken=opaque"})
        with self.assertRaisesRegex(ValueError, "request limit"):
            await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True)
        self.assertEqual(self.client.get.await_count, 20)
        self.client.get.reset_mock()
        with self.assertRaisesRegex(ValueError, "page limit"):
            await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True, page=200)
        self.client.get.assert_not_awaited()

    async def test_external_next_link_cannot_receive_the_dynamics_token(self):
        self.client.get.return_value = httpx.Response(200, json={"value": [], "@odata.nextLink": "https://untrusted.example/accounts"})
        with self.assertRaisesRegex(ValueError, "Invalid Dynamics search continuation"):
            await dynamics.search_accounts_data_quality_from_dynamics(enrichment_fields=True)
        self.client.get.assert_awaited_once()
