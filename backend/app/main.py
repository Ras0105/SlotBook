from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routes import auth, providers, availability, appointments, admin, reviews, internal

app = FastAPI(title="SlotBook", version="0.2.0")

# Browsers only let a frontend on another origin call the API if the API says so.
# Auth uses a Bearer token header (not cookies), so credentials/cookies are not allowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Retry-After"],
)

app.include_router(auth.router)
app.include_router(providers.router)
app.include_router(availability.router)
app.include_router(appointments.router)
app.include_router(reviews.router)
app.include_router(admin.router)
app.include_router(internal.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
