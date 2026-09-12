use hyper::client::HttpConnector;
use hyper::{Body, Client as HyperClient};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};

pub(crate) type RpcHttpClient = HyperClient<HttpsConnector<HttpConnector>, Body>;

pub(crate) fn build_rpc_http_client() -> RpcHttpClient {
    let connector = HttpsConnectorBuilder::new()
        .with_native_roots()
        .https_or_http()
        .enable_http1()
        .build();
    HyperClient::builder().build::<_, Body>(connector)
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::{Method, Request};
    use std::time::Duration;

    #[tokio::test]
    async fn https_rpc_uri_reaches_transport_instead_of_failing_scheme_validation() {
        let request = Request::builder()
            .method(Method::POST)
            .uri("https://127.0.0.1:1/")
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .expect("valid diagnostic request");

        let result = tokio::time::timeout(
            Duration::from_secs(2),
            build_rpc_http_client().request(request),
        )
        .await
        .expect("closed local endpoint should fail fast");
        let error = result.expect_err("closed local endpoint should reject the connection");

        assert!(
            !error.to_string().contains("scheme is not http"),
            "HTTPS URI was rejected before reaching the transport: {error}"
        );
    }
}
