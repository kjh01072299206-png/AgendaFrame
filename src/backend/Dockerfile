FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AGENDAFRAME_RUNTIME_CONFIG=/app/config/gcp-runtime.yaml \
    AGENDAFRAME_SOURCE_POLICY=/app/config/source-policies.yaml \
    AGENDAFRAME_DISCOVERY_POLICY=/app/site/data/discovery-sources.json

WORKDIR /app
COPY pyproject.toml README.md requirements.lock ./
COPY src ./src
COPY config ./config
COPY site/data/discovery-sources.json ./site/data/discovery-sources.json
RUN python -m pip install --disable-pip-version-check --require-hashes -r requirements.lock \
    && python -m pip install --disable-pip-version-check --no-deps .

USER 65532:65532
ENTRYPOINT ["python", "-m", "backend.gcp_job_entrypoint"]
