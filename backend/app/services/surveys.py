"""Client survey reporting from Dynamics projects."""

import httpx

from .auth import get_access_token
from .dynamics import API_URL, get_formatted_value, get_lookup_display_value


def _dynamics_error(response):
    try:
        return response.json().get("error", {}).get("message") or response.text[:500]
    except ValueError:
        return response.text[:500]


def _survey_row(record):
    survey_date = record.get("cr73c_clientsurveydate")
    owner = record.get("ownerid")
    owner_id = record.get("_ownerid_value") or (
        owner.get("systemuserid") or owner.get("teamid") or owner.get("ownerid")
        if isinstance(owner, dict)
        else owner
    )
    owner_name = record.get("_ownerid_value@OData.Community.Display.V1.FormattedValue") or (
        owner.get("fullname") or owner.get("name")
        if isinstance(owner, dict)
        else ""
    )
    principal = (
        get_lookup_display_value(record, "_new_principalid_value")
        or get_lookup_display_value(record, "new_principalid")
    )
    return {
        "id": record.get("new_projectid"),
        "project": get_formatted_value(record, "new_project") or "",
        "client": (
            get_lookup_display_value(record, "new_client")
            or get_lookup_display_value(record, "_new_client_value")
            or ""
        ),
        "comments": record.get("cr73c_clientsurveycomments") or "",
        "project_manager": str(owner_name or ""),
        "project_manager_id": str(owner_id or ""),
        "project_manager_source": "ownerid" if owner_id or owner_name else "",
        "project_manager_owner_type": record.get("_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname") or "",
        "principal": principal or "",
        "service_line": get_formatted_value(record, "cr73c_servicelineprimary") or "",
        "survey_date": survey_date,
        "survey_year": int(survey_date[:4]) if survey_date and survey_date[:4].isdigit() else None,
    }


async def get_completed_surveys():
    if not API_URL:
        raise RuntimeError("DYNAMICS_API_URL is not configured")

    token = await get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue,Microsoft.Dynamics.CRM.lookuplogicalname"',
    }
    selected_url = (
        f"{API_URL}/new_projects?"
        "$select=new_projectid,new_project,new_client,cr73c_clientsurveycomments,"
        "cr73c_clientsurveydate,_ownerid_value,_new_principalid_value,cr73c_servicelineprimary&"
        "$filter=cr73c_clientsurveydate ne null&"
        "$orderby=cr73c_clientsurveydate desc"
    )
    url = selected_url
    used_fallback = False
    rows = []
    async with httpx.AsyncClient(timeout=60) as client:
        while url:
            response = await client.get(url, headers=headers)
            if response.status_code == 400 and not used_fallback and url == selected_url:
                # Custom project schemas can expose lookup properties under different
                # Web API names. Fetch the project records without a field projection.
                used_fallback = True
                url = f"{API_URL}/new_projects"
                continue
            if response.is_error:
                raise RuntimeError(f"Dynamics returned {response.status_code}: {_dynamics_error(response)}")
            payload = response.json()
            rows.extend(
                _survey_row(record)
                for record in payload.get("value", [])
                if record.get("cr73c_clientsurveydate")
            )
            url = payload.get("@odata.nextLink")

    rows.sort(key=lambda row: row["survey_date"], reverse=True)
    return {"total": len(rows), "rows": rows}
