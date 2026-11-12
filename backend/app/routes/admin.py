from fastapi import APIRouter

router = APIRouter(prefix="/admin", tags=["admin"])

# TODO: GET /admin/appointments (admin only, with filters)
