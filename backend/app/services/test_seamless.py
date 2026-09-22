import unittest
from unittest.mock import patch

from . import seamless
from .seamless import company_names_match, get_match_confidence


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
