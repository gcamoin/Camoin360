from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.accounts import router as accounts_router
from .routes.auth import router as auth_router
from .routes.employee_productivity import router as employee_productivity_router
from .routes.economic_indicators import router as economic_indicators_router
from .routes.marketing import router as marketing_router
from .routes.metrics import router as metrics_router

app = FastAPI()

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
app.include_router(employee_productivity_router)
app.include_router(economic_indicators_router)
app.include_router(marketing_router)
app.include_router(metrics_router)


@app.get("/")
def root():
    return {"message": "Enrichment Service Running"}
