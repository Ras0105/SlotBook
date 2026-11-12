from fastapi import APIRouter

router = APIRouter(prefix="/appointments", tags=["appointments"])

# TODO: POST /, GET /me, GET /{id}, PATCH /{id}/cancel, PATCH /{id}/reschedule
