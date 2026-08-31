from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .database import initialize_database
from .routes.accounts import router as accounts_router
from .routes.ai import router as ai_router
from .routes.auth import get_user_from_token, router as auth_router, user_has_module
from .routes.client_users import router as client_users_router
from .routes.company_financials import router as company_financials_router
from .routes.employee_productivity import router as employee_productivity_router
from .routes.economic_indicators import router as economic_indicators_router
from .routes.marketing import router as marketing_router
from .routes.metrics import router as metrics_router
from .routes.organizations import router as organizations_router
from .routes.software_subscriptions import router as software_subscriptions_router

app = FastAPI()
initialize_database()

MODULE_PATH_RULES = [
    ("prospecting", ("/leadfeeder-visits", "/accounts/leadfeeder-visits", "/pe-clients", "/pe-qualified-leads", "/marketing-lists", "/organizations", "/users")),
    ("management", ("/management", "/economic-indicators", "/company-financials", "/marketing", "/productivity", "/employee-productivity", "/software-subscriptions", "/ai")),
    ("main", ("/metrics", "/accounts")),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://camoin360.vercel.app",
        "https://camoin360.com",
        "https://www.camoin360.com",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_module_access(request, call_next):
    path = request.url.path

    if request.method == "OPTIONS" or path == "/" or path.startswith("/auth"):
        return await call_next(request)

    required_module = next(
        (module for module, prefixes in MODULE_PATH_RULES if any(path.startswith(prefix) for prefix in prefixes)),
        None,
    )

    if required_module is None:
        return await call_next(request)

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer" or not token:
        return JSONResponse(status_code=401, content={"detail": "Missing token"})

    try:
        user = get_user_from_token(token)
    except Exception as exc:
        status_code = getattr(exc, "status_code", 401)
        detail = getattr(exc, "detail", "Invalid token")
        return JSONResponse(status_code=status_code, content={"detail": detail})

    if not user_has_module(user, required_module):
        return JSONResponse(status_code=403, content={"detail": "Module access required"})

    return await call_next(request)

app.include_router(accounts_router)
app.include_router(ai_router)
app.include_router(auth_router)
app.include_router(client_users_router)
app.include_router(company_financials_router)
app.include_router(employee_productivity_router)
app.include_router(economic_indicators_router)
app.include_router(marketing_router)
app.include_router(metrics_router)
app.include_router(organizations_router)
app.include_router(software_subscriptions_router)


@app.get("/")
def root():
    return {"message": "Enrichment Service Running"}
