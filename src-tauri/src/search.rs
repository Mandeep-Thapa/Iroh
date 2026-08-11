use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use tauri::command;

#[derive(Serialize)]
pub struct SearchResult {
    pub title: String,
    pub link: String,
    pub snippet: String,
}

#[command]
pub async fn search_web(query: String) -> Result<String, String> {
    if query.trim().is_empty() || query.len() > 500 {
        return Err("Search query must contain between 1 and 500 characters.".to_string());
    }

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding::encode(&query)
    );

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!(
            "Search request failed with status: {}",
            res.status()
        ));
    }

    let html_content = res.text().await.map_err(|e| e.to_string())?;
    let document = Html::parse_document(&html_content);

    // DuckDuckGo html results are usually in div.result
    let result_selector = Selector::parse(".result").map_err(|e| e.to_string())?;
    let title_selector = Selector::parse(".result__title .result__a").map_err(|e| e.to_string())?;
    let snippet_selector = Selector::parse(".result__snippet").map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    for element in document.select(&result_selector).take(5) {
        if let Some(title_el) = element.select(&title_selector).next() {
            let title = title_el.text().collect::<Vec<_>>().join("");
            let link = title_el.value().attr("href").unwrap_or("").to_string();

            // Fix relative DDG links if present
            let mut final_link = link.clone();
            if link.starts_with("//duckduckgo.com/l/?uddg=") {
                if let Ok(decoded) =
                    urlencoding::decode(&link.replace("//duckduckgo.com/l/?uddg=", ""))
                {
                    // Extract just the actual URL before any &rut= parameters
                    let clean = decoded
                        .split("&rut=")
                        .next()
                        .unwrap_or(&decoded)
                        .to_string();
                    final_link = clean;
                }
            }

            let snippet = if let Some(snippet_el) = element.select(&snippet_selector).next() {
                snippet_el.text().collect::<Vec<_>>().join("")
            } else {
                "".to_string()
            };

            results.push(SearchResult {
                title,
                link: final_link,
                snippet: snippet.trim().to_string(),
            });
        }
    }

    if results.is_empty() {
        return Ok("No results found.".to_string());
    }

    let mut output = format!("Search Results for '{}':\n\n", query);
    for (i, res) in results.iter().enumerate() {
        output.push_str(&format!(
            "{}. {}\nLink: {}\nSnippet: {}\n\n",
            i + 1,
            res.title,
            res.link,
            res.snippet
        ));
    }

    Ok(output)
}
