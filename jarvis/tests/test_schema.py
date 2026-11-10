import pytest

from jarvis import schema

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 10},
        "count": {"type": "integer", "minimum": 1, "maximum": 5},
        "ratio": {"type": "number"},
        "flag": {"type": "boolean"},
        "mode": {"type": "string", "enum": ["a", "b"]},
        "code": {"type": "string", "maxLength": 5, "pattern": r"[A-Z]+"},
    },
    "required": ["title"],
}


def test_valid_inputs_pass():
    assert schema.validate({"title": "ok", "count": 3, "ratio": 1.5, "flag": True, "mode": "a", "code": "AB"}, SCHEMA) == []


@pytest.mark.parametrize(
    "arguments, fragment",
    [
        ({}, "missing required input 'title'"),
        ({"title": 5}, "must be text"),
        ({"title": ""}, "too short"),
        ({"title": "x" * 11}, "too long"),
        ({"title": "ok", "count": "3"}, "whole number"),
        ({"title": "ok", "count": True}, "whole number"),
        ({"title": "ok", "count": 2.0}, "whole number"),
        ({"title": "ok", "count": 0}, "at least 1"),
        ({"title": "ok", "count": 6}, "at most 5"),
        ({"title": "ok", "ratio": "high"}, "must be a number"),
        ({"title": "ok", "ratio": float("nan")}, "finite"),
        ({"title": "ok", "flag": "yes"}, "true or false"),
        ({"title": "ok", "mode": "c"}, "must be one of"),
        ({"title": "ok", "code": "ab"}, "expected format"),
        ({"title": "ok", "code": "AB\nx"}, "expected format"),
        ({"title": "ok", "extra": 1}, "unknown input 'extra'"),
        ({"title": "a\x00b"}, "invalid character"),
        ("not an object", "must be an object"),
        (None, "must be an object"),
        (["title"], "must be an object"),
    ],
)
def test_invalid_inputs_are_reported(arguments, fragment):
    problems = schema.validate(arguments, SCHEMA)
    assert problems and fragment in " ".join(problems)


def test_all_problems_reported_together():
    assert len(schema.validate({"count": 9, "bogus": 1}, SCHEMA)) == 3


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "string"},
        {"type": "object", "properties": {"x": {"type": "array"}}},
        {"type": "object", "properties": {"x": {"type": "string"}}},  # no maxLength
        {"type": "object", "properties": {"x": {"type": "integer", "multipleOf": 2}}},
        {"type": "object", "properties": {}, "required": ["ghost"]},
        {"type": "object", "properties": {}, "additionalProperties": True},
    ],
)
def test_tool_schemas_using_unenforced_features_are_rejected(bad):
    with pytest.raises(schema.SchemaError):
        schema.check_schema(bad)
