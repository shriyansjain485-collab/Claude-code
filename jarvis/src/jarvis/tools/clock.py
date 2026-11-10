"""Date, time and arithmetic. Read-only, touches nothing."""

from __future__ import annotations

import ast
import operator

from jarvis.tools.base import Tier, Tool, ToolContext, ToolError, ToolResult


def _current_datetime(args: dict, ctx: ToolContext) -> ToolResult:
    now = ctx.now()
    return ToolResult(now.strftime("It is %A, %d %B %Y, %H:%M (local time)."))


_BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_LIMIT = 1e15


def _evaluate(node: ast.AST, depth: int = 0) -> float:
    """Work out an arithmetic expression by walking it. Nothing is executed."""
    if depth > 50:
        raise ToolError("That expression is too deeply nested.")
    if isinstance(node, ast.Expression):
        return _evaluate(node.body, depth + 1)
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_evaluate(node.operand, depth + 1))
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        left = _evaluate(node.left, depth + 1)
        right = _evaluate(node.right, depth + 1)
        if isinstance(node.op, ast.Pow) and (abs(right) > 100 or abs(left) > 1e6):
            raise ToolError("That power is too large to calculate.")
        try:
            result = _BINARY[type(node.op)](left, right)
        except ZeroDivisionError:
            raise ToolError("Division by zero.") from None
        except OverflowError:
            raise ToolError("That number is too large.") from None
        if isinstance(result, complex) or abs(result) > _LIMIT:
            raise ToolError("That result is out of range.")
        return result
    raise ToolError("Only numbers and + - * / // % ** ( ) are supported.")


def calculate_expression(expression: str) -> float:
    cleaned = expression.replace("×", "*").replace("÷", "/").replace("^", "**").replace(",", "")
    try:
        tree = ast.parse(cleaned.strip(), mode="eval")
    except SyntaxError:
        raise ToolError("That is not a valid arithmetic expression.") from None
    return _evaluate(tree)


def _calculate(args: dict, ctx: ToolContext) -> ToolResult:
    result = calculate_expression(args["expression"])
    if isinstance(result, float):
        result = round(result, 10)
        if result == int(result):
            result = int(result)
    return ToolResult(f"{args['expression']} = {result}")


TOOLS = [
    Tool(
        name="current_datetime",
        description="Get today's date, the day of the week and the current local time.",
        parameters={"type": "object", "properties": {}, "required": []},
        tier=Tier.READ,
        run=_current_datetime,
    ),
    Tool(
        name="calculate",
        description="Do exact arithmetic. Use this for any sum instead of working it out yourself.",
        parameters={
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "Arithmetic such as '(1200 * 0.18) + 45'. Numbers and + - * / // % ** only.",
                    "minLength": 1,
                    "maxLength": 200,
                }
            },
            "required": ["expression"],
        },
        tier=Tier.READ,
        run=_calculate,
    ),
]
