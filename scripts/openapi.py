#!/usr/bin/env python3
"""Convert docs/openapi.yaml into pkg/api/openapi.json (embedded by the server).

Expands the `x-items` page shorthand and checks that every $ref resolves."""
import json, sys, pathlib
import yaml

root = pathlib.Path(__file__).resolve().parent.parent
spec = yaml.safe_load((root / "docs/openapi.yaml").read_text())
schemas = spec["components"]["schemas"]
for name, s in list(schemas.items()):
    if isinstance(s, dict) and "x-items" in s:
        schemas[name] = {
            "type": "object",
            "required": ["items", "page", "pageSize", "total"],
            "properties": {
                "items": {"type": "array", "items": {"$ref": f"#/components/schemas/{s['x-items']}"}},
                "page": {"type": "integer"},
                "pageSize": {"type": "integer"},
                "total": {"type": "integer"},
            },
        }
schemas.pop("_Page", None)

missing = []
def walk(node, path="$"):
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str):
            parts = ref.lstrip("#/").split("/")
            cur = spec
            for p in parts:
                if not isinstance(cur, dict) or p not in cur:
                    missing.append(f"{path}: {ref}")
                    break
                cur = cur[p]
        for k, v in node.items():
            walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, f"{path}[{i}]")
walk(spec)
if missing:
    print("unresolved $ref:\n  " + "\n  ".join(missing), file=sys.stderr)
    sys.exit(1)
out = root / "pkg/api/openapi.json"
out.write_text(json.dumps(spec, ensure_ascii=False, indent=1) + "\n")
ops = sum(1 for p in spec["paths"].values() for m in p if m in ("get", "post", "put", "patch", "delete"))
print(f"wrote {out.relative_to(root)}: {len(spec['paths'])} paths, {ops} operations, {len(schemas)} schemas")
