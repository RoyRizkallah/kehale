FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x /app/docker/entrypoint.sh /app/docker/wait-for-oracle.sh /app/docker/import-remote.sh

ENV PYTHONUNBUFFERED=1 \
    ORACLE_ENABLED=true \
    ORACLE_USER=system \
    ORACLE_PASSWORD=Kehale2026! \
    ORACLE_DSN=oracle:1521/XE \
    ORACLE_HOST=oracle \
    ORACLE_IMPORT_MARKER=/data/.oracle_import_done

CMD ["/app/docker/entrypoint.sh"]
