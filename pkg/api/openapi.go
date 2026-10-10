package api

import (
	_ "embed"
	"net/http"
)

//go:embed openapi.json
var openapiJSON []byte

func (s *Server) openapi(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(openapiJSON)
}
