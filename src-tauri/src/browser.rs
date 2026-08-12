use crate::path_security::validate_simple_id;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use headless_chrome::{Browser, LaunchOptions, Tab};
use reqwest::Url;
use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::Duration;

lazy_static::lazy_static! {
    static ref BROWSER: Mutex<Option<Browser>> = Mutex::new(None);
    static ref TABS: Mutex<HashMap<String, Arc<Tab>>> = Mutex::new(HashMap::new());
}

fn ip_is_private(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_unspecified()
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
        }
    }
}

fn validate_public_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("URL is invalid: {}", error))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Browser navigation only supports HTTP and HTTPS.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host.".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Err("Browser navigation to local services is blocked.".to_string());
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        if ip_is_private(address) {
            return Err("Browser navigation to private or local addresses is blocked.".to_string());
        }
    } else {
        let port = url.port_or_known_default().unwrap_or(443);
        let addresses = (host, port)
            .to_socket_addrs()
            .map_err(|error| format!("URL host could not be resolved: {}", error))?;
        if addresses.map(|address| address.ip()).any(ip_is_private) {
            return Err("Browser navigation resolved to a private or local address.".to_string());
        }
    }
    Ok(url)
}

fn get_or_create_tab(session_id: &str) -> Result<Arc<Tab>, String> {
    if let Some(tab) = TABS
        .lock()
        .map_err(|_| "Browser tab state is unavailable.".to_string())?
        .get(session_id)
        .cloned()
    {
        return Ok(tab);
    }

    let mut browser_guard = BROWSER
        .lock()
        .map_err(|_| "Browser state is unavailable.".to_string())?;
    if browser_guard.is_none() {
        let options = LaunchOptions::default_builder()
            .headless(true)
            .build()
            .map_err(|error| error.to_string())?;
        *browser_guard = Some(Browser::new(options).map_err(|error| error.to_string())?);
    }
    let tab = browser_guard
        .as_ref()
        .ok_or_else(|| "Browser failed to initialize.".to_string())?
        .new_tab()
        .map_err(|error| error.to_string())?;
    tab.set_default_timeout(Duration::from_secs(20));

    TABS.lock()
        .map_err(|_| "Browser tab state is unavailable.".to_string())?
        .insert(session_id.to_string(), tab.clone());
    Ok(tab)
}

#[tauri::command]
pub fn browse_web_action(
    session_id: String,
    url: String,
    action: String,
    selector: Option<String>,
    input: Option<String>,
) -> Result<String, String> {
    validate_simple_id(&session_id, "Browser session id")?;
    if action == "close" {
        if let Some(tab) = TABS
            .lock()
            .map_err(|_| "Browser tab state is unavailable.".to_string())?
            .remove(&session_id)
        {
            let _ = tab.close(true);
        }
        return Ok("Browser session closed.".to_string());
    }

    let validated_url = validate_public_url(&url)?;
    let tab = get_or_create_tab(&session_id)?;
    if tab.get_url() != validated_url.as_str() {
        tab.navigate_to(validated_url.as_str())
            .map_err(|error| error.to_string())?;
        std::thread::sleep(Duration::from_secs(1));
    }

    match action.as_str() {
        "navigate" => Ok(format!("Navigated to {}", tab.get_url())),
        "read" => {
            let body = tab
                .find_element("body")
                .map_err(|error| error.to_string())?;
            let text = body.get_inner_text().map_err(|error| error.to_string())?;
            Ok(text.chars().take(200_000).collect())
        }
        "click" => {
            let selector = selector.ok_or_else(|| "Selector is required for click.".to_string())?;
            tab.find_element(&selector)
                .map_err(|error| error.to_string())?
                .click()
                .map_err(|error| error.to_string())?;
            std::thread::sleep(Duration::from_secs(1));
            Ok(format!("Clicked element. Current URL: {}", tab.get_url()))
        }
        "type" => {
            let selector = selector.ok_or_else(|| "Selector is required for type.".to_string())?;
            let text = input.ok_or_else(|| "Input is required for type.".to_string())?;
            if text.len() > 20_000 {
                return Err("Browser input exceeds the 20 KB limit.".to_string());
            }
            let element = tab
                .find_element(&selector)
                .map_err(|error| error.to_string())?;
            element.click().map_err(|error| error.to_string())?;
            element
                .type_into(&text)
                .map_err(|error| error.to_string())?;
            Ok("Typed text into element.".to_string())
        }
        "screenshot_base64" => {
            let png = tab
                .capture_screenshot(
                    headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Png,
                    None,
                    None,
                    true,
                )
                .map_err(|error| error.to_string())?;
            Ok(format!("data:image/png;base64,{}", STANDARD.encode(png)))
        }
        _ => Err("Unknown browser action.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_local_browser_targets() {
        assert!(validate_public_url("http://127.0.0.1:3000").is_err());
        assert!(validate_public_url("file:///C:/Windows/win.ini").is_err());
    }
}
