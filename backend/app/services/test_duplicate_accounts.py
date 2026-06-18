import unittest

from .duplicate_accounts import (
    find_duplicate_account_groups,
    normalize_company_name,
    normalize_text_value,
)


class DuplicateAccountNormalizationTest(unittest.TestCase):
    def test_normalizes_text_values(self):
        self.assertEqual(normalize_text_value("  ACME,   North-East!  "), "acme north east")
        self.assertEqual(normalize_text_value(None), "")

    def test_normalizes_company_names(self):
        examples = {
            "Acme, Inc.": "acme",
            "  ACME   Manufacturing LLC  ": "acme manufacturing",
            "North-East Holdings, L.L.C.": "north east holdings",
            "Contoso Corporation Ltd.": "contoso",
            "Example Company": "example",
        }

        for raw_value, expected_value in examples.items():
            with self.subTest(raw_value=raw_value):
                self.assertEqual(normalize_company_name(raw_value), expected_value)


class DuplicateAccountDetectionTest(unittest.TestCase):
    def test_groups_high_confidence_duplicates(self):
        accounts = [
            self.make_account("1", "Acme Manufacturing, Inc.", "https://www.acme.com", "USA", "NY"),
            self.make_account("2", "Acme Manufacturing LLC", "http://acme.com/contact", "USA", "NY"),
            self.make_account("3", "Contoso", "https://contoso.com", "USA", "NY"),
        ]

        groups = find_duplicate_account_groups(accounts)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["confidence"], "high")
        self.assertEqual(groups[0]["confidence_score"], 100)
        self.assertEqual(self.account_ids(groups[0]), ["1", "2"])
        self.assertIn("same website", groups[0]["reasons"])
        self.assertIn("same name", groups[0]["reasons"])

    def test_groups_location_duplicates_with_score_driven_confidence(self):
        accounts = [
            self.make_account("1", "Acme Manufacturing, Inc.", "", "USA", "NY"),
            self.make_account("2", "Acme Manufacturing LLC", None, "United States", "NY"),
        ]

        groups = find_duplicate_account_groups(accounts)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["confidence"], "low")
        self.assertEqual(groups[0]["confidence_score"], 60)
        self.assertEqual(self.account_ids(groups[0]), ["1", "2"])
        self.assertIn("missing website", groups[0]["reasons"])

    def test_groups_medium_confidence_duplicates(self):
        accounts = [
            self.make_account("1", "Acme Manufacturing, Inc.", "https://www.acme.com", "USA", "NY"),
            self.make_account("2", "Acme Manufacturing LLC", "https://acme.com", "Canada", "ON"),
        ]

        groups = find_duplicate_account_groups(accounts)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["confidence"], "medium")
        self.assertEqual(groups[0]["confidence_score"], 70)
        self.assertEqual(self.account_ids(groups[0]), ["1", "2"])

    def test_groups_low_confidence_name_only_duplicates(self):
        accounts = [
            self.make_account("1", "Acme Manufacturing, Inc.", "https://acme-east.com", "USA", "NY"),
            self.make_account("2", "Acme Manufacturing LLC", "https://acme-west.com", "Canada", "ON"),
        ]

        groups = find_duplicate_account_groups(accounts)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["confidence"], "low")
        self.assertEqual(groups[0]["confidence_score"], 30)
        self.assertEqual(self.account_ids(groups[0]), ["1", "2"])
        self.assertEqual(groups[0]["reasons"], ["same name"])

    def test_does_not_group_different_names_with_same_location(self):
        accounts = [
            self.make_account("1", "Acme Manufacturing", "https://acme.com", "USA", "NY"),
            self.make_account("2", "Contoso Manufacturing", "https://contoso.com", "USA", "NY"),
        ]

        self.assertEqual(find_duplicate_account_groups(accounts), [])

    @staticmethod
    def make_account(account_id, name, website, country, state):
        return {
            "accountid": account_id,
            "name": name,
            "websiteurl": website,
            "address1_country": country,
            "address1_stateorprovince": state,
            "address1_city": "Albany",
            "telephone1": "555-0100",
            "new_sector": "Manufacturing",
            "createdon": "2026-01-01T00:00:00Z",
        }

    @staticmethod
    def account_ids(group):
        return sorted(account["accountid"] for account in group["accounts"])


if __name__ == "__main__":
    unittest.main()
