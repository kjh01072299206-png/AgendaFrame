FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AGENDAFRAME_RUNTIME_CONFIG=/app/config/gcp-runtime.yaml \
    AGENDAFRAME_SOURCE_POLICY=/app/config/source-policies.yaml

WORKDIR /app
COPY pyproject.toml README.md requirements.lock ./
COPY src ./src
COPY config ./config
RUN python -m pip install --disable-pip-version-check --require-hashes -r requirements.lock \
    && python -m pip install --disable-pip-version-check --no-deps .

USER 65532:65532
ENTRYPOINT ["python", "-m", "backend.main"]
CMD ["validate-config"]
