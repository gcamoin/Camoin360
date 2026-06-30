import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from . import dynamics
from .dynamics import (
    create_pe_client,
    create_pe_client_user,
    get_leadfeeder_visits,
    get_marketing_list_conversion_analysis,
    get_marketing_list_members,
    get_marketing_lists,
    get_pe_clients,
    get_project_creation_metrics,
    normalize_marketing_list_record,
)


class FakeDynamicsResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self._payload


class FakeAsyncClient:
    requested_urls = []
    list_metadata_relationships = []
    account_metadata_relationships = []
    website_visit_metadata_relationships = []
    list_payload = {"value": []}
    member_account_payload = {"value": []}
    conversion_list_payload = {"value": []}
    listmember_payload = {"value": []}
    contact_payload = {"value": []}
    prospect_payload = {"value": []}
    website_visit_payload = {"value": []}
    fail_new_client = False
    fail_account_client_expand = False

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def get(self, url, headers):
        self.requested_urls.append(url)

        if "EntityDefinitions(LogicalName='list')/ManyToOneRelationships" in url:
            return FakeDynamicsResponse({"value": self.list_metadata_relationships})

        if "EntityDefinitions(LogicalName='account')/ManyToOneRelationships" in url:
            return FakeDynamicsResponse({"value": self.account_metadata_relationships})

        if "EntityDefinitions(LogicalName='lfapp_websitevisit')/ManyToOneRelationships" in url:
            return FakeDynamicsResponse({"value": self.website_visit_metadata_relationships})

        if "campaignid($select=name)" in url:
            return FakeDynamicsResponse(
                {},
                status_code=400,
                text='{"error":{"code":"0x80060888","message":"Could not find a property named \'campaignid\' on type \'Microsoft.Dynamics.CRM.list\'."}}',
            )

        if self.fail_new_client and "_createdby_value,new_client" in url:
            return FakeDynamicsResponse(
                {},
                status_code=400,
                text='{"error":{"code":"0x80060888","message":"Could not find a property named \'new_client\' on type \'Microsoft.Dynamics.CRM.list\'."}}',
            )

        if self.fail_account_client_expand and "listaccount_association" in url:
            return FakeDynamicsResponse(
                {},
                status_code=400,
                text='{"error":{"code":"0x80060888","message":"Could not find a property named \'cr73c_lfapp_websitevisit\' on type \'Microsoft.Dynamics.CRM.account\'."}}',
            )

        if "/listmembers?" in url:
            return FakeDynamicsResponse(self.listmember_payload)

        if "/contacts?" in url:
            return FakeDynamicsResponse(self.contact_payload)

        if "/new_prospects?" in url:
            return FakeDynamicsResponse(self.prospect_payload)

        if "listaccount_association" in url:
            return FakeDynamicsResponse(self.member_account_payload)

        if "lfapp_websitevisits" in url:
            return FakeDynamicsResponse(self.website_visit_payload)

        if "/lists?" in url and "$select=listid,listname,createdon,membercount,createdfromcode&" in url:
            return FakeDynamicsResponse(self.conversion_list_payload)

        return FakeDynamicsResponse(self.list_payload)


class PEClientServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_get_pe_clients_filters_client_accounts_and_normalizes_fields(self):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {
            "value": [
                {
                    "accountid": "account-1",
                    "name": "Example Capital",
                    "address1_city": "Albany",
                    "address1_stateorprovince": "NY",
                    "cr73c_softwarecontractexpirationdate": "2027-06-30",
                    "new_account_contact": [{"contactid": "contact-1"}],
                }
            ]
        }
        client = AsyncMock()
        client.get.return_value = response
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        with (
            patch("backend.app.services.dynamics.get_access_token", AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", return_value=client),
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
        ):
            result = await get_pe_clients(100)

        requested_url = client.get.await_args.args[0]
        self.assertIn("$filter=new_client eq true", requested_url)
        self.assertEqual(result[0]["client_name"], "Example Capital")
        self.assertEqual(result[0]["users"], 1)

    async def test_create_pe_client_writes_account_fields_and_client_flag(self):
        response = MagicMock()
        response.status_code = 201
        response.json.return_value = {
            "accountid": "account-1",
            "name": "Example Capital",
            "address1_city": "Albany",
            "address1_stateorprovince": "NY",
            "cr73c_softwarecontractexpirationdate": "2027-06-30",
        }
        client = AsyncMock()
        client.post.return_value = response
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        with (
            patch("backend.app.services.dynamics.get_access_token", AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", return_value=client),
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
        ):
            result = await create_pe_client(
                {
                    "client_name": "Example Capital",
                    "city": "Albany",
                    "state": "NY",
                    "contract_expiration": "2027-06-30",
                }
            )

        request_payload = client.post.await_args.kwargs["json"]
        self.assertTrue(request_payload["new_client"])
        self.assertEqual(request_payload["name"], "Example Capital")
        self.assertEqual(request_payload["cr73c_softwarecontractexpirationdate"], "2027-06-30")
        self.assertEqual(result["account_id"], "account-1")

    async def test_create_pe_client_user_links_contact_to_client_account(self):
        response = MagicMock()
        response.status_code = 201
        response.json.return_value = {
            "contactid": "contact-1",
            "firstname": "Jamie",
            "lastname": "Taylor",
            "emailaddress1": "jamie@example.com",
        }
        client = AsyncMock()
        client.post.return_value = response
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        with (
            patch("backend.app.services.dynamics.get_access_token", AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", return_value=client),
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
        ):
            result = await create_pe_client_user(
                {
                    "account_id": "account-1",
                    "first_name": "Jamie",
                    "last_name": "Taylor",
                    "email": "jamie@example.com",
                    "phone": "555-0100",
                    "username": "",
                    "password": "Temporary-Pass-123",
                }
            )

        request_payload = client.post.await_args.kwargs["json"]
        self.assertEqual(request_payload["new_client@odata.bind"], "/accounts(account-1)")
        self.assertEqual(request_payload["parentcustomerid_account@odata.bind"], "/accounts(account-1)")
        self.assertEqual(request_payload["adx_identity_username"], "jamie@example.com")
        self.assertEqual(request_payload["adx_identity_newpassword"], "Temporary-Pass-123")
        self.assertTrue(request_payload["adx_identity_logonenabled"])
        self.assertNotIn("password", result)
        self.assertEqual(result["contact_id"], "contact-1")


class MarketingListNormalizationTest(unittest.TestCase):
    def test_normalizes_lookup_display_values_and_expanded_campaign_relationship(self):
        record = {
            "listid": "list-1",
            "listname": "Client Audience",
            "_createdby_value@OData.Community.Display.V1.FormattedValue": "Taylor Lee",
            "listaccount_association": [
                {
                    "accountid": "account-1",
                    "cr73c_lfapp_websitevisit": {
                        "new_Client": {
                            "name": "Contoso",
                        },
                    },
                },
            ],
            "campaignid_campaign": {
                "name": "Spring Campaign",
            },
        }

        result = normalize_marketing_list_record(
            record,
            "campaignid_campaign",
            "cr73c_lfapp_websitevisit",
            "new_Client",
        )

        self.assertEqual(result["created_by"], "Taylor Lee")
        self.assertEqual(result["client_name"], "Contoso")
        self.assertEqual(result["campaign"], "Spring Campaign")


class ProjectCreationMetricsTest(unittest.IsolatedAsyncioTestCase):
    async def test_includes_project_and_opportunity_fee_tables(self):
        async def get_response(url, headers):
            response = MagicMock()
            response.status_code = 200
            if "/new_projects?" in url and "new_contractdate" in url:
                response.json.return_value = {
                    "value": [
                        {
                            "new_projectid": "project-1",
                            "new_feeforcamoin": 125000,
                            "new_feeforcamoin@OData.Community.Display.V1.FormattedValue": "$125,000",
                            "new_contractdate": "2026-02-15T00:00:00Z",
                            "new_contractdate@OData.Community.Display.V1.FormattedValue": "2/15/2026",
                        }
                    ]
                }
            elif "/opportunities?" in url:
                response.json.return_value = {
                    "value": [
                        {
                            "opportunityid": "opportunity-1",
                            "name": "Expansion Study",
                            "new_feeforcamoin": 75000,
                            "new_feeforcamoin@OData.Community.Display.V1.FormattedValue": "$75,000",
                            "cr73c_dateproposed": "2026-03-01T00:00:00Z",
                            "cr73c_dateproposed@OData.Community.Display.V1.FormattedValue": "3/1/2026",
                        }
                    ]
                }
            else:
                response.json.return_value = {"value": []}
            return response

        client = AsyncMock()
        client.get.side_effect = get_response
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        dynamics._PROJECT_METRICS_CACHE["data"] = None
        dynamics._PROJECT_METRICS_CACHE["expires_at"] = 0

        with (
            patch("backend.app.services.dynamics.get_access_token", AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", return_value=client),
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
        ):
            result = await get_project_creation_metrics()

        self.assertEqual(result["contracted_projects"][0]["id"], "project-1")
        self.assertEqual(result["contracted_projects"][0]["fee_for_camoin"], 125000)
        self.assertEqual(result["contracted_projects"][0]["date_formatted"], "2/15/2026")
        self.assertEqual(result["proposed_opportunities"][0]["id"], "opportunity-1")
        self.assertEqual(result["proposed_opportunities"][0]["name"], "Expansion Study")
        self.assertEqual(result["proposed_opportunities"][0]["fee_for_camoin_formatted"], "$75,000")

        requested_urls = "\n".join(call.args[0] for call in client.get.await_args_list)
        self.assertIn("$select=new_projectid,new_feeforcamoin,new_contractdate", requested_urls)
        self.assertIn("$select=opportunityid,name,new_feeforcamoin,cr73c_dateproposed", requested_urls)


class MarketingListQueryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeAsyncClient.requested_urls = []
        FakeAsyncClient.list_metadata_relationships = []
        FakeAsyncClient.account_metadata_relationships = []
        FakeAsyncClient.website_visit_metadata_relationships = []
        FakeAsyncClient.list_payload = {"value": []}
        FakeAsyncClient.member_account_payload = {"value": []}
        FakeAsyncClient.conversion_list_payload = {"value": []}
        FakeAsyncClient.listmember_payload = {"value": []}
        FakeAsyncClient.contact_payload = {"value": []}
        FakeAsyncClient.prospect_payload = {"value": []}
        FakeAsyncClient.website_visit_payload = {"value": []}
        FakeAsyncClient.fail_new_client = False
        FakeAsyncClient.fail_account_client_expand = False
        dynamics._MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["loaded"] = False
        dynamics._MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["value"] = None
        dynamics._ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["loaded"] = False
        dynamics._ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["value"] = None
        dynamics._WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["loaded"] = False
        dynamics._WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["value"] = None

    async def test_discovers_campaign_navigation_property_from_metadata(self):
        FakeAsyncClient.list_metadata_relationships = [
            {
                "ReferencingAttribute": "campaignid",
                "ReferencingEntityNavigationPropertyName": "campaignid_campaign",
                "ReferencedEntity": "campaign",
            }
        ]
        FakeAsyncClient.account_metadata_relationships = [
            {
                "ReferencingAttribute": "cr73c_lfapp_websitevisit",
                "ReferencingEntityNavigationPropertyName": "cr73c_lfapp_websitevisit",
                "ReferencedEntity": "lfapp_websitevisit",
                "SchemaName": "cr73c_Account_lfapp_websitevisit_lfapp_websitev",
            }
        ]
        FakeAsyncClient.website_visit_metadata_relationships = [
            {
                "ReferencingAttribute": "new_client",
                "ReferencingEntityNavigationPropertyName": "new_Client",
                "ReferencedEntity": "account",
                "SchemaName": "new_lfapp_websitevisit_Client_Account",
            }
        ]

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            await get_marketing_lists(limit=25)

        self.assertEqual(len(FakeAsyncClient.requested_urls), 4)
        requested_url = FakeAsyncClient.requested_urls[3]
        self.assertNotIn("new_marketing_list_CampaignID", requested_url)
        self.assertNotIn("_new_campaignid_value", requested_url)
        self.assertNotIn("campaignid($select=name)", requested_url)
        self.assertIn("$select=listid,listname,createdon,membercount,createdfromcode,type,_createdby_value,new_client", requested_url)
        self.assertIn("$expand=createdby($select=fullname),campaignid_campaign($select=name)", requested_url)
        self.assertNotIn("listaccount_association", requested_url)

    async def test_retries_without_campaign_when_navigation_property_is_invalid(self):
        FakeAsyncClient.list_metadata_relationships = [
            {
                "ReferencingAttribute": "campaignid",
                "ReferencingEntityNavigationPropertyName": "campaignid",
                "ReferencedEntity": "campaign",
            }
        ]
        FakeAsyncClient.account_metadata_relationships = [
            {
                "ReferencingAttribute": "cr73c_lfapp_websitevisit",
                "ReferencingEntityNavigationPropertyName": "cr73c_lfapp_websitevisit",
                "ReferencedEntity": "lfapp_websitevisit",
                "SchemaName": "cr73c_Account_lfapp_websitevisit_lfapp_websitev",
            }
        ]
        FakeAsyncClient.website_visit_metadata_relationships = [
            {
                "ReferencingAttribute": "new_client",
                "ReferencingEntityNavigationPropertyName": "new_Client",
                "ReferencedEntity": "account",
                "SchemaName": "new_lfapp_websitevisit_Client_Account",
            }
        ]

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            await get_marketing_lists(limit=25)

        self.assertEqual(len(FakeAsyncClient.requested_urls), 5)
        failed_url = FakeAsyncClient.requested_urls[3]
        retried_url = FakeAsyncClient.requested_urls[4]
        self.assertIn("campaignid($select=name)", failed_url)
        self.assertNotIn("campaignid($select=name)", retried_url)
        self.assertIn("new_client", retried_url)
        self.assertNotIn("listaccount_association", retried_url)
        self.assertIn("$expand=createdby($select=fullname)", retried_url)

    async def test_retries_without_new_client_when_client_column_is_invalid(self):
        FakeAsyncClient.fail_new_client = True
        FakeAsyncClient.account_metadata_relationships = [
            {
                "ReferencingAttribute": "cr73c_lfapp_websitevisit",
                "ReferencingEntityNavigationPropertyName": "cr73c_lfapp_websitevisit",
                "ReferencedEntity": "lfapp_websitevisit",
                "SchemaName": "cr73c_Account_lfapp_websitevisit_lfapp_websitev",
            }
        ]
        FakeAsyncClient.website_visit_metadata_relationships = [
            {
                "ReferencingAttribute": "new_client",
                "ReferencingEntityNavigationPropertyName": "new_Client",
                "ReferencedEntity": "account",
                "SchemaName": "new_lfapp_websitevisit_Client_Account",
            }
        ]

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            await get_marketing_lists(limit=25)

        self.assertEqual(len(FakeAsyncClient.requested_urls), 5)
        failed_url = FakeAsyncClient.requested_urls[3]
        retried_url = FakeAsyncClient.requested_urls[4]
        self.assertIn("new_client", failed_url)
        self.assertNotIn("_createdby_value,new_client", retried_url)
        self.assertNotIn("_createdby_value,new_client", retried_url)
        self.assertIn("$expand=createdby($select=fullname)", retried_url)

    async def test_enriches_client_name_from_associated_account_website_visit(self):
        FakeAsyncClient.list_payload = {
            "value": [
                {
                    "listid": "list-1",
                    "listname": "Client Audience",
                    "createdby": {"fullname": "Taylor Lee"},
                }
            ]
        }
        FakeAsyncClient.member_account_payload = {
            "value": [
                {
                    "accountid": "account-1",
                }
            ]
        }
        FakeAsyncClient.website_visit_payload = {
            "value": [
                {
                    "lfapp_websitevisitid": "visit-1",
                    "new_Client": {"name": "Contoso"},
                }
            ]
        }
        FakeAsyncClient.account_metadata_relationships = [
            {
                "ReferencingAttribute": "cr73c_lfapp_websitevisit",
                "ReferencingEntityNavigationPropertyName": "cr73c_lfapp_websitevisit",
                "ReferencedEntity": "lfapp_websitevisit",
                "SchemaName": "cr73c_Account_lfapp_websitevisit_lfapp_websitev",
            }
        ]
        FakeAsyncClient.website_visit_metadata_relationships = [
            {
                "ReferencingAttribute": "new_client",
                "ReferencingEntityNavigationPropertyName": "new_Client",
                "ReferencedEntity": "account",
                "SchemaName": "new_lfapp_websitevisit_Client_Account",
            }
        ]

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            rows = await get_marketing_lists(limit=25)

        self.assertEqual(rows[0]["client_name"], "Contoso")
        account_member_url = next(url for url in FakeAsyncClient.requested_urls if "listaccount_association" in url)
        website_visit_url = next(url for url in FakeAsyncClient.requested_urls if "lfapp_websitevisits" in url)
        self.assertIn("$select=accountid", account_member_url)
        self.assertIn("$expand=new_Client($select=name)", website_visit_url)
        self.assertIn("Microsoft.Dynamics.CRM.In(PropertyName='lfapp_account',PropertyValues=['account-1'])", website_visit_url)
        self.assertIn("_new_client_value%20ne%20null", website_visit_url)


class MarketingListMemberQueryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeAsyncClient.requested_urls = []
        FakeAsyncClient.list_metadata_relationships = []
        FakeAsyncClient.account_metadata_relationships = []
        FakeAsyncClient.website_visit_metadata_relationships = []
        FakeAsyncClient.list_payload = {"value": []}
        FakeAsyncClient.member_account_payload = {"value": []}
        FakeAsyncClient.website_visit_payload = {"value": []}
        FakeAsyncClient.fail_new_client = False
        FakeAsyncClient.fail_account_client_expand = False

    async def test_selects_sector_from_accounts_not_contacts(self):
        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            await get_marketing_list_members("list-1")

        account_url = next(url for url in FakeAsyncClient.requested_urls if "listaccount_association" in url)
        contact_url = next(url for url in FakeAsyncClient.requested_urls if "listcontact_association" in url)

        self.assertIn("new_sector", account_url)
        self.assertNotIn("new_sector", contact_url)


class MarketingListConversionAnalysisTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeAsyncClient.requested_urls = []
        FakeAsyncClient.list_metadata_relationships = []
        FakeAsyncClient.account_metadata_relationships = []
        FakeAsyncClient.website_visit_metadata_relationships = []
        FakeAsyncClient.list_payload = {"value": []}
        FakeAsyncClient.member_account_payload = {"value": []}
        FakeAsyncClient.conversion_list_payload = {"value": []}
        FakeAsyncClient.listmember_payload = {"value": []}
        FakeAsyncClient.contact_payload = {"value": []}
        FakeAsyncClient.prospect_payload = {"value": []}
        FakeAsyncClient.website_visit_payload = {"value": []}
        FakeAsyncClient.fail_new_client = False
        FakeAsyncClient.fail_account_client_expand = False

    async def test_matches_listmember_companies_to_prospect_accounts(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "11111111-1111-1111-1111-111111111111",
                    "listname": "2026 VCEDA PE Campaign",
                    "createdon": "2026-01-15T00:00:00Z",
                    "membercount": 2,
                    "createdfromcode": 1,
                },
                {
                    "listid": "22222222-2222-2222-2222-222222222222",
                    "listname": "2026 PE Demo Follow-Up",
                    "createdon": "2026-01-20T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                }
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "11111111-1111-1111-1111-111111111111",
                    "entitytype": "account",
                    "_entityid_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
                {
                    "_listid_value": "11111111-1111-1111-1111-111111111111",
                    "entitytype": "contact",
                    "_entityid_value": "cccccccc-cccc-cccc-cccc-cccccccccccc",
                },
                {
                    "_listid_value": "22222222-2222-2222-2222-222222222222",
                    "entitytype": "account",
                    "_entityid_value": "dddddddd-dddd-dddd-dddd-dddddddddddd",
                },
            ]
        }
        FakeAsyncClient.contact_payload = {
            "value": [
                {
                    "contactid": "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    "_parentcustomerid_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                }
            ]
        }
        FakeAsyncClient.prospect_payload = {
            "value": [
                {
                    "new_prospectid": "prospect-1",
                    "_new_prospectaccount_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "new_client": "Client One",
                    "createdon": "2026-02-01T00:00:00Z",
                },
                {
                    "new_prospectid": "prospect-2",
                    "_new_prospectaccount_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "new_client": "Client One",
                    "createdon": "2025-02-01T00:00:00Z",
                }
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(limit=25, years=["2026"])

        self.assertEqual(result["years"], ["2026"])
        self.assertEqual(result["company_count"], 2)
        self.assertEqual(result["prospect_count"], 1)
        self.assertEqual(result["list_count"], 1)
        self.assertEqual(result["excluded_list_count"], 1)
        self.assertEqual(result["excluded_company_count"], 1)
        self.assertEqual(result["exclusion_rollups"][0]["code"], "camoin_activity")
        self.assertEqual(result["conversion_rate"], 50)
        self.assertEqual(result["companies_per_prospect"], 2)
        self.assertEqual(result["campaign_type_rollups"][0]["campaign_type"], "ProspectEngage (PE)")
        self.assertEqual(result["client_rollups"][0]["client_name"], "VCEDA")
        self.assertEqual(result["pe_clients"], ["VCEDA"])

        requested_urls = "\n".join(FakeAsyncClient.requested_urls)
        self.assertIn("/listmembers?", requested_urls)
        self.assertIn("/contacts?", requested_urls)
        self.assertIn("/new_prospects?", requested_urls)
        self.assertIn("contains(listname", requested_urls)
        self.assertIn("createdon ge 2026-01-01T00:00:00Z", requested_urls)
        self.assertIn("createdon lt 2027-01-01T00:00:00Z", requested_urls)

    async def test_excludes_lists_with_at_least_1500_companies(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "33333333-3333-3333-3333-333333333333",
                    "listname": "2026 Trade Show",
                    "createdon": "2026-03-15T00:00:00Z",
                    "membercount": 1500,
                    "createdfromcode": 1,
                }
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "33333333-3333-3333-3333-333333333333",
                    "entitytype": "account",
                    "_entityid_value": f"{index:012d}-3333-3333-3333-333333333333",
                }
                for index in range(1500)
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(limit=25, years=["2026"])

        self.assertEqual(result["list_count"], 0)
        self.assertEqual(result["company_count"], 0)
        self.assertEqual(result["excluded_list_count"], 1)
        self.assertEqual(result["excluded_company_count"], 1500)
        self.assertEqual(result["exclusion_rollups"][0]["code"], "large_pool")

    async def test_trade_show_takes_priority_over_pe_client_bucket(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "44444444-4444-4444-4444-444444444444",
                    "listname": "2026 VCEDA PE Targets",
                    "createdon": "2026-01-01T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
                {
                    "listid": "55555555-5555-5555-5555-555555555555",
                    "listname": "2026 VCEDA Hannover Messe",
                    "createdon": "2026-02-01T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "44444444-4444-4444-4444-444444444444",
                    "entitytype": "account",
                    "_entityid_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
                {
                    "_listid_value": "55555555-5555-5555-5555-555555555555",
                    "entitytype": "account",
                    "_entityid_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                },
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(limit=25, years=["2026"])

        buckets_by_name = {
            row["marketing_list_name"]: row["campaign_type"]
            for row in result["lists"]
        }
        self.assertEqual(buckets_by_name["2026 VCEDA PE Targets"], "ProspectEngage (PE)")
        self.assertEqual(buckets_by_name["2026 VCEDA Hannover Messe"], "Trade Show")
        self.assertEqual(result["pe_clients"], ["VCEDA"])

    async def test_bucket_rollups_dedupe_companies_within_bucket(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "66666666-6666-6666-6666-666666666666",
                    "listname": "2026 VCEDA PE Targets A",
                    "createdon": "2026-01-01T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
                {
                    "listid": "77777777-7777-7777-7777-777777777777",
                    "listname": "2026 VCEDA PE Targets B",
                    "createdon": "2026-01-02T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "66666666-6666-6666-6666-666666666666",
                    "entitytype": "account",
                    "_entityid_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
                {
                    "_listid_value": "77777777-7777-7777-7777-777777777777",
                    "entitytype": "account",
                    "_entityid_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
            ]
        }
        FakeAsyncClient.prospect_payload = {
            "value": [
                {
                    "new_prospectid": "prospect-1",
                    "_new_prospectaccount_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "new_client": "VCEDA",
                    "createdon": "2026-02-01T00:00:00Z",
                }
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(limit=25, years=["2026"])

        pe_rollup = result["campaign_type_rollups"][0]
        self.assertEqual(pe_rollup["campaign_type"], "ProspectEngage (PE)")
        self.assertEqual(pe_rollup["list_count"], 2)
        self.assertEqual(pe_rollup["company_count"], 1)
        self.assertEqual(pe_rollup["prospect_count"], 1)
        self.assertEqual(pe_rollup["conversion_rate"], 100)
        self.assertEqual(pe_rollup["companies_per_prospect"], 1)

    async def test_year_bucket_rollups_include_combined_non_pe_lead_gen(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "88888888-8888-8888-8888-888888888888",
                    "listname": "2026 Hannover Messe",
                    "createdon": "2026-01-01T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
                {
                    "listid": "99999999-9999-9999-9999-999999999999",
                    "listname": "2026 County Outreach",
                    "createdon": "2026-01-02T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "88888888-8888-8888-8888-888888888888",
                    "entitytype": "account",
                    "_entityid_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
                {
                    "_listid_value": "99999999-9999-9999-9999-999999999999",
                    "entitytype": "account",
                    "_entityid_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                },
            ]
        }
        FakeAsyncClient.prospect_payload = {
            "value": [
                {
                    "new_prospectid": "prospect-1",
                    "_new_prospectaccount_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "new_client": "Client One",
                    "createdon": "2026-02-01T00:00:00Z",
                }
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(limit=25, years=["2026"])

        year_rollups = {
            row["campaign_type"]: row
            for row in result["year_bucket_rollups"]
        }
        self.assertEqual(year_rollups["Trade Show"]["company_count"], 1)
        self.assertEqual(year_rollups["Trade Show"]["prospect_count"], 1)
        self.assertEqual(year_rollups["Marketing Mission / Other"]["company_count"], 1)
        self.assertEqual(year_rollups["Marketing Mission / Other"]["prospect_count"], 0)
        self.assertEqual(year_rollups["ALL OTHER LEAD GEN (TS+Missions)"]["company_count"], 2)
        self.assertEqual(year_rollups["ALL OTHER LEAD GEN (TS+Missions)"]["prospect_count"], 1)
        self.assertEqual(year_rollups["ALL OTHER LEAD GEN (TS+Missions)"]["conversion_rate"], 50)

    async def test_any_time_mode_counts_lagged_conversion(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "aaaaaaaa-1111-1111-1111-111111111111",
                    "listname": "2025 County Outreach",
                    "createdon": "2025-12-15T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                }
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "aaaaaaaa-1111-1111-1111-111111111111",
                    "entitytype": "account",
                    "_entityid_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                }
            ]
        }
        FakeAsyncClient.prospect_payload = {
            "value": [
                {
                    "new_prospectid": "prospect-1",
                    "_new_prospectaccount_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "new_client": "Client One",
                    "createdon": "2026-01-15T00:00:00Z",
                }
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(limit=25, years=["2025"], match_mode="any_time")

        self.assertEqual(result["match_mode"], "any_time")
        self.assertEqual(result["prospect_count"], 1)
        self.assertEqual(result["conversion_rate"], 100)
        requested_urls = "\n".join(FakeAsyncClient.requested_urls)
        self.assertNotIn("createdon ge", requested_urls)

    async def test_on_after_list_creation_mode_filters_pre_list_prospects(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "abababab-1111-1111-1111-111111111111",
                    "listname": "2026 County Outreach",
                    "createdon": "2026-03-01T00:00:00Z",
                    "membercount": 2,
                    "createdfromcode": 1,
                }
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "abababab-1111-1111-1111-111111111111",
                    "entitytype": "account",
                    "_entityid_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
                {
                    "_listid_value": "abababab-1111-1111-1111-111111111111",
                    "entitytype": "account",
                    "_entityid_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                },
            ]
        }
        FakeAsyncClient.prospect_payload = {
            "value": [
                {
                    "new_prospectid": "prospect-before",
                    "_new_prospectaccount_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "new_client": "Client One",
                    "createdon": "2026-02-01T00:00:00Z",
                },
                {
                    "new_prospectid": "prospect-after",
                    "_new_prospectaccount_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "new_client": "Client One",
                    "createdon": "2026-03-02T00:00:00Z",
                },
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(
                limit=25,
                years=["2026"],
                match_mode="on_after_list_creation",
            )

        self.assertEqual(result["match_mode"], "on_after_list_creation")
        self.assertEqual(result["company_count"], 2)
        self.assertEqual(result["prospect_count"], 1)
        self.assertEqual(result["companies_per_prospect"], 2)

    async def test_admin_pe_client_and_bucket_overrides(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "bbbbbbbb-1111-1111-1111-111111111111",
                    "listname": "2026 County Outreach",
                    "createdon": "2026-01-15T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                }
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "bbbbbbbb-1111-1111-1111-111111111111",
                    "entitytype": "account",
                    "_entityid_value": "cccccccc-cccc-cccc-cccc-cccccccccccc",
                }
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(
                limit=25,
                years=["2026"],
                pe_clients=["County Outreach"],
                bucket_overrides=["bbbbbbbb-1111-1111-1111-111111111111=Trade Show"],
            )

        self.assertEqual(result["pe_clients"], ["County Outreach"])
        self.assertEqual(result["lists"][0]["campaign_type"], "Trade Show")
        self.assertEqual(result["lists"][0]["bucket_override"], "Trade Show")

    async def test_custom_trade_show_terms_exclusion_keywords_and_threshold(self):
        FakeAsyncClient.conversion_list_payload = {
            "value": [
                {
                    "listid": "cdcdcdcd-1111-1111-1111-111111111111",
                    "listname": "2026 Custom Expo",
                    "createdon": "2026-01-01T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
                {
                    "listid": "dededede-1111-1111-1111-111111111111",
                    "listname": "2026 Holdout",
                    "createdon": "2026-01-02T00:00:00Z",
                    "membercount": 1,
                    "createdfromcode": 1,
                },
            ]
        }
        FakeAsyncClient.listmember_payload = {
            "value": [
                {
                    "_listid_value": "cdcdcdcd-1111-1111-1111-111111111111",
                    "entitytype": "account",
                    "_entityid_value": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
                {
                    "_listid_value": "dededede-1111-1111-1111-111111111111",
                    "entitytype": "account",
                    "_entityid_value": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                },
            ]
        }

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            result = await get_marketing_list_conversion_analysis(
                limit=25,
                years=["2026"],
                trade_show_terms=["custom expo"],
                exclusion_keywords=["holdout"],
                size_threshold=10,
            )

        self.assertEqual(result["lists"][0]["campaign_type"], "Trade Show")
        self.assertEqual(result["lists"][0]["trade_show_name"], "Custom Expo")
        self.assertEqual(result["excluded_list_count"], 1)
        self.assertEqual(result["exclusion_rollups"][0]["code"], "admin_keyword")
        self.assertEqual(result["config"]["large_list_company_threshold"], 10)


class LeadfeederVisitQueryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeAsyncClient.requested_urls = []
        FakeAsyncClient.list_metadata_relationships = []
        FakeAsyncClient.account_metadata_relationships = []
        FakeAsyncClient.website_visit_metadata_relationships = []
        FakeAsyncClient.list_payload = {"value": []}
        FakeAsyncClient.member_account_payload = {"value": []}
        FakeAsyncClient.website_visit_payload = {"value": []}
        FakeAsyncClient.fail_new_client = False
        FakeAsyncClient.fail_account_client_expand = False
        dynamics._WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["loaded"] = False
        dynamics._WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["value"] = None
        dynamics._WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["loaded"] = False
        dynamics._WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["value"] = None

    async def test_loads_recent_leadfeeder_visits_with_client_and_account_names(self):
        FakeAsyncClient.website_visit_payload = {
            "value": [
                {
                    "lfapp_websitevisitid": "visit-1",
                    "createdon": "2026-06-23T15:30:00Z",
                    "_lfapp_account_value": "account-1",
                    "_lfapp_account_value@OData.Community.Display.V1.FormattedValue": "Acme Corp",
                    "_new_client_value": "client-1",
                    "_new_client_value@OData.Community.Display.V1.FormattedValue": "Acme Client",
                    "new_Client": {"name": "Acme Client"},
                    "lfapp_Account": {
                        "name": "Acme Corp",
                        "address1_city": "Austin",
                        "telephone1": "555-123-4567",
                        "emailaddress1": "info@example.com",
                    },
                }
            ]
        }
        FakeAsyncClient.website_visit_metadata_relationships = [
            {
                "ReferencingAttribute": "new_client",
                "ReferencingEntityNavigationPropertyName": "new_Client",
                "ReferencedEntity": "account",
                "SchemaName": "new_lfapp_websitevisit_Client_Account",
            },
            {
                "ReferencingAttribute": "lfapp_account",
                "ReferencingEntityNavigationPropertyName": "lfapp_Account",
                "ReferencedEntity": "account",
                "SchemaName": "lfapp_websitevisit_Account_Account",
            }
        ]

        with (
            patch("backend.app.services.dynamics.API_URL", "https://example.crm/api/data/v9.2"),
            patch("backend.app.services.dynamics.get_access_token", new=AsyncMock(return_value="token")),
            patch("backend.app.services.dynamics.httpx.AsyncClient", new=FakeAsyncClient),
        ):
            rows = await get_leadfeeder_visits(limit=25)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["visit_id"], "visit-1")
        self.assertEqual(rows[0]["account_name"], "Acme Corp")
        self.assertEqual(rows[0]["client_name"], "Acme Client")
        self.assertEqual(rows[0]["city"], "Austin")
        self.assertEqual(rows[0]["phone"], "555-123-4567")
        self.assertEqual(rows[0]["email"], "info@example.com")
        requested_url = next(url for url in FakeAsyncClient.requested_urls if "lfapp_websitevisits" in url)
        self.assertIn("$select=lfapp_websitevisitid,createdon,_lfapp_account_value,_new_client_value", requested_url)
        self.assertIn(
            "$expand=new_Client($select=name),lfapp_Account($select=name,websiteurl,address1_country,address1_stateorprovince,address1_city,new_sector,telephone1,emailaddress1)",
            requested_url,
        )
        self.assertIn("$orderby=createdon desc", requested_url)


if __name__ == "__main__":
    unittest.main()
