from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import initialize_database
from .routes.accounts import router as accounts_router
from .routes.auth import router as auth_router
from .routes.client_users import router as client_users_router
from .routes.metrics import router as metrics_router
from .routes.organizations import router as organizations_router

app = FastAPI()
initialize_database()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts_router)
app.include_router(auth_router)
app.include_router(client_users_router)
app.include_router(metrics_router)
app.include_router(organizations_router)


@app.get("/")
def root():
    return {"message": "Enrichment Service Running"}
