from fastapi import FastAPI

from app.routes import auth, providers, availability, appointments, admin

app = FastAPI(title="SlotBook", version="0.1.0")

app.include_router(auth.router)
app.include_router(providers.router)
app.include_router(availability.router)
app.include_router(appointments.router)
app.include_router(admin.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
