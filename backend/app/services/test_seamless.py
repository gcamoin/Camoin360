import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from . import seamless
from .seamless import company_names_match, get_match_confidence


class NaicsNormalizationTest(unittest.TestCase):
    def test_accepts_hierarchy_codes_as_text_without_padding(self):
        for code in ("12", "123", "1234", "12345", "123456", "31", "311", "3118", "31181", "311811", "031"):
            for value in (code, f" {code} ", int(code)):
                with self.subTest(value=value):
                    expected = str(value).strip()
                    self.assertEqual(seamless.normalize_naics_code(value), expected)

    def test_rejects_invalid_values_without_deriving_a_code(self):
        for value in ("1", 1, "1234567", 1234567, "", "   ", None, True, False,
                      "Technology", "31-33", "311.0", 311.5, 311.0, "３１１", "٣١", -31, [], {}):
            with self.subTest(value=value):
                self.assertIsNone(seamless.normalize_naics_code(value))


class MatchConfidenceTest(unittest.TestCase):
    def test_company_name_matching_allows_formatting_but_rejects_different_businesses(self):
        self.assertTrue(company_names_match("North Star Economic Development, Inc.", "North Star Economic Development LLC"))
        self.assertTrue(company_names_match("Advanced Manufacturing Group", "Advanced Manufacturing Group USA"))
        self.assertFalse(company_names_match("Acme Manufacturing", "Acme Holdings"))
        self.assertFalse(company_names_match("Smith Consulting", "Smith Construction"))

    def test_scores_each_of_the_five_matching_fields_equally(self):
        company = {
            "name": "Acme, Inc.",
            "websiteurl": "https://www.acme.com/about",
            "telephone1": "+1 (212) 555-0100",
            "address1_country": "USA",
            "address1_stateorprovince": "NY",
        }
        candidate = {
            "name": "Acme LLC",
            "domain": "acme.com",
            "phones": ["212-555-0100"],
            "country": "United States",
            "state": "New York",
        }

        result = get_match_confidence(company, candidate)

        self.assertEqual(result["confidence_score"], 100)
        self.assertEqual(set(result["matched_fields"]), {"website", "phone", "country", "state", "name"})

    def test_requires_three_actual_matches_to_reach_sixty_percent(self):
        company = {
            "name": "Acme",
            "websiteurl": None,
            "telephone1": "555-0100",
            "address1_country": "United States",
            "address1_stateorprovince": "NY",
        }
        candidate = {
            "name": "Acme",
            "domain": "acme.com",
            "phones": "555-9999",
            "country": "United States",
            "state": "New York",
        }

        result = get_match_confidence(company, candidate)

        self.assertEqual(result["confidence_score"], 60)
        self.assertEqual(set(result["matched_fields"]), {"country", "state", "name"})
        self.assertFalse(result["match_checks"]["website"])
        self.assertFalse(result["match_checks"]["phone"])


class SparseCompanyMatchTest(unittest.IsolatedAsyncioTestCase):
    async def test_naics_mapping_uses_only_selected_company_actual_code(self):
        cases = [(value, str(value).strip()) for code in ("31", "311", "3118", "31181", "311811") for value in (code, int(code), f" {code} ")] + [(511210, "511210"), ("511210", "511210"),
                 (" 511210 ", "511210"), (None, None), ("", None),
                 ("Technology", None), (51121, "51121"), ("511210.0", None),
                 (511210.0, None), (True, None), ([511210], None),
                 ("５１１２１０", None), ({"code": 511210}, None)]
        for value, expected in cases + [("missing", None)]:
            with self.subTest(value=value):
                candidate = {"name": "Acme", "domain": "acme.example",
                             "sicCode": "511210", "industries": ["511210"]}
                if value != "missing":
                    candidate["naicsCode"] = value
                response = MagicMock(status_code=200, headers={})
                response.json.return_value = {"data": [
                    {"name": "Different Business", "domain": "other.example", "naicsCode": 541511},
                    candidate]}
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.post.return_value = response
                with patch.object(seamless, "SEAMLESS_API_KEY", "test-key"), patch.object(seamless.httpx, "AsyncClient", return_value=client):
                    result = await seamless.enrich_with_seamless({"name": "Acme"})
                self.assertEqual(result["cr73c_naicscode"], expected)
                client.post.assert_awaited_once()

    async def test_maps_postal_code_from_selected_company_without_extra_request(self):
        cases = [
            ({"postCode": "02141"}, "02141"),
            ({}, None),
            ({"postCode": None}, None),
            ({"postCode": ""}, ""),
            ({"postCode": "   "}, "   "),
        ]
        for postal_fields, expected in cases:
            with self.subTest(postal_fields=postal_fields):
                response = MagicMock(status_code=200, headers={})
                response.json.return_value = {"data": [
                    {"name": "Different Business", "domain": "other.example", "postCode": "99999"},
                    {"name": "Acme", "domain": "acme.example", **postal_fields},
                ]}
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.post.return_value = response
                with (
                    patch.object(seamless, "SEAMLESS_API_KEY", "test-key"),
                    patch.object(seamless.httpx, "AsyncClient", return_value=client),
                ):
                    result = await seamless.enrich_with_seamless({"name": "Acme"})
                self.assertEqual(result["address1_postalcode"], expected)
                self.assertEqual(result["websiteurl"], "https://acme.example")
                client.post.assert_awaited_once()

    async def test_balance_write_failure_preserves_provider_outcome(self):
        for data, expected in (
            ([{"name": "Acme", "domain": "acme.example"}], "https://acme.example"),
            ([], None),
        ):
            with self.subTest(has_match=bool(data)):
                response = MagicMock(status_code=200, headers={"X-PublicAPI-Credits": "123"})
                response.json.return_value = {"data": data}
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.post.return_value = response
                with (
                    patch.object(seamless, "SEAMLESS_API_KEY", "test-key"),
                    patch.object(seamless.httpx, "AsyncClient", return_value=client),
                    patch.object(seamless, "update_total_credits_remaining", side_effect=OSError("Balance file unwritable")),
                    self.assertLogs(seamless.logger, level="ERROR"),
                ):
                    result = await seamless.enrich_with_seamless({"name": "Acme"})
                self.assertEqual(result.get("websiteurl"), expected)
                if not data:
                    self.assertEqual(result, {})

    async def test_balance_write_failure_does_not_mask_provider_error(self):
        response = MagicMock(status_code=429, headers={"X-PublicAPI-Credits": "123"}, text="Rate limit reached")
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.return_value = response
        with (
            patch.object(seamless, "SEAMLESS_API_KEY", "test-key"),
            patch.object(seamless.httpx, "AsyncClient", return_value=client),
            patch.object(seamless, "update_total_credits_remaining", side_effect=OSError("Balance file unwritable")),
            self.assertLogs(seamless.logger, level="ERROR"),
        ):
            with self.assertRaisesRegex(RuntimeError, "Seamless API error \\(429\\)"):
                await seamless.enrich_with_seamless({"name": "Acme"})

    async def test_records_total_credit_balance_from_response_header(self):
        class Response:
            status_code = 200
            headers = {"X-PublicAPI-Credits": "12,345"}

            def json(self):
                return {"data": [{"name": "Acme", "domain": "acme.example"}]}

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, *args, **kwargs):
                return Response()

        with (
            patch.object(seamless, "SEAMLESS_API_KEY", "test-key"),
            patch.object(seamless.httpx, "AsyncClient", return_value=Client()),
            patch.object(seamless, "update_total_credits_remaining") as update_balance,
        ):
            await seamless.enrich_with_seamless({"name": "Acme"})

        update_balance.assert_called_once_with("12,345")

    async def test_accepts_name_only_match_and_rejects_other_names(self):
        class Response:
            status_code = 200

            def json(self):
                return {"data": [
                    {"name": "Different Business", "domain": "other.example", "country": "United States"},
                    {"name": "Acme LLC", "domain": "acme.example", "phones": ["555-0100"]},
                ]}

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, *args, **kwargs):
                return Response()

        with patch.object(seamless, "SEAMLESS_API_KEY", "test-key"), patch.object(seamless.httpx, "AsyncClient", return_value=Client()):
            result = await seamless.enrich_with_seamless({"name": "Acme Inc."})

        self.assertEqual(result["matched_fields"], ["name"])
        self.assertEqual(result["confidence_score"], 20)
        self.assertEqual(result["websiteurl"], "https://acme.example")

    async def test_rejects_usable_result_when_seamless_name_is_not_similar(self):
        class Response:
            status_code = 200

            def json(self):
                return {"data": [{"name": "Acme Holdings", "domain": "acme.example"}]}

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, *args, **kwargs):
                return Response()

        with patch.object(seamless, "SEAMLESS_API_KEY", "test-key"), patch.object(seamless.httpx, "AsyncClient", return_value=Client()):
            result = await seamless.enrich_with_seamless({"name": "Acme Manufacturing"})

        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
