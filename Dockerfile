# syntax=docker/dockerfile:1
# Single image: Go API + built frontend. Used by docker compose and Cloud Run.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.24-alpine AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY pkg ./pkg
COPY cmd ./cmd
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=api /out/server /out/seed /app/
COPY --from=web /web/dist /app/web
ENV STATIC_DIR=/app/web PORT=8080
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/server"]
