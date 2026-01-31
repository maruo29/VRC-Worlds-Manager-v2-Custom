use specta::specta;
use tauri::command;
use reqwest::Client;

#[command]
#[specta]
pub async fn resolve_redirects(url: String) -> Result<String, String> {
    log::info!("resolve_redirects called with: {}", url);
    
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .cookie_store(true)  // Enable cookies - some redirects need this
        .build()
        .map_err(|e| e.to_string())?;

    // Try following redirects with GET
    let response = client.get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.5")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let final_url = response.url().to_string();
    log::info!("resolve_redirects auto-redirect result: {}", final_url);
    
    // If URL hasn't changed, try manual redirect by checking Location header
    if final_url == url || final_url.contains("t.co") {
        log::info!("Auto-redirect didn't work, trying manual redirect check");
        
        // Make a request without following redirects
        let no_redirect_client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
            
        let manual_response = no_redirect_client.get(&url)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .send()
            .await
            .map_err(|e| e.to_string())?;
            
        log::info!("Manual request status: {}", manual_response.status());
        
        if let Some(location) = manual_response.headers().get("location") {
            if let Ok(redirect_url) = location.to_str() {
                log::info!("Found Location header: {}", redirect_url);
                
                // Recursively resolve the redirect URL
                if redirect_url != url && !redirect_url.is_empty() {
                    return Box::pin(resolve_redirects(redirect_url.to_string())).await;
                }
            }
        }
        
        // If still no luck, try parsing HTML for meta refresh
        let body = manual_response.text().await.map_err(|e| e.to_string())?;
        if let Some(meta_url) = extract_meta_refresh(&body) {
            log::info!("Found meta refresh URL: {}", meta_url);
            return Box::pin(resolve_redirects(meta_url)).await;
        }
    }
    
    log::info!("resolve_redirects final result: {}", final_url);
    Ok(final_url)
}

fn extract_meta_refresh(html: &str) -> Option<String> {
    // Look for <meta http-equiv="refresh" content="0;url=...">
    let html_lower = html.to_lowercase();
    if let Some(meta_pos) = html_lower.find("http-equiv=\"refresh\"") {
        let relevant = &html[meta_pos..];
        if let Some(content_pos) = relevant.to_lowercase().find("content=\"") {
            let after_content = &relevant[content_pos + 9..];
            if let Some(end_quote) = after_content.find('"') {
                let content = &after_content[..end_quote];
                // Parse "0;url=..." format
                if let Some(url_pos) = content.to_lowercase().find("url=") {
                    return Some(content[url_pos + 4..].trim().to_string());
                }
            }
        }
    }
    None
}

#[command]
#[specta]
pub fn get_startup_deep_link(state: tauri::State<crate::StartupDeepLink>) -> Option<String> {
    state.0.lock().unwrap().take()
}
