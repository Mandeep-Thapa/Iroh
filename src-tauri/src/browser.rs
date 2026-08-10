use headless_chrome::{Browser, LaunchOptions};
use tauri::command;
use std::time::Duration;

#[command]
pub fn browse_web_action(url: String, action: String, selector: Option<String>, input: Option<String>) -> Result<String, String> {
    let options = LaunchOptions::default_builder()
        .headless(true)
        .build()
        .map_err(|e| e.to_string())?;
        
    let browser = Browser::new(options).map_err(|e| e.to_string())?;
    let tab = browser.new_tab().map_err(|e| e.to_string())?;
    
    // Set a reasonable timeout
    tab.set_default_timeout(std::time::Duration::from_secs(15));
    
    tab.navigate_to(&url).map_err(|e| e.to_string())?;
    
    // wait_until_navigated() is notoriously flaky in headless_chrome and often hangs.
    // Instead, just wait a fixed amount of time for the page to render.
    std::thread::sleep(Duration::from_secs(4));
    
    match action.as_str() {
        "read" => {
            // Extract innerText of body
            let body = tab.find_element("body").map_err(|e| e.to_string())?;
            let text = body.get_inner_text().map_err(|e| e.to_string())?;
            Ok(text)
        },
        "click" => {
            if let Some(sel) = selector {
                let element = tab.find_element(&sel).map_err(|e| e.to_string())?;
                element.click().map_err(|e| e.to_string())?;
                std::thread::sleep(Duration::from_secs(3)); // wait for navigation
                let url = tab.get_url();
                Ok(format!("Clicked element. Current URL: {}", url))
            } else {
                Err("Selector required for click".to_string())
            }
        },
        "type" => {
            if let (Some(sel), Some(text)) = (selector, input) {
                let element = tab.find_element(&sel).map_err(|e| e.to_string())?;
                element.click().map_err(|e| e.to_string())?;
                element.type_into(&text).map_err(|e| e.to_string())?;
                Ok("Typed text into element".to_string())
            } else {
                Err("Selector and input required for type".to_string())
            }
        },
        "screenshot_base64" => {
            let png_data = tab.capture_screenshot(
                headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Jpeg,
                Some(50),
                None,
                true
            ).map_err(|e| e.to_string())?;
            
            use base64::{Engine as _, engine::general_purpose::STANDARD};
            let b64 = STANDARD.encode(&png_data);
            Ok(format!("data:image/jpeg;base64,{}", b64))
        },
        _ => Err("Unknown action".to_string()),
    }
}
