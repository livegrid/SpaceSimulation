#!/usr/bin/env python3
"""
Simple HTTP/HTTPS server for testing camera permissions
"""
import http.server
import socketserver
import ssl
import tempfile
import os
from pathlib import Path

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

def create_self_signed_cert():
    """Create a temporary self-signed certificate for localhost testing"""
    cert_content = """-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKoK2VQ7VJTUtDANBgkqhkiG9w0BAQsFADANMQswCQYDVQQGEwJV
UzAeFw0yMzEyMDcwMDAwMDBaFw0yNDEyMDYwMDAwMDBaMA0xCzAJBgNVBAYTAlVT
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7VJTUt9Us8cKBwEiOfH5y1zOU
qSg4PU7kcRV5WDI/KHY7YjOkjxh/3+dGp4Q7FQAF8lQXlXGOcMdPhOHf39ia4+hN
6erA2JvL4GMgK1MXvfM13SIWYl/Szl9BfmhSxViYyVLTl9iGkFYY/YpnDTPWtcjz
fQIDAQABMA0GCSqGSIb3DQEBCwUAA4GBAAj7gJWQlZQgwK9BWKKGQfJFrGKlYz7o
7yJ4U/1mGKdGEXMgQlOQVtGJaNcGFyB8gPGGYJYjeLT7q0B6X9yGcbHqZAWVqBAh
Gj+4K9cGTGqwSn+gKYK/bx2WuEvxS2s7mRpWm9s3TqmT7w+F2W5jPKt8xqYgHrI
-----END CERTIFICATE-----"""
    
    key_content = """-----BEGIN PRIVATE KEY-----
MIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBALtUlNS31SzxwoHA
SI58fnLXM5SpKDg9TuRxFXlYMj8odjtiM6SPGH/f50anhDsVAAXyVBeVcY5wx0+E
4d/f2Jrj6E3p6sDYm8vgYyArUxe98zXdIhZiX9LOX0F+aFLFWJjJUtOX2IaQVhj9
imcNM9a1yPN9AgMBAAECgYAJ+QERpLzUeHHOGfUrmHKOWGRJ8+TUfXKMOlCAjFqO
pDEX5tJ7+C+a1c1a3n4X7L9Z6E2d8Qm3y6v7eR2+7x5W+u9o7zqHJV8Xm1i7+Oj
8OmGGfY1ZmYQ9O7c6Y6Z7yO6TqNJ8M8ZnO9W0Yz3A1X6W9XjO8QqY+1sQJBANtYE
C3dXW+5x2JYXQ/UvpZ8+/0Hq7yO8m3T9UzJi9e1cQ6F1J5U4TQeO8dRm7p8V+PW
8y+aZ6cQJBANpYZm5Q9i8zQ6y7WZVJP2z9QKm5U8tF4d8gTYK1+6n1SjOJ1mj7r
K8U+5R9rZzYVo9mKt3Y8pY1dPJ6CQWsTOr9MECQHcMj7sP9UaY1qGOsJK8E7oZo
n1cFz0Z2W1Q9eTg7v8qUi7bA5Y3m6ZrXp4X7y2hJ8y3m9O1tYxWsUECQQDMZJ8Z
Y6J9xW4oGnJpZE+8V3e6rY2H5v7jO9U2y1J8l3Z9v8mK2e6U1P7o9Qy3f8H+t7O
2z4K7YJ8B1E2zECZO+6JBAKnzXK9E2o8+4Y9R2J8m3U4s7w2E8V8+6qJcOaZM2a
N9Z2HUj
-----END PRIVATE KEY-----"""
    
    # Create temporary files
    cert_file = tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False)
    key_file = tempfile.NamedTemporaryFile(mode='w', suffix='.key', delete=False)
    
    cert_file.write(cert_content)
    cert_file.close()
    
    key_file.write(key_content)
    key_file.close()
    
    return cert_file.name, key_file.name

def start_http_server(port=8000):
    """Start HTTP server for local testing"""
    print(f"Starting HTTP server at http://localhost:{port}/")
    print("Note: Camera may not work over HTTP in some browsers due to security restrictions")
    
    with socketserver.TCPServer(("", port), CustomHTTPRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nHTTP Server stopped")

def start_https_server(port=8443):
    """Start HTTPS server for local testing"""
    try:
        cert_file, key_file = create_self_signed_cert()
        
        print(f"Starting HTTPS server at https://localhost:{port}/")
        print("Note: You may need to accept the self-signed certificate in your browser")
        print("This is normal for localhost testing")
        
        with socketserver.TCPServer(("", port), CustomHTTPRequestHandler) as httpd:
            # Create SSL context
            context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
            context.load_cert_chain(cert_file, key_file)
            httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
            
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nHTTPS Server stopped")
            finally:
                # Clean up temporary files
                os.unlink(cert_file)
                os.unlink(key_file)
                
    except Exception as e:
        print(f"Error starting HTTPS server: {e}")
        print("Falling back to HTTP server...")
        start_http_server()

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1].lower() == "https":
        start_https_server()
    else:
        start_http_server()
