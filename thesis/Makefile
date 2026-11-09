# make thesis       offline rebuild from committed snapshots (Python 3 standard library only)
# make thesis-live  refresh snapshots from BigQuery (needs GOOGLE_APPLICATION_CREDENTIALS or BQ_KEY_FILE), then rebuild
PY ?= $(shell test -x .venv/bin/python && echo .venv/bin/python || echo python3)

thesis:
	python3 build.py

thesis-live:
	@test -n "$$GOOGLE_APPLICATION_CREDENTIALS$$BQ_KEY_FILE" || (echo "set GOOGLE_APPLICATION_CREDENTIALS (or BQ_KEY_FILE) to a service-account key path"; exit 1)
	$(PY) pull_bq.py all
	python3 build.py

.PHONY: thesis thesis-live
