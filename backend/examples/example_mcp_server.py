"""
Example custom MCP server for AI Agent Space.
Run with: python example_mcp_server.py
Or use via stdio transport.
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("AI Agent Space Example")


@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers together."""
    return a + b


@mcp.tool()
def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b


@mcp.tool()
def get_weather(city: str) -> str:
    """Get a mock weather report for a city."""
    return f"The weather in {city} is sunny and 22°C (mock data)."


if __name__ == "__main__":
    # For local testing you can run with streamable-http:
    # mcp.run(transport="streamable-http", port=8001)
    mcp.run(transport="stdio")
