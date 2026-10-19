"""
MCP (Model Context Protocol) integration service.
Handles discovery and execution of tools from MCP servers using
langchain-mcp-adapters and the official MCP Python SDK.

Supports stdio, streamable_http, and sse transports.
"""
from typing import Any, Dict, List, Optional
import logging

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.sessions import (
    SSEConnection,
    StdioConnection,
    StreamableHttpConnection,
)

logger = logging.getLogger(__name__)


class MCPService:
    """Service to connect to MCP servers, discover tools, and convert them to LangChain tools."""

    def _normalize_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize a user-provided tool/server config into a connection dict."""
        transport = config.get("transport") or config.get("type")
        name = config.get("name") or config.get("id") or "mcp_server"

        if transport == "stdio" or (not transport and "command" in config):
            conn: StdioConnection = {
                "transport": "stdio",
                "command": config["command"],
                "args": config.get("args", []),
            }
            if config.get("env"):
                conn["env"] = config["env"]
            if config.get("cwd"):
                conn["cwd"] = config["cwd"]
            return name, conn

        if transport in ("streamable_http", "http") or (not transport and "url" in config):
            conn: StreamableHttpConnection = {
                "transport": "streamable_http",
                "url": config["url"],
            }
            if config.get("headers"):
                conn["headers"] = config["headers"]
            return name, conn

        if transport == "sse":
            conn: SSEConnection = {
                "transport": "sse",
                "url": config["url"],
            }
            if config.get("headers"):
                conn["headers"] = config["headers"]
            return name, conn

        raise ValueError(f"Unsupported MCP transport/config: {config}")

    def _build_connections(self, tools_config: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Build the connections dict expected by MultiServerMCPClient."""
        connections: Dict[str, Any] = {}
        for i, cfg in enumerate(tools_config or []):
            try:
                name, conn = self._normalize_connection(cfg)
                # Ensure unique names
                unique_name = name if name not in connections else f"{name}_{i}"
                connections[unique_name] = conn
            except Exception as e:
                logger.warning(f"Skipping invalid MCP config {cfg}: {e}")
        return connections

    async def get_tools(self, tools_config: List[Dict[str, Any]]) -> List[BaseTool]:
        """
        Load LangChain tools from the given MCP server configurations.
        Each tool call will create a fresh session (as per adapters design).
        """
        if not tools_config:
            return []

        connections = self._build_connections(tools_config)
        if not connections:
            return []

        client = MultiServerMCPClient(connections)
        try:
            tools = await client.get_tools()
            logger.info(f"Loaded {len(tools)} MCP tools from {len(connections)} servers")
            return tools
        except Exception as e:
            logger.error(f"Failed to load MCP tools: {e}")
            # Return empty so agent can still run without tools
            return []

    async def discover_tools(self, tools_config: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Discover available tools (name, description, schema) without binding them.
        Useful for UI preview.
        """
        tools = await self.get_tools(tools_config)
        result = []
        for tool in tools:
            result.append({
                "name": tool.name,
                "description": tool.description or "",
                "args_schema": getattr(tool, "args_schema", None).__name__ if hasattr(tool, "args_schema") else None,
            })
        return result

    async def execute_tool(
        self,
        tools_config: List[Dict[str, Any]],
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Any:
        """Execute a specific tool by name (creates temporary client/session)."""
        tools = await self.get_tools(tools_config)
        for tool in tools:
            if tool.name == tool_name:
                return await tool.ainvoke(arguments)
        raise ValueError(f"Tool '{tool_name}' not found in the provided MCP configs")


# Singleton
mcp_service = MCPService()
