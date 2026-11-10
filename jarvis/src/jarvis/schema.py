"""Checks a tool call's inputs against the tool's schema before it runs.

Local models sometimes invent parameters or send the wrong type. Nothing runs
unless the inputs match exactly: right names, right types, within limits.

Supported (a small subset of JSON Schema):
  type: string | integer | number | boolean
  string:  minLength, maxLength, pattern, enum
  numbers: minimum, maximum, enum
  object:  properties, required. Unknown properties are always rejected.
"""

from __future__ import annotations

import re

_TYPES = {"string", "integer", "number", "boolean"}
_KEYS = {"type", "description", "minLength", "maxLength", "pattern", "enum", "minimum", "maximum"}


class SchemaError(ValueError):
    """The schema itself is wrong (a programming mistake in a tool)."""


def check_schema(schema: dict) -> None:
    """Make sure a tool's schema only uses the features this validator enforces."""
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise SchemaError("schema must be an object schema")
    extra = set(schema) - {"type", "properties", "required"}
    if extra:
        raise SchemaError(f"unsupported schema keys: {sorted(extra)}")
    properties = schema.get("properties", {})
    if not isinstance(properties, dict):
        raise SchemaError("properties must be a dict")
    for name, spec in properties.items():
        if not isinstance(spec, dict) or spec.get("type") not in _TYPES:
            raise SchemaError(f"property '{name}' needs a type from {sorted(_TYPES)}")
        unknown = set(spec) - _KEYS
        if unknown:
            raise SchemaError(f"property '{name}' uses unsupported keys: {sorted(unknown)}")
        if spec["type"] == "string" and "maxLength" not in spec and "enum" not in spec:
            raise SchemaError(f"string property '{name}' must set maxLength")
        if "pattern" in spec:
            re.compile(spec["pattern"])
    required = schema.get("required", [])
    if not isinstance(required, list) or any(name not in properties for name in required):
        raise SchemaError("required must list defined properties")


def _check_value(name: str, value: object, spec: dict) -> str | None:
    kind = spec["type"]
    if kind == "string":
        if not isinstance(value, str):
            return f"'{name}' must be text (a string), got {type(value).__name__}"
        if "minLength" in spec and len(value) < spec["minLength"]:
            return f"'{name}' is too short (minimum {spec['minLength']} characters)"
        if "maxLength" in spec and len(value) > spec["maxLength"]:
            return f"'{name}' is too long (maximum {spec['maxLength']} characters)"
        if "pattern" in spec and not re.fullmatch(spec["pattern"], value, re.DOTALL):
            return f"'{name}' is not in the expected format"
        if "\x00" in value:
            return f"'{name}' contains an invalid character"
    elif kind == "boolean":
        if not isinstance(value, bool):
            return f"'{name}' must be true or false, got {type(value).__name__}"
    elif kind == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            return f"'{name}' must be a whole number, got {type(value).__name__}"
    elif kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return f"'{name}' must be a number, got {type(value).__name__}"
        if value != value or value in (float("inf"), float("-inf")):
            return f"'{name}' must be a finite number"
    if kind in ("integer", "number"):
        if "minimum" in spec and value < spec["minimum"]:
            return f"'{name}' must be at least {spec['minimum']}"
        if "maximum" in spec and value > spec["maximum"]:
            return f"'{name}' must be at most {spec['maximum']}"
    if "enum" in spec and value not in spec["enum"]:
        return f"'{name}' must be one of {spec['enum']}"
    return None


def validate(arguments: object, schema: dict) -> list[str]:
    """Return a list of problems. An empty list means the inputs are valid."""
    if not isinstance(arguments, dict):
        return ["the inputs must be an object of named values"]
    properties = schema.get("properties", {})
    errors = []
    for name in schema.get("required", []):
        if name not in arguments:
            errors.append(f"missing required input '{name}'")
    for name, value in arguments.items():
        if name not in properties:
            errors.append(f"unknown input '{name}' (allowed: {sorted(properties)})")
            continue
        problem = _check_value(name, value, properties[name])
        if problem:
            errors.append(problem)
    return errors
