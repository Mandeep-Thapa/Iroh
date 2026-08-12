use reqwest::{Client, Url};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscovery {
    endpoint: String,
    server_info: Value,
    tools: Vec<Value>,
}

fn local_mcp_endpoint(endpoint: &str) -> Result<Url, String> {
    let url =
        Url::parse(endpoint).map_err(|error| format!("MCP endpoint is invalid: {}", error))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("MCP endpoint must use HTTP or HTTPS.".to_string());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
        return Err("Iroh only connects to loopback MCP servers.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("MCP credentials cannot be embedded in the endpoint URL.".to_string());
    }
    Ok(url)
}

fn valid_tool_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
}

fn parse_rpc_payload(content_type: &str, body: &str) -> Result<Value, String> {
    if body.len() > MAX_RESPONSE_BYTES {
        return Err("MCP response exceeded the 2 MB safety limit.".to_string());
    }
    if content_type.contains("text/event-stream") {
        let payload = body
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .last()
            .ok_or_else(|| "MCP server returned an empty event stream.".to_string())?;
        return serde_json::from_str(payload).map_err(|error| error.to_string());
    }
    serde_json::from_str(body).map_err(|error| error.to_string())
}

async fn rpc(
    client: &Client,
    endpoint: &Url,
    session: Option<&str>,
    payload: Value,
) -> Result<(Value, Option<String>), String> {
    let mut request = client
        .post(endpoint.clone())
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", MCP_PROTOCOL_VERSION)
        .json(&payload);
    if let Some(session_id) = session {
        request = request.header("mcp-session-id", session_id);
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| format!("MCP request failed: {}", error))?;
    let status = response.status();
    let session_id = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("MCP response exceeded the 2 MB safety limit.".to_string());
    }
    let mut body_bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("MCP response read failed: {}", error))?
    {
        if body_bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("MCP response exceeded the 2 MB safety limit.".to_string());
        }
        body_bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(body_bytes)
        .map_err(|_| "MCP response was not valid UTF-8.".to_string())?;
    if !status.is_success() {
        return Err(format!("MCP server returned {}: {}", status, body));
    }
    let parsed = parse_rpc_payload(&content_type, &body)?;
    if let Some(error) = parsed.get("error") {
        return Err(format!("MCP protocol error: {}", error));
    }
    Ok((parsed, session_id))
}

async fn initialize(client: &Client, endpoint: &Url) -> Result<(Value, Option<String>), String> {
    rpc(
        client,
        endpoint,
        None,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "Iroh", "version": env!("CARGO_PKG_VERSION") }
            }
        }),
    )
    .await
}

async fn notify_initialized(
    client: &Client,
    endpoint: &Url,
    session: Option<&str>,
) -> Result<(), String> {
    let mut request = client
        .post(endpoint.clone())
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", MCP_PROTOCOL_VERSION)
        .json(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }));
    if let Some(session_id) = session {
        request = request.header("mcp-session-id", session_id);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("MCP initialized notification failed: {}", error))?;
    if !response.status().is_success() {
        return Err(format!(
            "MCP server rejected initialized notification with {}.",
            response.status()
        ));
    }
    Ok(())
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn inspect_mcp_server(endpoint: String) -> Result<McpDiscovery, String> {
    let endpoint_url = local_mcp_endpoint(&endpoint)?;
    let client = client()?;
    let (initialized, session) = initialize(&client, &endpoint_url).await?;
    notify_initialized(&client, &endpoint_url, session.as_deref()).await?;
    let (tools_response, _) = rpc(
        &client,
        &endpoint_url,
        session.as_deref(),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
    )
    .await?;
    let tools = tools_response
        .pointer("/result/tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(McpDiscovery {
        endpoint,
        server_info: initialized
            .pointer("/result/serverInfo")
            .cloned()
            .unwrap_or(Value::Null),
        tools,
    })
}

#[tauri::command]
pub async fn call_mcp_tool(
    endpoint: String,
    tool: String,
    arguments: Value,
) -> Result<Value, String> {
    if !valid_tool_name(&tool) {
        return Err("MCP tool name is invalid.".to_string());
    }
    if !arguments.is_object() {
        return Err("MCP tool arguments must be a JSON object.".to_string());
    }
    let endpoint_url = local_mcp_endpoint(&endpoint)?;
    let client = client()?;
    let (_, session) = initialize(&client, &endpoint_url).await?;
    notify_initialized(&client, &endpoint_url, session.as_deref()).await?;
    let (response, _) = rpc(
        &client,
        &endpoint_url,
        session.as_deref(),
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": tool, "arguments": arguments }
        }),
    )
    .await?;
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_endpoints_are_loopback_only() {
        assert!(local_mcp_endpoint("http://127.0.0.1:3333/mcp").is_ok());
        assert!(local_mcp_endpoint("https://example.com/mcp").is_err());
        assert!(local_mcp_endpoint("file:///tmp/mcp").is_err());
    }

    #[test]
    fn mcp_tool_names_are_bounded() {
        assert!(valid_tool_name("files.read"));
        assert!(!valid_tool_name("files/read"));
    }
}
