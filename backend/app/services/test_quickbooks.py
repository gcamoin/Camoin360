import os
import unittest
from unittest.mock import patch

from . import quickbooks


class QuickBooksFinancialsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        quickbooks._cache["loaded_at"] = None
        quickbooks._cache["data"] = None

    async def test_missing_configuration_returns_sample_financials(self):
        env_without_quickbooks = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("QUICKBOOKS_", "QB_", "INTUIT_"))
        }

        with patch.dict(os.environ, env_without_quickbooks, clear=True):
            result = await quickbooks.get_company_financials(force_refresh=True)

        self.assertEqual(result["source"], "Sample QuickBooks financials")
        self.assertGreaterEqual(len(result["rows"]), 12)
        self.assertEqual(
            {
                "cashOnHand",
                "currentRatio",
                "debtToAssets",
                "debtToEquity",
                "month",
                "monthNumber",
                "monthKey",
                "netIncome",
                "ownerEquity",
                "quarter",
                "returnOnAssets",
                "sales",
                "year",
            },
            set(result["rows"][0]),
        )


if __name__ == "__main__":
    unittest.main()
