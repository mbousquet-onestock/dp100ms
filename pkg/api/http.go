package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/onestock/dp100ms/pkg/engine"
	"github.com/onestock/dp100ms/pkg/store"
)

// Problem is an RFC 7807 error body.
type Problem struct {
	Type     string              `json:"type"`
	Title    string              `json:"title"`
	Status   int                 `json:"status"`
	Detail   string              `json:"detail,omitempty"`
	Instance string              `json:"instance,omitempty"`
	Errors   []engine.FieldError `json:"errors,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeProblem(w http.ResponseWriter, r *http.Request, status int, code, detail string, fields []engine.FieldError) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Problem{
		Type: "https://dp100ms.onestock.dev/problems/" + code, Title: http.StatusText(status), Status: status,
		Detail: detail, Instance: r.URL.Path, Errors: fields,
	})
}

func badRequest(w http.ResponseWriter, r *http.Request, detail string) {
	writeProblem(w, r, http.StatusBadRequest, "bad-request", detail, nil)
}

func notFound(w http.ResponseWriter, r *http.Request, what string) {
	writeProblem(w, r, http.StatusNotFound, "not-found", what+" not found", nil)
}

func validationFailed(w http.ResponseWriter, r *http.Request, fields []engine.FieldError) {
	writeProblem(w, r, http.StatusUnprocessableEntity, "validation-error", "the request contains invalid fields", fields)
}

func storeError(w http.ResponseWriter, r *http.Request, err error, what string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w, r, what)
	case errors.Is(err, store.ErrConflict):
		writeProblem(w, r, http.StatusConflict, "conflict", what+" already exists", nil)
	default:
		writeProblem(w, r, http.StatusInternalServerError, "internal", err.Error(), nil)
	}
}

const maxBody = 8 << 20

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var se *json.SyntaxError
		var te *json.UnmarshalTypeError
		switch {
		case errors.As(err, &se):
			badRequest(w, r, fmt.Sprintf("malformed JSON at offset %d", se.Offset))
		case errors.As(err, &te):
			validationFailed(w, r, []engine.FieldError{{Field: te.Field, Message: "expected " + te.Type.String()}})
		case errors.Is(err, io.EOF):
			badRequest(w, r, "request body is empty")
		default:
			badRequest(w, r, err.Error())
		}
		return false
	}
	return true
}

// Page is the pagination envelope.
type Page[T any] struct {
	Items    []T `json:"items"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
	Total    int `json:"total"`
}

func pageParams(r *http.Request) (page, size int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	size, _ = strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 50
	}
	if size > 1000 {
		size = 1000
	}
	return
}

func contains(haystack, q string) bool {
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(q))
}
