FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /workspace/services/api
COPY services/api/pyproject.toml ./
COPY services/api/requirements.lock ./
COPY services/api/app ./app
RUN pip install --no-cache-dir -r requirements.lock . && useradd --uid 10001 --create-home campusmy
COPY services/api/alembic.ini ./
COPY services/api/alembic ./alembic
COPY data/seed.json /workspace/data/seed.json
RUN mkdir -p .runtime && chown -R campusmy:campusmy /workspace
USER campusmy
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
