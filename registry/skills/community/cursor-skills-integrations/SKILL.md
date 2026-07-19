---
name: cursor-skills-integrations
description: CURSOR-SKILLS rules for integrations (webhooks, microservices, DBs, queues).
version: 0.1.0
category: integrations
---

# CURSOR-SKILLS - Integrations

Source: [cursor-skills/integrations](https://github.com/araguaci/cursor-skills/tree/main/integrations)

## CURSOR setup

- Docker, Kubernetes, GitLens, Remote Development, Database Client, REST Client.

## Typical structure

```
project/
├── src/   ├── tests/   ├── configs/   ├── docker/   ├── k8s/
└── .env
```

## Principles

- Microservices; error handling and logging; secure communication; retries and idempotency when applicable.

## Webhooks

- Standardized events and payloads; validation (e.g. signature); retry; security.

## Microservices

- Consistent APIs; discovery; load balancing; health checks; communication tests.

## Database

- Connection pooling; transactions; indexes; prepared statements; avoid N+1; naming conventions.

## Communication

- HTTP, gRPC, or WebSocket as appropriate; error handling; queues (RabbitMQ, Kafka, etc.) when it makes sense.
