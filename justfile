validate:
    python scripts/validate_package.py
db-up:
    podman compose --env-file .env.local up -d db
release-check:
    python scripts/validate_package.py --release
