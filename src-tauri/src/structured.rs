use serde_json::{json, Value};

pub fn agent_response_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assistant_response": { "type": "string" },
            "thinking": { "type": ["string", "null"] },
            "tool_call": {
                "anyOf": [
                    { "type": "null" },
                    {
                        "type": "object",
                        "properties": {
                            "name": {
                                "type": "string",
                                "enum": [
                                    "read_file", "list_dir", "write_file", "remember",
                                    "search_web", "browse_web", "read_image", "search_document",
                                    "search_workspace", "execute_command", "send_file", "mcp_call"
                                ]
                            },
                            "arguments": { "type": "object" }
                        },
                        "required": ["name", "arguments"],
                        "additionalProperties": false
                    }
                ]
            }
        },
        "required": ["assistant_response", "tool_call"],
        "additionalProperties": false
    })
}
