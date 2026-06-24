import unittest
from unittest.mock import AsyncMock, patch

from . import dynamics
from .dynamics import get_leadfeeder_visits, get_marketing_list_members, get_marketing_lists, normalize_marketing_list_record


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

        if "listaccount_association" in url:
            return FakeDynamicsResponse(self.member_account_payload)

        if "lfapp_websitevisits" in url:
            return FakeDynamicsResponse(self.website_visit_payload)

        return FakeDynamicsResponse(self.list_payload)


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


class MarketingListQueryTest(unittest.IsolatedAsyncioTestCase):
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
