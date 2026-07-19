---
name: cursor-skills-api
description: CURSOR-SKILLS rules for APIs (REST, GraphQL, gRPC). OpenAPI, tests, versioning.
version: 0.1.0
category: api
---

# CURSOR-SKILLS - API

Source: [cursor-skills/api](https://github.com/araguaci/cursor-skills/tree/main/api)

## CURSOR setup

- REST Client, Thunder Client, or Postman; JSON Tools; docs generator; Swagger Viewer.

## Typical structure

```
project/
├── src/   ├── tests/   ├── docs/   ├── schemas/
├── swagger.yaml   └── .env
```

## Patterns

- REST: correct verbs and resources; HTTP status codes; versioning; JSON.
- **GraphQL**: queries, mutations, subscriptions; schema; introspect; validation.
- **gRPC**: services, methods, Protocol Buffers; error handling.

## Documentation

- OpenAPI/Swagger; request/response examples; error codes; authentication.
- Tools: Swagger/OpenAPI, Postman, Insomnia, ReDoc.

## Security and quality

- Validate inputs; auth; rate limit; CORS; HTTPS.
- Prettier, ESLint; endpoint tests (unit + integration); coverage ≥ 80%.

## REST Client config (example)

```json
{
  "editor.formatOnSave": true,
  "rest-client.environmentVariables": { "baseUrl": "http://localhost:3000" }
}
```
