import unittest
from unittest.mock import AsyncMock, patch

import httpx

from . import surveys


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.urls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, url, headers):
        self.urls.append(url)
        return self.responses.pop(0)


def response(status, payload):
    return httpx.Response(status, json=payload, request=httpx.Request("GET", "https://example.test"))


class CompletedSurveysTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_without_projection_and_counts_only_dated_surveys(self):
        client = FakeClient([
            response(400, {"error": {"message": "Invalid property"}}),
            response(200, {
                "value": [
                    {
                        "new_projectid": "1",
                        "new_project": "A",
                        "new_client": "Client A",
                        "cr73c_clientsurveydate": "2020-05-10T00:00:00Z",
                        "cr73c_clientsurveycomments": "Good",
                    },
                    {"new_projectid": "2", "new_project": "B", "cr73c_clientsurveydate": None},
                ],
                "@odata.nextLink": "https://example.test/next",
            }),
            response(200, {"value": [
                {"new_projectid": "3", "new_project": "C", "cr73c_clientsurveydate": "2021-01-01T00:00:00Z"},
            ]}),
        ])
        with patch.object(surveys, "API_URL", "https://example.test"), \
             patch.object(surveys, "get_access_token", new=AsyncMock(return_value="token")), \
             patch.object(surveys.httpx, "AsyncClient", return_value=client):
            result = await surveys.get_completed_surveys()

        self.assertEqual(result["total"], 2)
        self.assertEqual([row["id"] for row in result["rows"]], ["3", "1"])
        self.assertEqual(result["rows"][1]["survey_year"], 2020)
        self.assertEqual(client.urls[1], "https://example.test/new_projects")

    async def test_includes_dynamics_error_detail_after_retry(self):
        client = FakeClient([
            response(400, {"error": {"message": "Bad field"}}),
            response(400, {"error": {"message": "No access to projects"}}),
        ])
        with patch.object(surveys, "API_URL", "https://example.test"), \
             patch.object(surveys, "get_access_token", new=AsyncMock(return_value="token")), \
             patch.object(surveys.httpx, "AsyncClient", return_value=client):
            with self.assertRaisesRegex(RuntimeError, "No access to projects"):
                await surveys.get_completed_surveys()
