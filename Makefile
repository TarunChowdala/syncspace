SHELL := /bin/bash
.PHONY: dev backend frontend

dev:
	@echo "Starting backend and frontend..."
	npm --prefix syncspace_backend run dev & \
	npm --prefix syncspace_frontend run dev ; wait

backend:
	npm --prefix syncspace_backend run dev

frontend:
	npm --prefix syncspace_frontend run dev
