import unittest

from .seamless import get_match_confidence


class MatchConfidenceTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
