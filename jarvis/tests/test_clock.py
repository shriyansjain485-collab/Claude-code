import pytest

from jarvis.tools.base import Tier, ToolError
from jarvis.tools.clock import calculate_expression


def test_current_datetime(tools, ctx):
    result = tools["current_datetime"].run({}, ctx)
    assert result.text == "It is Tuesday, 10 November 2026, 09:30 (local time)."
    assert tools["current_datetime"].tier is Tier.READ


@pytest.mark.parametrize(
    "expression, expected",
    [("2 + 2", 4), ("(1200 * 0.18) + 45", 261), ("7 // 2", 3), ("2 ** 10", 1024), ("-3 * 4", -12), ("10 % 4", 2), ("1,000 × 3", 3000), ("9 ÷ 3", 3)],
)
def test_calculate(expression, expected):
    assert calculate_expression(expression) == pytest.approx(expected)


def test_calculate_tool_output(tools, ctx):
    assert tools["calculate"].run({"expression": "10 / 4"}, ctx).text == "10 / 4 = 2.5"
    assert tools["calculate"].run({"expression": "6 / 3"}, ctx).text == "6 / 3 = 2"


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os').system('echo hi')",
        "open('/etc/passwd').read()",
        "().__class__",
        "x + 1",
        "'a' * 3",
        "[1, 2]",
        "lambda: 1",
        "1 if 1 else 2",
        "9 ** 9 ** 9",
        "2 ** 1000",
        "1 / 0",
        "1 +",
        "(-8) ** 0.5",
    ],
)
def test_calculate_refuses_anything_but_arithmetic(expression):
    with pytest.raises(ToolError):
        calculate_expression(expression)
