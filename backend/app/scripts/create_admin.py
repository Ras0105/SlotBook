# backend/app/scripts/create_admin.py
# Purpose: create (or promote) an admin user. Registration always creates customers, so admins are
# bootstrapped from the command line:
#
#   python -m app.scripts.create_admin --email admin@example.com --name "Admin"
#   (the password is prompted for, or read from the ADMIN_PASSWORD environment variable)

import argparse
import getpass
import os
import sys

from datetime import datetime, timezone

from app.core.security import hash_password
from app.database.session import SessionLocal
from app.models import Role, User
from app.repositories import user_repository


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create an admin user (or promote an existing user).")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="Admin")
    args = parser.parse_args(argv)

    password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Password (min 8 chars): ")
    if len(password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        user = user_repository.get_by_email(db, args.email)
        if user:
            user.role = Role.admin
            action = "promoted to admin"
        else:
            user = User(
                name=args.name,
                email=args.email,
                password_hash=hash_password(password),
                role=Role.admin,
                email_verified_at=datetime.now(timezone.utc),  # created by the operator, not by a sign-up form
            )
            user_repository.create(db, user)
            action = "created"
        db.commit()
    print(f"User {args.email} {action}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
