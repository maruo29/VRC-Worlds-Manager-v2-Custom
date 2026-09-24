//! A read-only view of the library for the browser extension.
//!
//! The extension marks tweets about worlds that are already in the library,
//! and to do that it needs the library - which lives in this process, where a
//! sandboxed extension cannot reach. So this serves one small JSON document on
//! the loopback interface.
//!
//! No token is involved, and none is needed, because of how browsers treat a
//! response with no CORS headers: an ordinary web page can send a request here
//! but is never allowed to read the answer, while an extension holding a host
//! permission for this address can. The remaining ways in are closed
//! explicitly:
//!
//! - DNS rebinding, where an attacker's own domain resolves to 127.0.0.1 and
//!   the request becomes same-origin for them, is refused by checking `Host`.
//! - Requests that carry a web page's `Origin` are refused outright, so the
//!   data is not even computed for them.
//! - The socket is bound to 127.0.0.1 only, never to the network.

use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tiny_http::{Header, Method, Request, Response, Server};

/// Fixed, so the extension knows where to look. Chosen clear of the
/// 47823-47824 pair a desktop pet on this machine already listens on.
pub const BRIDGE_PORT: u16 = 38219;

const LIBRARY_PATH: &str = "/v1/library";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeWorld<'a> {
    id: &'a str,
    name: &'a str,
    author: &'a str,
    folders: &'a [String],
    /// Hidden worlds are listed too, so a tweet about one can say so rather
    /// than presenting it as something new.
    hidden: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeLibrary<'a> {
    /// Lets the extension be sure it is talking to this app.
    app: &'static str,
    worlds: Vec<BridgeWorld<'a>>,
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header is valid")
}

fn header_value<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}

fn plain(status: u16, text: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(text)
        .with_status_code(status)
        .with_header(header("Content-Type", "text/plain; charset=utf-8"))
}

/// Only this machine's own names for itself. Anything else means the request
/// was addressed to some other host that merely resolved here.
fn host_is_loopback(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return false;
    };
    host == format!("127.0.0.1:{}", BRIDGE_PORT) || host == format!("localhost:{}", BRIDGE_PORT)
}

/// Extensions send their own scheme, or no Origin at all. A web page sends
/// its http(s) origin, and a sandboxed frame sends "null".
fn origin_is_allowed(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(origin) => {
            origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://")
        }
    }
}

/// The worlds that count as "already added": filed in at least one folder,
/// or hidden. A world removed from its last folder is left out, matching what
/// the app itself badges as added.
fn library_json() -> Option<String> {
    let worlds_cell = crate::WORLDS.try_get()?;
    let worlds = worlds_cell.read().ok()?;

    let listed: Vec<BridgeWorld> = worlds
        .iter()
        .filter(|world| world.user_data.hidden || !world.user_data.folders.is_empty())
        .map(|world| BridgeWorld {
            id: &world.api_data.world_id,
            name: &world.api_data.world_name,
            author: &world.api_data.author_name,
            folders: &world.user_data.folders,
            hidden: world.user_data.hidden,
        })
        .collect();

    serde_json::to_string(&BridgeLibrary {
        app: "vrc-worlds-manager",
        worlds: listed,
    })
    .ok()
}

fn etag_for(body: &str) -> String {
    let mut hasher = DefaultHasher::new();
    body.hash(&mut hasher);
    format!("\"{:016x}\"", hasher.finish())
}

fn handle(request: &Request) -> Response<std::io::Cursor<Vec<u8>>> {
    if !host_is_loopback(header_value(request, "Host")) {
        return plain(403, "forbidden host");
    }
    if !origin_is_allowed(header_value(request, "Origin")) {
        return plain(403, "forbidden origin");
    }
    if *request.method() != Method::Get {
        return plain(405, "method not allowed");
    }

    let path = request.url().split('?').next().unwrap_or("");
    if path != LIBRARY_PATH {
        return plain(404, "not found");
    }

    let Some(body) = library_json() else {
        // The library loads shortly after startup.
        return plain(503, "library not loaded yet");
    };

    let etag = etag_for(&body);
    let common = [
        header("ETag", &etag),
        header("Cache-Control", "no-cache"),
        // Deliberately no Access-Control-Allow-Origin: that absence is what
        // keeps web pages from reading this.
        header("X-Content-Type-Options", "nosniff"),
    ];

    if header_value(request, "If-None-Match") == Some(etag.as_str()) {
        let mut response = Response::from_data(Vec::new()).with_status_code(304);
        for h in common {
            response.add_header(h);
        }
        return response;
    }

    let mut response = Response::from_string(body)
        .with_header(header("Content-Type", "application/json; charset=utf-8"));
    for h in common {
        response.add_header(h);
    }
    response
}

pub struct LibraryBridgeService;

impl LibraryBridgeService {
    /// Starts serving on its own thread. A failure to bind - another program
    /// on the port - only disables the browser integration, so it is logged
    /// rather than treated as fatal.
    pub fn start() {
        std::thread::spawn(|| {
            let server = match Server::http(("127.0.0.1", BRIDGE_PORT)) {
                Ok(server) => server,
                Err(e) => {
                    log::warn!(
                        "[bridge] could not listen on 127.0.0.1:{}: {}",
                        BRIDGE_PORT,
                        e
                    );
                    return;
                }
            };
            log::info!("[bridge] listening on 127.0.0.1:{}", BRIDGE_PORT);

            for request in server.incoming_requests() {
                let response = handle(&request);
                if let Err(e) = request.respond(response) {
                    log::warn!("[bridge] could not respond: {}", e);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_hosts_on_our_port_pass() {
        assert!(host_is_loopback(Some("127.0.0.1:38219")));
        assert!(host_is_loopback(Some("localhost:38219")));
        assert!(!host_is_loopback(Some("evil.example:38219")));
        assert!(!host_is_loopback(Some("127.0.0.1:80")));
        assert!(!host_is_loopback(None));
    }

    #[test]
    fn web_page_origins_are_refused() {
        assert!(origin_is_allowed(None));
        assert!(origin_is_allowed(Some("chrome-extension://abcdef")));
        assert!(origin_is_allowed(Some("moz-extension://1234-5678")));
        assert!(!origin_is_allowed(Some("https://x.com")));
        assert!(!origin_is_allowed(Some("http://127.0.0.1:38219")));
        assert!(!origin_is_allowed(Some("null")));
    }
}
