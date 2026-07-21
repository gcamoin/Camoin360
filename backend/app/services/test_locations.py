import unittest

from backend.app.services.locations import (
    CANADA_PROVINCE_NAMES_BY_ABBREVIATION,
    US_STATE_NAMES_BY_ABBREVIATION,
    get_state_province_country_group,
    normalize_country_group,
    normalize_state_province,
)


class LocationNormalizationTest(unittest.TestCase):
    def test_normalizes_us_states_and_canadian_provinces(self):
        self.assertEqual(normalize_state_province(" ny "), "NY")
        self.assertEqual(normalize_state_province("new york"), "NY")
        self.assertEqual(normalize_state_province("British Columbia"), "BC")
        self.assertEqual(normalize_state_province(" on "), "ON")
        self.assertEqual(normalize_state_province("Nunavut"), "NU")

    def test_returns_none_for_blank_or_unrecognized_values(self):
        self.assertIsNone(normalize_state_province(""))
        self.assertIsNone(normalize_state_province("   "))
        self.assertIsNone(normalize_state_province(None))
        self.assertIsNone(normalize_state_province("Bavaria"))

    def test_classifies_location_country_group(self):
        self.assertEqual(get_state_province_country_group("California"), "us")
        self.assertEqual(get_state_province_country_group("QC"), "canada")
        self.assertIsNone(get_state_province_country_group("Bavaria"))
        self.assertEqual(normalize_country_group(" U.S.A. "), "us")
        self.assertEqual(normalize_country_group("Canada"), "canada")
        self.assertEqual(normalize_country_group("Germany"), "germany")

    def test_mapping_includes_all_required_regions(self):
        self.assertEqual(len(US_STATE_NAMES_BY_ABBREVIATION), 51)
        self.assertEqual(len(CANADA_PROVINCE_NAMES_BY_ABBREVIATION), 13)


if __name__ == "__main__":
    unittest.main()
