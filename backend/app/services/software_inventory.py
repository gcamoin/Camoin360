"""Read the software inventory directly from the Dynamics service table."""
import httpx

from .auth import get_access_token
from .dynamics import API_URL

FIELDS = {
    "status": "cr73c_servicestatus",
    "name": "cr73c_Service",
    "description": "cr73c_servicedescription",
    "vendor": "cr73c_vendor",
    "service_type": "cr73c_servicetype",
    "current_service_term": "cr73c_currentserviceterm",
    "primary_vendor_contact": "cr73c_primaryvendorcontact",
    "access_details": "cr73c_accessdetails",
    "primary_contact": "cr73c_systemuser",
    "subscribed_since": "cr73c_subscribedsince",
}


async def list_dynamics_services(limit: int = 1000):
    if not API_URL:
        raise RuntimeError("Dynamics API is not configured")
    headers = {
        "Authorization": f"Bearer {await get_access_token()}",
        "Accept": "application/json",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=1000',
    }
    async with httpx.AsyncClient(timeout=60) as client:
        metadata, mapped = await service_metadata(client, headers)
        field_map = {key: read_field(attribute) for key, attribute in mapped.items()}
        primary_id = metadata["PrimaryIdAttribute"]
        url = f"{API_URL}/{metadata['EntitySetName']}"
        params = {"$select": ",".join([primary_id, *field_map.values()]), "$filter": "statecode eq 0", "$top": str(limit)}
        records = []
        while url and len(records) < limit:
            response = await client.get(url, headers=headers, params=params)
            response.raise_for_status()
            payload = response.json()
            for record in payload.get("value", []):
                row = {"id": record[primary_id], "values": {}, "etag": record.get("@odata.etag")}
                for key, field in field_map.items():
                    row["values"][key] = record.get(field)
                    row[key] = record.get(f"{field}@OData.Community.Display.V1.FormattedValue", record.get(field)) or ""
                    if key == "subscribed_since":
                        row[key] = record.get(field) or ""
                records.append(row)
            url = payload.get("@odata.nextLink")
            params = None
    return records[:limit]


LOOKUP_TYPES = {"Lookup", "Customer", "Owner"}


def read_field(attribute):
    name = attribute["LogicalName"]
    return f"_{name}_value" if attribute["AttributeType"] in LOOKUP_TYPES else name


async def service_metadata(client, headers):
    response = await client.get(f"{API_URL}/EntityDefinitions(LogicalName='cr73c_service')", headers=headers, params={
        "$select": "EntitySetName,PrimaryIdAttribute",
        "$expand": "Attributes($select=LogicalName,SchemaName,AttributeType,IsValidForCreate,IsValidForUpdate,RequiredLevel)",
    })
    response.raise_for_status()
    metadata = response.json()
    mapped = {}
    for key, provided in FIELDS.items():
        attribute = next((item for item in metadata["Attributes"] if provided.lower() in {
            item["LogicalName"].lower(), (item.get("SchemaName") or "").lower()
        }), None)
        if attribute is None:
            raise RuntimeError(f"Dynamics service field is missing: {provided}")
        mapped[key] = attribute
    return metadata, mapped


async def request_headers():
    if not API_URL:
        raise RuntimeError("Dynamics API is not configured")
    return {"Authorization": f"Bearer {await get_access_token()}", "Accept": "application/json",
            "OData-Version": "4.0", "Content-Type": "application/json"}


async def get_editor_metadata(client, headers):
    metadata, mapped = await service_metadata(client, headers)
    response = await client.get(f"{API_URL}/EntityDefinitions(LogicalName='cr73c_service')/ManyToOneRelationships", headers=headers,
        params={"$select": "ReferencingAttribute,ReferencedEntity,ReferencingEntityNavigationPropertyName"})
    response.raise_for_status()
    relationships = response.json().get("value", [])
    fields = {}
    for key, attribute in mapped.items():
        field = {"logical_name": attribute["LogicalName"], "type": attribute["AttributeType"],
                 "create": attribute.get("IsValidForCreate", True), "update": attribute.get("IsValidForUpdate", True),
                 "required": attribute.get("RequiredLevel", {}).get("Value") in {"SystemRequired", "ApplicationRequired"}}
        if field["type"] in LOOKUP_TYPES:
            matches = [r for r in relationships if r["ReferencingAttribute"] == field["logical_name"]]
            if len(matches) != 1:
                raise RuntimeError(f"Unsupported multi-table lookup: {key}")
            relation = matches[0]
            target = relation["ReferencedEntity"]
            response = await client.get(f"{API_URL}/EntityDefinitions(LogicalName='{target}')", headers=headers,
                params={"$select": "EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute"})
            response.raise_for_status()
            field.update(response.json())
            field["navigation"] = relation["ReferencingEntityNavigationPropertyName"]
        elif field["type"] == "Picklist":
            response = await client.get(f"{API_URL}/EntityDefinitions(LogicalName='cr73c_service')/Attributes(LogicalName='{field['logical_name']}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata", headers=headers,
                params={"$expand": "OptionSet"})
            response.raise_for_status()
            field["options"] = [{"value": option["Value"], "label": (option["Label"].get("UserLocalizedLabel") or next(iter(option["Label"].get("LocalizedLabels", [])), {"Label": str(option["Value"])}))["Label"]}
                                for option in response.json()["OptionSet"]["Options"]]
        fields[key] = field
    return metadata, fields


async def inventory_editor():
    headers = await request_headers()
    async with httpx.AsyncClient(timeout=60) as client:
        _, fields = await get_editor_metadata(client, headers)
    return {"fields": fields}


async def lookup_options(key, query):
    if key not in FIELDS:
        raise ValueError("Unknown inventory field")
    headers = await request_headers()
    async with httpx.AsyncClient(timeout=60) as client:
        _, fields = await get_editor_metadata(client, headers)
        field = fields[key]
        if field["type"] not in LOOKUP_TYPES:
            raise ValueError("This field is not a lookup")
        name = field["PrimaryNameAttribute"]
        params = {"$select": f"{field['PrimaryIdAttribute']},{name}", "$top": "50", "$orderby": f"{name} asc"}
        if query:
            escaped = query.replace("'", "''")
            params["$filter"] = f"contains({name},'{escaped}')"
        response = await client.get(f"{API_URL}/{field['EntitySetName']}", headers=headers, params=params)
        response.raise_for_status()
        return {"data": [{"value": row[field["PrimaryIdAttribute"]], "label": row.get(name) or "(Unnamed)"} for row in response.json().get("value", [])]}


def build_write_payload(values, fields, creating):
    from uuid import UUID
    from datetime import date
    unknown = set(values) - set(FIELDS)
    if unknown:
        raise ValueError("Unknown inventory fields")
    if creating and not str(values.get("name") or "").strip():
        raise ValueError("Service is required")
    payload = {}
    for key, value in values.items():
        field = fields[key]
        if not field["create" if creating else "update"]:
            raise ValueError(f"{key} cannot be edited")
        if value == "":
            value = None
        if field["required"] and value is None:
            raise ValueError(f"{key} is required")
        if key == "name" and (not isinstance(value, str) or not value.strip()):
            raise ValueError("Service is required")
        if field["type"] in LOOKUP_TYPES:
            if value is None:
                # Clearing a single-valued navigation property disassociates the lookup.
                payload[field["navigation"]] = None
            else:
                value = str(UUID(str(value)))
                payload[f"{field['navigation']}@odata.bind"] = f"/{field['EntitySetName']}({value})"
        else:
            if field["type"] == "Picklist" and value is not None:
                if type(value) is not int or value not in {option["value"] for option in field["options"]}:
                    raise ValueError(f"Invalid choice for {key}")
            elif field["type"] == "DateTime" and value is not None:
                date.fromisoformat(str(value)[:10])
                value = str(value)[:10] + "T00:00:00Z"
            elif value is not None and not isinstance(value, str):
                raise ValueError(f"Invalid text for {key}")
            payload[field["logical_name"]] = value
    if creating:
        for key, field in fields.items():
            if field["required"] and field["create"] and values.get(key) in (None, ""):
                raise ValueError(f"{key} is required")
    return payload


async def resolve_typed_lookups(client, headers, values, fields):
    resolved = dict(values)
    for key in ("vendor", "primary_vendor_contact"):
        value = resolved.get(key)
        if not isinstance(value, dict):
            continue
        field = fields[key]
        label = "Vendor" if key == "vendor" else "Primary Vendor Contact"
        if field["type"] not in LOOKUP_TYPES or set(value) != {"name"} or not isinstance(value["name"], str):
            raise ValueError(f"Invalid value for {label}")
        name = value["name"].strip()
        if not name:
            resolved[key] = None
            continue
        escaped = name.replace("'", "''")
        response = await client.get(f"{API_URL}/{field['EntitySetName']}", headers=headers, params={
            "$select": field["PrimaryIdAttribute"],
            "$filter": f"{field['PrimaryNameAttribute']} eq '{escaped}'",
            "$top": "2",
        })
        response.raise_for_status()
        matches = response.json().get("value", [])
        if not matches:
            raise ValueError(f"{label}: no Dynamics record matches '{name}'. Enter an existing record's exact name.")
        if len(matches) != 1:
            raise ValueError(f"{label}: multiple Dynamics records match '{name}'. Use a unique record name.")
        resolved[key] = matches[0][field["PrimaryIdAttribute"]]
    return resolved


def normalize_service_duration(values, fields):
    values = dict(values)
    term = values.get("current_service_term")
    if not isinstance(term, dict):
        return values
    if set(term) != {"duration", "unit"} or type(term["duration"]) is not int or term["duration"] <= 0 or term["unit"] not in {"months", "years"}:
        raise ValueError("Service Term must have a positive whole number and Months or Years.")
    field = fields["current_service_term"]
    if field["type"] not in {"String", "Memo"}:
        raise ValueError("Saving a duration requires the duration and unit field mapping on the Dynamics Service Terms table.")
    values["current_service_term"] = f"{term['duration']} {term['unit']}"
    return values


async def write_service(values=None, record_id=None, deleting=False, etag=None):
    from uuid import UUID
    headers = await request_headers()
    async with httpx.AsyncClient(timeout=60) as client:
        if record_id:
            record_id = str(UUID(str(record_id)))
        if deleting:
            metadata, _ = await service_metadata(client, headers)
        else:
            metadata, fields = await get_editor_metadata(client, headers)
            values = normalize_service_duration(values, fields)
            values = await resolve_typed_lookups(client, headers, values, fields)
            payload = build_write_payload(values, fields, creating=record_id is None)
        url = f"{API_URL}/{metadata['EntitySetName']}"
        if record_id:
            url += f"({record_id})"
            headers["If-Match"] = etag or "*"
        if deleting:
            response = await client.delete(url, headers=headers)
        elif record_id:
            response = await client.patch(url, headers=headers, json=payload)
        else:
            response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
    return {"status": "deleted" if deleting else "saved"}
