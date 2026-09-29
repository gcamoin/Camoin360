import unittest
from unittest.mock import AsyncMock, patch

from .software_inventory import FIELDS, list_dynamics_services


class SoftwareInventoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_metadata_lookup_labels_and_pagination(self):
        lookups = {"vendor", "current_service_term", "primary_vendor_contact", "primary_contact"}
        attributes = [{"LogicalName": value.lower(), "SchemaName": value,
                       "AttributeType": "Lookup" if key in lookups else "String"}
                      for key, value in FIELDS.items()]
        payloads = [
            {"EntitySetName": "cr73c_services", "PrimaryIdAttribute": "cr73c_serviceid", "Attributes": attributes},
            {"value": [{"cr73c_serviceid": "first", "cr73c_service": "Render",
                        "_cr73c_vendor_value": "vendor-id",
                        "_cr73c_vendor_value@OData.Community.Display.V1.FormattedValue": "Render Services",
                        "cr73c_servicestatus": 1,
                        "cr73c_servicestatus@OData.Community.Display.V1.FormattedValue": "Current",
                        "cr73c_servicedescription": "Hosting",
                        "cr73c_subscribedsince": "2026-01-01T00:00:00Z"}],
             "@odata.nextLink": "https://example.test/next"},
            {"value": [{"cr73c_serviceid": "second", "cr73c_service": "Claude"}]},
        ]
        from unittest.mock import Mock
        responses = [Mock(json=Mock(return_value=payload)) for payload in payloads]
        client = AsyncMock()
        client.get.side_effect = responses
        with patch("backend.app.services.software_inventory.API_URL", "https://example.test/api"), \
             patch("backend.app.services.software_inventory.get_access_token", AsyncMock(return_value="token")), \
             patch("backend.app.services.software_inventory.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            rows = await list_dynamics_services()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["vendor"], "Render Services")
        self.assertEqual(rows[0]["status"], "Current")
        self.assertEqual(rows[0]["description"], "Hosting")
        self.assertEqual(rows[0]["subscribed_since"], "2026-01-01T00:00:00Z")
        self.assertEqual(rows[1]["primary_contact"], "")
        params = client.get.call_args_list[1].kwargs["params"]
        self.assertIn("_cr73c_vendor_value", params["$select"])
        self.assertIn("cr73c_service", params["$select"])
        self.assertEqual(params["$filter"], "statecode eq 0")

    def editor_fields(self):
        fields = {key: {"logical_name": name.lower(), "type": "String", "create": True,
                        "update": True, "required": key == "name"} for key, name in FIELDS.items()}
        fields["vendor"].update(type="Lookup", navigation="cr73c_Vendor", EntitySetName="accounts")
        fields["status"].update(type="Picklist", options=[{"value": 0, "label": "Current"}])
        fields["subscribed_since"]["type"] = "DateTime"
        return fields

    def test_write_payload_uses_choice_codes_and_lookup_bindings(self):
        from .software_inventory import build_write_payload
        payload = build_write_payload({"name": "Test", "vendor": "11111111-1111-1111-1111-111111111111",
            "status": 0, "subscribed_since": "2026-01-01"}, self.editor_fields(), True)
        self.assertEqual(payload["cr73c_Vendor@odata.bind"], "/accounts(11111111-1111-1111-1111-111111111111)")
        self.assertEqual(payload["cr73c_servicestatus"], 0)
        self.assertEqual(payload["cr73c_subscribedsince"], "2026-01-01T00:00:00Z")
        self.assertEqual(build_write_payload({"vendor": None}, self.editor_fields(), False), {"cr73c_Vendor": None})
        self.assertEqual(build_write_payload({"description": "Updated"}, self.editor_fields(), False), {"cr73c_servicedescription": "Updated"})

    def test_invalid_inputs_are_rejected(self):
        from .software_inventory import build_write_payload
        for values, creating in [({"name": ""}, True), ({"status": "Current"}, False),
                                 ({"status": 5}, False), ({"vendor": "bad-id"}, False),
                                 ({"subscribed_since": "bad-date"}, False), ({"arbitrary": "field"}, False)]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                build_write_payload(values, self.editor_fields(), creating)

    async def test_create_update_delete_requests_and_concurrency(self):
        from unittest.mock import Mock
        from .software_inventory import write_service
        client = AsyncMock()
        client.post.return_value = Mock()
        client.patch.return_value = Mock()
        client.delete.return_value = Mock()
        metadata = {"EntitySetName": "cr73c_services"}
        record_id = "11111111-1111-1111-1111-111111111111"
        with patch("backend.app.services.software_inventory.API_URL", "https://example.test/api"), \
             patch("backend.app.services.software_inventory.get_access_token", AsyncMock(return_value="token")), \
             patch("backend.app.services.software_inventory.get_editor_metadata", AsyncMock(return_value=(metadata, self.editor_fields()))), \
             patch("backend.app.services.software_inventory.service_metadata", AsyncMock(return_value=(metadata, {}))), \
             patch("backend.app.services.software_inventory.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            await write_service({"name": "Created"})
            await write_service({"description": "Edited"}, record_id, etag='W/"123"')
            await write_service(record_id=record_id, deleting=True, etag='W/"123"')
        self.assertEqual(client.post.call_args.args[0], "https://example.test/api/cr73c_services")
        self.assertEqual(client.post.call_args.kwargs["json"], {"cr73c_service": "Created"})
        self.assertEqual(client.patch.call_args.kwargs["headers"]["If-Match"], 'W/"123"')
        self.assertEqual(client.patch.call_args.kwargs["json"], {"cr73c_servicedescription": "Edited"})
        self.assertEqual(client.delete.call_args.args[0], f"https://example.test/api/cr73c_services({record_id})")

    async def test_dynamics_write_errors_are_not_reported_as_success(self):
        import httpx
        from unittest.mock import Mock
        from .software_inventory import write_service
        client = AsyncMock()
        request = httpx.Request("PATCH", "https://example.test/api")
        response = httpx.Response(412, request=request)
        client.patch.return_value = response
        with patch("backend.app.services.software_inventory.API_URL", "https://example.test/api"), \
             patch("backend.app.services.software_inventory.get_access_token", AsyncMock(return_value="token")), \
             patch("backend.app.services.software_inventory.get_editor_metadata", AsyncMock(return_value=({"EntitySetName": "cr73c_services"}, self.editor_fields()))), \
             patch("backend.app.services.software_inventory.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            with self.assertRaises(httpx.HTTPStatusError):
                await write_service({"description": "Edited"}, "11111111-1111-1111-1111-111111111111", etag='W/"123"')
        client.patch.assert_awaited_once()

    async def test_route_returns_actionable_conflict(self):
        import httpx
        from fastapi import HTTPException
        from ..routes.software_subscriptions import _inventory_action
        request = httpx.Request("PATCH", "https://example.test/api")
        response = httpx.Response(412, request=request)

        async def fail():
            response.raise_for_status()

        with self.assertRaises(HTTPException) as raised:
            await _inventory_action(fail())
        self.assertEqual(raised.exception.status_code, 412)
        self.assertIn("Refresh", raised.exception.detail)

    async def test_typed_vendor_name_resolves_to_record(self):
        from unittest.mock import Mock
        from .software_inventory import resolve_typed_lookups
        fields = self.editor_fields()
        fields["vendor"].update(PrimaryIdAttribute="accountid", PrimaryNameAttribute="name")
        client = AsyncMock()
        client.get.return_value = Mock(json=Mock(return_value={"value": [{"accountid": "vendor-id"}]}))
        values = {"vendor": {"name": "O'Brien"}, "name": "Service"}
        resolved = await resolve_typed_lookups(client, {}, values, fields)
        self.assertEqual(resolved["vendor"], "vendor-id")
        self.assertEqual(values["vendor"], {"name": "O'Brien"})
        self.assertEqual(client.get.call_args.kwargs["params"]["$filter"], "name eq 'O''Brien'")

    async def test_typed_lookup_missing_or_ambiguous_is_rejected(self):
        from unittest.mock import Mock
        from .software_inventory import resolve_typed_lookups
        fields = self.editor_fields()
        fields["primary_vendor_contact"].update(type="Lookup", EntitySetName="contacts", PrimaryIdAttribute="contactid", PrimaryNameAttribute="fullname")
        client = AsyncMock()
        for matches in ([], [{"contactid": "one"}, {"contactid": "two"}]):
            client.get.return_value = Mock(json=Mock(return_value={"value": matches}))
            with self.assertRaises(ValueError):
                await resolve_typed_lookups(client, {}, {"primary_vendor_contact": {"name": "Jane Doe"}}, fields)

    def test_service_term_duration_validation(self):
        from .software_inventory import normalize_service_duration
        fields = self.editor_fields()
        for unit in ("months", "years"):
            result = normalize_service_duration({"current_service_term": {"duration": 12, "unit": unit}}, fields)
            self.assertEqual(result["current_service_term"], f"12 {unit}")
        for duration, unit in ((0, "months"), (-1, "years"), (1.5, "months"), (True, "years"), (2, "days")):
            with self.assertRaises(ValueError):
                normalize_service_duration({"current_service_term": {"duration": duration, "unit": unit}}, fields)
        fields["current_service_term"]["type"] = "Lookup"
        with self.assertRaisesRegex(ValueError, "field mapping"):
            normalize_service_duration({"current_service_term": {"duration": 12, "unit": "months"}}, fields)
        self.assertEqual(normalize_service_duration({"current_service_term": "existing-id"}, fields)["current_service_term"], "existing-id")
