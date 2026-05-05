from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.accounts import router as accounts_router
from app.routes.metrics import router as metrics_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------
# ROUTES
# -------------------------------
app.include_router(accounts_router)
app.include_router(metrics_router)


@app.get("/")
def root():
    return {"message": "Enrichment Service Running"}
