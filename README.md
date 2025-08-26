# DoctorHelp — Medical Knowledge Assistant for Doctors

## What
DoctorHelp is a clinical decision-support assistant for doctors: upload case notes or type symptoms, the assistant fetches relevant studies, generates a differential, and recommends tests. It is **not** a clinical decision system — always require clinician verification.

## High-level architecture
- Frontend: React (Vite) — case entry, settings (temperature/top_p/top_k), view citations.
- Backend: Node + TypeScript + Express — API endpoints for diagnosis, ingestion, embeddings, prompt building.
- Vector DB: Pinecone / pgvector / Weaviate (pluggable)
- LLM: OpenAI/other LLM for generation + OpenAI embeddings for RAG
- Storage: S3 or local for documents
- CI: GitHub Actions (lint, test)
